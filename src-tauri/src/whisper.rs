use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State};

pub const WHISPER_CPP_VERSION: &str = "1.9.3";
const PROVIDER_ID: &str = "whisper.cpp";
const MAX_AUDIO_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WhisperModel {
    Base,
    Small,
}

impl WhisperModel {
    fn file_name(self) -> &'static str {
        match self {
            Self::Base => "ggml-base.bin",
            Self::Small => "ggml-small.bin",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Base => "base",
            Self::Small => "small",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperTranscriptionRequest {
    request_id: String,
    audio_bytes: Vec<u8>,
    model: WhisperModel,
    language: String,
    translate: bool,
    timeout_ms: u64,
    threads: Option<u16>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperTranscriptionResponse {
    text: String,
    language: String,
    duration_ms: u64,
    processing_ms: u64,
    provider: &'static str,
    model: &'static str,
    real_time_factor: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelStatus {
    model: WhisperModel,
    installed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperStatusResponse {
    version: &'static str,
    binary_installed: bool,
    models: Vec<WhisperModelStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperCommandError {
    code: &'static str,
    message: String,
}

impl WhisperCommandError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn binary_missing() -> Self {
        Self::new(
            "binary-missing",
            "Whisper não está configurado. Você pode continuar escrevendo.",
        )
    }

    fn model_missing() -> Self {
        Self::new(
            "model-missing",
            "Modelo de voz não encontrado. Você pode continuar escrevendo.",
        )
    }
}

#[derive(Default)]
pub struct WhisperSidecarService {
    cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl WhisperSidecarService {
    fn register(&self, request_id: &str) -> Result<Arc<AtomicBool>, WhisperCommandError> {
        let mut cancellations = self.cancellations.lock().map_err(|_| {
            WhisperCommandError::new("internal", "O serviço local de voz não está disponível.")
        })?;
        if cancellations.contains_key(request_id) {
            return Err(WhisperCommandError::new(
                "invalid-request",
                "A transcrição já está em andamento.",
            ));
        }
        let cancellation = Arc::new(AtomicBool::new(false));
        cancellations.insert(request_id.to_owned(), cancellation.clone());
        Ok(cancellation)
    }

    fn unregister(&self, request_id: &str) {
        if let Ok(mut cancellations) = self.cancellations.lock() {
            cancellations.remove(request_id);
        }
    }

    fn cancel(&self, request_id: &str) -> Result<bool, WhisperCommandError> {
        let cancellations = self.cancellations.lock().map_err(|_| {
            WhisperCommandError::new("internal", "O serviço local de voz não está disponível.")
        })?;
        if let Some(cancellation) = cancellations.get(request_id) {
            cancellation.store(true, Ordering::SeqCst);
            return Ok(true);
        }
        Ok(false)
    }
}

#[derive(Debug)]
struct WavMetadata {
    duration_ms: u64,
}

#[derive(Debug, Deserialize)]
struct WhisperCliOutput {
    result: WhisperCliResult,
    transcription: Vec<WhisperCliSegment>,
}

#[derive(Debug, Deserialize)]
struct WhisperCliResult {
    language: String,
}

#[derive(Debug, Deserialize)]
struct WhisperCliSegment {
    text: String,
}

struct TempArtifacts {
    directory: PathBuf,
}

impl TempArtifacts {
    fn create(request_id: &str) -> Result<Self, WhisperCommandError> {
        let directory = std::env::temp_dir().join(format!("portuwana-whisper-{request_id}"));
        if directory.exists() {
            return Err(WhisperCommandError::new(
                "invalid-request",
                "A área temporária de transcrição já existe.",
            ));
        }
        fs::create_dir(&directory).map_err(|error| {
            WhisperCommandError::new(
                "temporary-file",
                format!("Não foi possível preparar o áudio temporário: {error}"),
            )
        })?;
        Ok(Self { directory })
    }

    fn audio_path(&self) -> PathBuf {
        self.directory.join("audio.wav")
    }

    fn output_base(&self) -> PathBuf {
        self.directory.join("transcript")
    }

    fn output_json(&self) -> PathBuf {
        self.directory.join("transcript.json")
    }
}

impl Drop for TempArtifacts {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn validate_request(
    request: &WhisperTranscriptionRequest,
) -> Result<WavMetadata, WhisperCommandError> {
    if request.request_id.is_empty()
        || request.request_id.len() > 64
        || !request
            .request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(WhisperCommandError::new(
            "invalid-request",
            "Identificador de transcrição inválido.",
        ));
    }
    if request.language != "pt" || request.translate {
        return Err(WhisperCommandError::new(
            "invalid-config",
            "PORTUWANA requer transcrição em português sem tradução.",
        ));
    }
    if !(1_000..=120_000).contains(&request.timeout_ms) {
        return Err(WhisperCommandError::new(
            "invalid-config",
            "Timeout de transcrição inválido.",
        ));
    }
    if matches!(request.threads, Some(0 | 65..=u16::MAX)) {
        return Err(WhisperCommandError::new(
            "invalid-config",
            "Quantidade de threads inválida.",
        ));
    }
    if request.audio_bytes.len() > MAX_AUDIO_BYTES {
        return Err(WhisperCommandError::new(
            "invalid-wav",
            "O áudio excede o limite local permitido.",
        ));
    }
    validate_wav(&request.audio_bytes)
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    let value = bytes.get(offset..offset + 2)?;
    Some(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let value = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn validate_wav(bytes: &[u8]) -> Result<WavMetadata, WhisperCommandError> {
    let invalid = || {
        WhisperCommandError::new(
            "invalid-wav",
            "O áudio deve ser WAV PCM 16-bit, mono e 16 kHz.",
        )
    };
    if bytes.len() < 44 || bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err(invalid());
    }

    let mut offset = 12usize;
    let mut valid_format = false;
    let mut data_bytes = None;
    while offset + 8 <= bytes.len() {
        let chunk_id = &bytes[offset..offset + 4];
        let chunk_size = read_u32(bytes, offset + 4).ok_or_else(invalid)? as usize;
        let data_start = offset + 8;
        let data_end = data_start.checked_add(chunk_size).ok_or_else(invalid)?;
        if data_end > bytes.len() {
            return Err(invalid());
        }
        if chunk_id == b"fmt " {
            if chunk_size < 16 {
                return Err(invalid());
            }
            valid_format = read_u16(bytes, data_start) == Some(1)
                && read_u16(bytes, data_start + 2) == Some(1)
                && read_u32(bytes, data_start + 4) == Some(16_000)
                && read_u16(bytes, data_start + 12) == Some(2)
                && read_u16(bytes, data_start + 14) == Some(16);
        } else if chunk_id == b"data" {
            data_bytes = Some(chunk_size);
        }
        offset = data_end + (chunk_size % 2);
    }

    let data_bytes = data_bytes.filter(|size| *size > 0).ok_or_else(invalid)?;
    if !valid_format || data_bytes % 2 != 0 {
        return Err(invalid());
    }
    let samples = data_bytes / 2;
    let duration_ms = ((samples as u64) * 1_000) / 16_000;
    if duration_ms == 0 {
        return Err(invalid());
    }
    Ok(WavMetadata { duration_ms })
}

fn resource_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(debug_assertions)]
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir);
    }
    roots
}

fn fixed_asset(roots: &[PathBuf], relative_dir: &Path, file_name: &str) -> Option<PathBuf> {
    roots.iter().find_map(|root| {
        let directory = root.join(relative_dir).canonicalize().ok()?;
        let candidate = directory.join(file_name).canonicalize().ok()?;
        if candidate.is_file() && candidate.starts_with(&directory) {
            Some(candidate)
        } else {
            None
        }
    })
}

fn locate_binary(app: &AppHandle) -> Option<PathBuf> {
    fixed_asset(
        &resource_roots(app),
        Path::new("binaries/whisper"),
        "whisper-cli.exe",
    )
}

fn locate_model(app: &AppHandle, model: WhisperModel) -> Option<PathBuf> {
    fixed_asset(
        &resource_roots(app),
        Path::new("resources/models"),
        model.file_name(),
    )
}

fn is_non_speech_marker(text: &str) -> bool {
    let text = text.trim();
    (text.starts_with('[') && text.ends_with(']'))
        || (text.starts_with("<|") && text.ends_with("|>"))
}

fn parse_cli_output(bytes: &[u8]) -> Result<(String, String), WhisperCommandError> {
    let output: WhisperCliOutput = serde_json::from_slice(bytes).map_err(|error| {
        WhisperCommandError::new(
            "parse-failed",
            format!("A saída local de voz não pôde ser interpretada: {error}"),
        )
    })?;
    let text = output
        .transcription
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty() && !is_non_speech_marker(text))
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        return Err(WhisperCommandError::new(
            "empty-transcript",
            "Não consegui identificar uma frase. Tente novamente ou escreva sua resposta.",
        ));
    }
    Ok((text, output.result.language))
}

fn collect_stderr(reader: Option<thread::JoinHandle<String>>) -> String {
    reader
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default()
        .chars()
        .take(2_000)
        .collect()
}

fn stop_child(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn transcribe_blocking(
    app: &AppHandle,
    request: WhisperTranscriptionRequest,
    cancellation: Arc<AtomicBool>,
) -> Result<WhisperTranscriptionResponse, WhisperCommandError> {
    let wav = validate_request(&request)?;
    let binary = locate_binary(app).ok_or_else(WhisperCommandError::binary_missing)?;
    let model = locate_model(app, request.model).ok_or_else(WhisperCommandError::model_missing)?;
    let artifacts = TempArtifacts::create(&request.request_id)?;
    fs::write(artifacts.audio_path(), &request.audio_bytes).map_err(|error| {
        WhisperCommandError::new(
            "temporary-file",
            format!("Não foi possível preparar o WAV temporário: {error}"),
        )
    })?;

    let mut command = Command::new(&binary);
    command
        .current_dir(binary.parent().unwrap_or_else(|| Path::new(".")))
        .arg("-m")
        .arg(&model)
        .arg("-f")
        .arg(artifacts.audio_path())
        .arg("-l")
        .arg("pt")
        .arg("-oj")
        .arg("-of")
        .arg(artifacts.output_base())
        .arg("-np")
        .arg("-sns")
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if let Some(threads) = request.threads {
        command.arg("-t").arg(threads.to_string());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let started = Instant::now();
    let mut child = command.spawn().map_err(|error| {
        WhisperCommandError::new(
            "spawn-failed",
            format!("Não foi possível iniciar o reconhecimento local: {error}"),
        )
    })?;
    let stderr_reader = child.stderr.take().map(|mut pipe| {
        thread::spawn(move || {
            let mut stderr = String::new();
            let _ = pipe.read_to_string(&mut stderr);
            stderr
        })
    });

    let exit_status = loop {
        if cancellation.load(Ordering::SeqCst) {
            stop_child(&mut child);
            let _ = collect_stderr(stderr_reader);
            return Err(WhisperCommandError::new(
                "cancelled",
                "Transcrição cancelada.",
            ));
        }
        if started.elapsed() >= Duration::from_millis(request.timeout_ms) {
            stop_child(&mut child);
            let _ = collect_stderr(stderr_reader);
            return Err(WhisperCommandError::new(
                "timeout",
                "A transcrição demorou demais. Tente novamente ou escreva sua resposta.",
            ));
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => {
                stop_child(&mut child);
                let _ = collect_stderr(stderr_reader);
                return Err(WhisperCommandError::new(
                    "process-failed",
                    format!("Falha ao acompanhar o reconhecimento local: {error}"),
                ));
            }
        }
    };

    let stderr = collect_stderr(stderr_reader);
    if !exit_status.success() {
        return Err(WhisperCommandError::new(
            "process-failed",
            if stderr.trim().is_empty() {
                "Não consegui processar sua fala.".to_owned()
            } else {
                format!("whisper.cpp finalizou com erro: {}", stderr.trim())
            },
        ));
    }

    let json = fs::read(artifacts.output_json()).map_err(|error| {
        WhisperCommandError::new(
            "output-missing",
            format!("whisper.cpp não produziu o resultado esperado: {error}"),
        )
    })?;
    let (text, language) = parse_cli_output(&json)?;
    let processing_ms = started.elapsed().as_millis() as u64;
    Ok(WhisperTranscriptionResponse {
        text,
        language,
        duration_ms: wav.duration_ms,
        processing_ms,
        provider: PROVIDER_ID,
        model: request.model.label(),
        real_time_factor: processing_ms as f64 / wav.duration_ms as f64,
    })
}

#[tauri::command]
pub fn whisper_status(app: AppHandle) -> WhisperStatusResponse {
    WhisperStatusResponse {
        version: WHISPER_CPP_VERSION,
        binary_installed: locate_binary(&app).is_some(),
        models: vec![WhisperModel::Base, WhisperModel::Small]
            .into_iter()
            .map(|model| WhisperModelStatus {
                model,
                installed: locate_model(&app, model).is_some(),
            })
            .collect(),
    }
}

#[tauri::command]
pub async fn whisper_transcribe(
    app: AppHandle,
    service: State<'_, WhisperSidecarService>,
    request: WhisperTranscriptionRequest,
) -> Result<WhisperTranscriptionResponse, WhisperCommandError> {
    validate_request(&request)?;
    let request_id = request.request_id.clone();
    let cancellation = service.register(&request_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        transcribe_blocking(&app, request, cancellation)
    })
    .await
    .map_err(|error| {
        WhisperCommandError::new(
            "internal",
            format!("A tarefa local de voz foi interrompida: {error}"),
        )
    });
    service.unregister(&request_id);
    result?
}

#[tauri::command]
pub fn whisper_cancel(
    service: State<'_, WhisperSidecarService>,
    request_id: String,
) -> Result<bool, WhisperCommandError> {
    if request_id.is_empty()
        || request_id.len() > 64
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(WhisperCommandError::new(
            "invalid-request",
            "Identificador de transcrição inválido.",
        ));
    }
    service.cancel(&request_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn valid_wav(duration_ms: u32) -> Vec<u8> {
        let samples = (16_000 * duration_ms / 1_000) as usize;
        let data_size = samples * 2;
        let mut bytes = Vec::with_capacity(44 + data_size);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36u32 + data_size as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&16_000u32.to_le_bytes());
        bytes.extend_from_slice(&32_000u32.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(data_size as u32).to_le_bytes());
        bytes.resize(44 + data_size, 0);
        bytes
    }

    fn request(audio_bytes: Vec<u8>) -> WhisperTranscriptionRequest {
        WhisperTranscriptionRequest {
            request_id: "test-request".to_owned(),
            audio_bytes,
            model: WhisperModel::Base,
            language: "pt".to_owned(),
            translate: false,
            timeout_ms: 45_000,
            threads: Some(4),
        }
    }

    #[test]
    fn accepts_the_supported_config_and_wav() {
        let metadata = validate_request(&request(valid_wav(1_000))).unwrap();
        assert_eq!(metadata.duration_ms, 1_000);
    }

    #[test]
    fn rejects_invalid_config_and_wav() {
        let mut invalid_config = request(valid_wav(1_000));
        invalid_config.language = "auto".to_owned();
        assert_eq!(
            validate_request(&invalid_config).unwrap_err().code,
            "invalid-config"
        );
        assert_eq!(validate_wav(b"not a wav").unwrap_err().code, "invalid-wav");
    }

    #[test]
    fn parses_json_without_logs_or_non_speech_markers() {
        let json = br#"{
          "result": {"language": "pt"},
          "transcription": [
            {"text": " [MUSICA]"},
            {"text": " Sim, preciso de ajuda."},
            {"text": " Obrigado."}
          ]
        }"#;
        let (text, language) = parse_cli_output(json).unwrap();
        assert_eq!(text, "Sim, preciso de ajuda. Obrigado.");
        assert_eq!(language, "pt");
    }

    #[test]
    fn rejects_an_empty_transcription() {
        let json = br#"{
          "result": {"language": "pt"},
          "transcription": [{"text": " [SILENCIO]"}]
        }"#;
        assert_eq!(parse_cli_output(json).unwrap_err().code, "empty-transcript");
    }

    #[test]
    fn reports_missing_fixed_assets() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("portuwana-missing-{unique}"));
        fs::create_dir(&root).unwrap();
        assert!(fixed_asset(&[root.clone()], Path::new("models"), "missing.bin").is_none());
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn temporary_audio_is_removed_on_drop() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let request_id = format!("cleanup-{unique}");
        let directory = {
            let artifacts = TempArtifacts::create(&request_id).unwrap();
            fs::write(artifacts.audio_path(), valid_wav(100)).unwrap();
            artifacts.directory.clone()
        };
        assert!(!directory.exists());
    }

    #[test]
    fn cancellation_is_typed_and_idempotent() {
        let service = WhisperSidecarService::default();
        let cancellation = service.register("cancel-test").unwrap();
        assert!(service.cancel("cancel-test").unwrap());
        assert!(cancellation.load(Ordering::SeqCst));
        service.unregister("cancel-test");
        assert!(!service.cancel("cancel-test").unwrap());
    }
}
