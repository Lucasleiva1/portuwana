use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

const MAX_AUDIO_BYTES: usize = 5 * 1024 * 1024;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(120);
const POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FasterWhisperModel {
    Base,
    Small,
}

impl FasterWhisperModel {
    fn label(self) -> &'static str {
        match self {
            Self::Base => "base",
            Self::Small => "small",
        }
    }

    fn directory_name(self) -> &'static str {
        match self {
            Self::Base => "faster-whisper-base",
            Self::Small => "faster-whisper-small",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FasterWhisperTranscriptionRequest {
    request_id: String,
    audio_bytes: Vec<u8>,
    model: FasterWhisperModel,
    language: String,
    translate: bool,
    timeout_ms: u64,
    initial_prompt: Option<String>,
    context_scope: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FasterWhisperTranscriptionResponse {
    text: String,
    language: String,
    duration_ms: u64,
    processing_ms: u64,
    inference_ms: u64,
    provider: &'static str,
    model: String,
    backend: String,
    compute_type: String,
    real_time_factor: f64,
    runtime_load_ms: u64,
    gpu_name: Option<String>,
    driver_version: Option<String>,
    vram_total_mi_b: Option<u64>,
    vram_used_mi_b: Option<u64>,
    fallback_reason: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct FasterWhisperRuntimeStatus {
    ready: bool,
    binary_installed: bool,
    model_installed: bool,
    worker_running: bool,
    provider: Option<String>,
    faster_whisper_version: Option<String>,
    ctranslate2_version: Option<String>,
    model: Option<String>,
    backend: Option<String>,
    compute_type: Option<String>,
    cuda_device_count: u32,
    load_ms: Option<u64>,
    gpu_name: Option<String>,
    driver_version: Option<String>,
    vram_total_mi_b: Option<u64>,
    vram_used_mi_b: Option<u64>,
    fallback_reason: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FasterWhisperCommandError {
    code: &'static str,
    message: String,
}

impl FasterWhisperCommandError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn binary_missing() -> Self {
        Self::new(
            "binary-missing",
            "Faster-Whisper não está instalado. O reconhecimento temporário será usado.",
        )
    }

    fn model_missing() -> Self {
        Self::new(
            "model-missing",
            "O modelo Faster-Whisper não foi encontrado.",
        )
    }
}

#[derive(Debug)]
struct WavMetadata {
    duration_ms: u64,
}

struct WorkerProcess {
    child: Child,
    stdin: ChildStdin,
    model: FasterWhisperModel,
    status_path: PathBuf,
}

pub struct FasterWhisperService {
    worker: Mutex<Option<WorkerProcess>>,
    request_lock: Mutex<()>,
    cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
    runtime_root: PathBuf,
    request_root: PathBuf,
}

impl Default for FasterWhisperService {
    fn default() -> Self {
        let runtime_root = std::env::temp_dir().join(format!(
            "portuwana-faster-whisper-runtime-{}",
            std::process::id()
        ));
        let request_root = runtime_root.join("requests");
        let _ = fs::create_dir_all(&request_root);
        Self {
            worker: Mutex::new(None),
            request_lock: Mutex::new(()),
            cancellations: Mutex::new(HashMap::new()),
            runtime_root,
            request_root,
        }
    }
}

impl FasterWhisperService {
    fn register(&self, request_id: &str) -> Result<Arc<AtomicBool>, FasterWhisperCommandError> {
        let mut cancellations = self.cancellations.lock().map_err(|_| {
            FasterWhisperCommandError::new("internal", "O serviço de voz não está disponível.")
        })?;
        if cancellations.contains_key(request_id) {
            return Err(FasterWhisperCommandError::new(
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

    fn cancel(&self, request_id: &str) -> Result<bool, FasterWhisperCommandError> {
        let cancellations = self.cancellations.lock().map_err(|_| {
            FasterWhisperCommandError::new("internal", "O serviço de voz não está disponível.")
        })?;
        if let Some(cancellation) = cancellations.get(request_id) {
            cancellation.store(true, Ordering::SeqCst);
            return Ok(true);
        }
        Ok(false)
    }

    fn terminate_worker(&self) {
        if let Ok(mut guard) = self.worker.lock() {
            if let Some(mut worker) = guard.take() {
                let _ = writeln!(worker.stdin, "{{\"op\":\"shutdown\"}}");
                let _ = worker.stdin.flush();
                for _ in 0..8 {
                    match worker.child.try_wait() {
                        Ok(Some(_)) => return,
                        _ => thread::sleep(Duration::from_millis(25)),
                    }
                }
                let _ = worker.child.kill();
                let _ = worker.child.wait();
            }
        }
    }
}

impl Drop for FasterWhisperService {
    fn drop(&mut self) {
        self.terminate_worker();
        let _ = fs::remove_dir_all(&self.runtime_root);
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerResponse {
    status: String,
    text: Option<String>,
    language: Option<String>,
    inference_ms: Option<u64>,
    model: Option<String>,
    backend: Option<String>,
    compute_type: Option<String>,
    load_ms: Option<u64>,
    gpu_name: Option<String>,
    driver_version: Option<String>,
    vram_total_mi_b: Option<u64>,
    vram_used_mi_b: Option<u64>,
    fallback_reason: Option<String>,
    code: Option<String>,
    message: Option<String>,
}

struct RequestArtifacts {
    directory: PathBuf,
}

impl RequestArtifacts {
    fn create(root: &Path, request_id: &str) -> Result<Self, FasterWhisperCommandError> {
        let directory = root.join(request_id);
        if directory.exists() {
            return Err(FasterWhisperCommandError::new(
                "invalid-request",
                "A área temporária da transcrição já existe.",
            ));
        }
        fs::create_dir_all(&directory).map_err(|error| {
            FasterWhisperCommandError::new(
                "temporary-file",
                format!("Não foi possível preparar o áudio: {error}"),
            )
        })?;
        Ok(Self { directory })
    }

    fn audio_path(&self) -> PathBuf {
        self.directory.join("audio.wav")
    }

    fn response_path(&self) -> PathBuf {
        self.directory.join("response.json")
    }
}

impl Drop for RequestArtifacts {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    let value = bytes.get(offset..offset + 2)?;
    Some(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let value = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn validate_wav(bytes: &[u8]) -> Result<WavMetadata, FasterWhisperCommandError> {
    let invalid = || {
        FasterWhisperCommandError::new(
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
    let duration_ms = ((data_bytes as u64 / 2) * 1_000) / 16_000;
    if duration_ms == 0 {
        return Err(invalid());
    }
    Ok(WavMetadata { duration_ms })
}

fn validate_request(
    request: &FasterWhisperTranscriptionRequest,
) -> Result<WavMetadata, FasterWhisperCommandError> {
    if request.request_id.is_empty()
        || request.request_id.len() > 64
        || !request
            .request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(FasterWhisperCommandError::new(
            "invalid-request",
            "Identificador de transcrição inválido.",
        ));
    }
    if !matches!(request.language.as_str(), "pt" | "es" | "auto") || request.translate {
        return Err(FasterWhisperCommandError::new(
            "invalid-config",
            "PORTUWANA reconhece português, espanhol ou detecção automática, sem tradução.",
        ));
    }
    if !(1_000..=120_000).contains(&request.timeout_ms) {
        return Err(FasterWhisperCommandError::new(
            "invalid-config",
            "Timeout de transcrição inválido.",
        ));
    }
    if request
        .initial_prompt
        .as_ref()
        .is_some_and(|prompt| prompt.len() > 800)
        || request
            .context_scope
            .as_ref()
            .is_some_and(|scope| scope.len() > 80)
    {
        return Err(FasterWhisperCommandError::new(
            "invalid-config",
            "O contexto de voz excede o limite permitido.",
        ));
    }
    if request.audio_bytes.len() > MAX_AUDIO_BYTES {
        return Err(FasterWhisperCommandError::new(
            "invalid-wav",
            "O áudio excede o limite local permitido.",
        ));
    }
    validate_wav(&request.audio_bytes)
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

fn locate_worker(app: &AppHandle) -> Option<PathBuf> {
    resource_roots(app).into_iter().find_map(|root| {
        let candidate = root
            .join("binaries/faster-whisper")
            .join("portuwana-faster-whisper.exe");
        candidate.is_file().then_some(candidate)
    })
}

fn locate_model(app: &AppHandle, model: FasterWhisperModel) -> Option<PathBuf> {
    resource_roots(app).into_iter().find_map(|root| {
        let candidate = root.join("resources/models").join(model.directory_name());
        (candidate.join("model.bin").is_file() && candidate.join("config.json").is_file())
            .then_some(candidate)
    })
}

fn read_status(path: &Path) -> Result<FasterWhisperRuntimeStatus, FasterWhisperCommandError> {
    let bytes = fs::read(path).map_err(|error| {
        FasterWhisperCommandError::new(
            "runtime-status",
            format!("Não foi possível ler o estado de Faster-Whisper: {error}"),
        )
    })?;
    serde_json::from_slice(&bytes).map_err(|error| {
        FasterWhisperCommandError::new(
            "runtime-status",
            format!("Estado de Faster-Whisper inválido: {error}"),
        )
    })
}

fn process_is_running(worker: &mut WorkerProcess) -> bool {
    matches!(worker.child.try_wait(), Ok(None))
}

fn spawn_worker(
    app: &AppHandle,
    service: &FasterWhisperService,
    model: FasterWhisperModel,
) -> Result<WorkerProcess, FasterWhisperCommandError> {
    let executable = locate_worker(app).ok_or_else(FasterWhisperCommandError::binary_missing)?;
    let model_path = locate_model(app, model).ok_or_else(FasterWhisperCommandError::model_missing)?;
    fs::create_dir_all(&service.request_root).map_err(|error| {
        FasterWhisperCommandError::new(
            "temporary-file",
            format!("Não foi possível iniciar a área temporária: {error}"),
        )
    })?;
    let generation = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let status_path = service.runtime_root.join(format!("status-{generation}.json"));
    let stderr_path = service.runtime_root.join("worker.stderr.log");
    let stderr = File::create(&stderr_path).map_err(|error| {
        FasterWhisperCommandError::new(
            "temporary-file",
            format!("Não foi possível preparar o log local: {error}"),
        )
    })?;

    let mut command = Command::new(&executable);
    command
        .current_dir(executable.parent().unwrap_or_else(|| Path::new(".")))
        .arg("--model-path")
        .arg(&model_path)
        .arg("--model-name")
        .arg(model.label())
        .arg("--request-root")
        .arg(&service.request_root)
        .arg("--status-path")
        .arg(&status_path)
        .arg("--preferred-device")
        .arg("cuda")
        .arg("--gpu-compute-type")
        .arg("int8_float32")
        .arg("--cpu-compute-type")
        .arg("int8")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|error| {
        FasterWhisperCommandError::new(
            "spawn-failed",
            format!("Não foi possível iniciar Faster-Whisper: {error}"),
        )
    })?;
    let stdin = child.stdin.take().ok_or_else(|| {
        FasterWhisperCommandError::new("spawn-failed", "O worker local não abriu a entrada.")
    })?;

    let started = Instant::now();
    loop {
        if status_path.is_file() {
            let mut status = read_status(&status_path)?;
            status.binary_installed = true;
            status.model_installed = true;
            status.worker_running = true;
            if status.ready {
                break;
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err(FasterWhisperCommandError::new(
                "runtime-startup",
                status
                    .error
                    .unwrap_or_else(|| "Faster-Whisper não conseguiu carregar o modelo.".to_owned()),
            ));
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(FasterWhisperCommandError::new(
                "runtime-startup",
                format!("Faster-Whisper encerrou durante a inicialização: {status}"),
            ));
        }
        if started.elapsed() >= STARTUP_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(FasterWhisperCommandError::new(
                "runtime-timeout",
                "Faster-Whisper demorou demais para carregar.",
            ));
        }
        thread::sleep(POLL_INTERVAL);
    }

    Ok(WorkerProcess {
        child,
        stdin,
        model,
        status_path,
    })
}

fn ensure_worker(
    app: &AppHandle,
    service: &FasterWhisperService,
    model: FasterWhisperModel,
) -> Result<FasterWhisperRuntimeStatus, FasterWhisperCommandError> {
    let mut guard = service.worker.lock().map_err(|_| {
        FasterWhisperCommandError::new("internal", "O worker local não está disponível.")
    })?;
    let reuse = guard
        .as_mut()
        .is_some_and(|worker| worker.model == model && process_is_running(worker));
    if !reuse {
        if let Some(mut worker) = guard.take() {
            let _ = worker.child.kill();
            let _ = worker.child.wait();
        }
        *guard = Some(spawn_worker(app, service, model)?);
    }
    let worker = guard.as_mut().expect("worker must exist after startup");
    let mut status = read_status(&worker.status_path)?;
    status.binary_installed = true;
    status.model_installed = true;
    status.worker_running = process_is_running(worker);
    Ok(status)
}

fn kill_active_worker(service: &FasterWhisperService) {
    if let Ok(mut guard) = service.worker.lock() {
        if let Some(mut worker) = guard.take() {
            let _ = worker.child.kill();
            let _ = worker.child.wait();
        }
    }
}

fn transcribe_blocking(
    app: AppHandle,
    service: &FasterWhisperService,
    request: FasterWhisperTranscriptionRequest,
    cancellation: Arc<AtomicBool>,
) -> Result<FasterWhisperTranscriptionResponse, FasterWhisperCommandError> {
    let wav = validate_request(&request)?;
    let started = Instant::now();
    let _request_guard = service.request_lock.lock().map_err(|_| {
        FasterWhisperCommandError::new("internal", "O serviço de voz está ocupado.")
    })?;
    let _ = ensure_worker(&app, service, request.model)?;
    let artifacts = RequestArtifacts::create(&service.request_root, &request.request_id)?;
    fs::write(artifacts.audio_path(), &request.audio_bytes).map_err(|error| {
        FasterWhisperCommandError::new(
            "temporary-file",
            format!("Não foi possível preparar o WAV: {error}"),
        )
    })?;

    let command = serde_json::json!({
        "op": "transcribe",
        "requestId": request.request_id,
        "audioPath": artifacts.audio_path(),
        "responsePath": artifacts.response_path(),
        "language": request.language,
        "initialPrompt": request.initial_prompt.unwrap_or_default(),
        "contextScope": request.context_scope.unwrap_or_else(|| "lesson".to_owned()),
    });
    {
        let mut guard = service.worker.lock().map_err(|_| {
            FasterWhisperCommandError::new("internal", "O worker local não está disponível.")
        })?;
        let worker = guard.as_mut().ok_or_else(|| {
            FasterWhisperCommandError::new("runtime-stopped", "Faster-Whisper não está ativo.")
        })?;
        serde_json::to_writer(&mut worker.stdin, &command).map_err(|error| {
            FasterWhisperCommandError::new(
                "runtime-write",
                format!("Não foi possível enviar o áudio ao worker: {error}"),
            )
        })?;
        worker.stdin.write_all(b"\n").map_err(|error| {
            FasterWhisperCommandError::new(
                "runtime-write",
                format!("Não foi possível finalizar o pedido: {error}"),
            )
        })?;
        worker.stdin.flush().map_err(|error| {
            FasterWhisperCommandError::new(
                "runtime-write",
                format!("Não foi possível enviar o pedido: {error}"),
            )
        })?;
    }

    loop {
        if cancellation.load(Ordering::SeqCst) {
            kill_active_worker(service);
            return Err(FasterWhisperCommandError::new(
                "cancelled",
                "Transcrição cancelada.",
            ));
        }
        if started.elapsed() >= Duration::from_millis(request.timeout_ms) {
            kill_active_worker(service);
            return Err(FasterWhisperCommandError::new(
                "timeout",
                "A transcrição demorou demais. Tente novamente ou escreva sua resposta.",
            ));
        }
        if artifacts.response_path().is_file() {
            break;
        }
        let stopped = service
            .worker
            .lock()
            .ok()
            .and_then(|mut guard| {
                guard
                    .as_mut()
                    .map(|worker| !process_is_running(worker))
            })
            .unwrap_or(true);
        if stopped {
            kill_active_worker(service);
            return Err(FasterWhisperCommandError::new(
                "runtime-stopped",
                "Faster-Whisper encerrou durante a transcrição.",
            ));
        }
        thread::sleep(POLL_INTERVAL);
    }

    let response: WorkerResponse = serde_json::from_slice(
        &fs::read(artifacts.response_path()).map_err(|error| {
            FasterWhisperCommandError::new(
                "output-missing",
                format!("O worker não produziu uma resposta válida: {error}"),
            )
        })?,
    )
    .map_err(|error| {
        FasterWhisperCommandError::new(
            "output-invalid",
            format!("A resposta de Faster-Whisper é inválida: {error}"),
        )
    })?;
    if response.status != "success" {
        return Err(FasterWhisperCommandError::new(
            "transcription-failed",
            response
                .message
                .unwrap_or_else(|| response.code.unwrap_or_else(|| "Falha local de voz.".to_owned())),
        ));
    }
    let text = response.text.filter(|text| !text.trim().is_empty()).ok_or_else(|| {
        FasterWhisperCommandError::new("empty-transcript", "Não consegui identificar uma frase.")
    })?;
    let language = response.language.unwrap_or_else(|| "pt".to_owned());
    if !matches!(language.as_str(), "pt" | "es") {
        return Err(FasterWhisperCommandError::new(
            "unsupported-language",
            "A fala não foi reconhecida como português ou espanhol.",
        ));
    }
    let processing_ms = started.elapsed().as_millis() as u64;
    Ok(FasterWhisperTranscriptionResponse {
        text,
        language,
        duration_ms: wav.duration_ms,
        processing_ms,
        inference_ms: response.inference_ms.unwrap_or(processing_ms),
        provider: "faster-whisper",
        model: response.model.unwrap_or_else(|| request.model.label().to_owned()),
        backend: response.backend.unwrap_or_else(|| "cpu".to_owned()),
        compute_type: response.compute_type.unwrap_or_else(|| "int8".to_owned()),
        real_time_factor: processing_ms as f64 / wav.duration_ms as f64,
        runtime_load_ms: response.load_ms.unwrap_or(0),
        gpu_name: response.gpu_name,
        driver_version: response.driver_version,
        vram_total_mi_b: response.vram_total_mi_b,
        vram_used_mi_b: response.vram_used_mi_b,
        fallback_reason: response.fallback_reason,
    })
}

#[tauri::command]
pub async fn faster_whisper_status(
    app: AppHandle,
    service: State<'_, Arc<FasterWhisperService>>,
    model: Option<FasterWhisperModel>,
) -> Result<FasterWhisperRuntimeStatus, FasterWhisperCommandError> {
    let selected = model.unwrap_or(FasterWhisperModel::Small);
    let binary_installed = locate_worker(&app).is_some();
    let model_installed = locate_model(&app, selected).is_some();
    if !binary_installed || !model_installed {
        return Ok(FasterWhisperRuntimeStatus {
            binary_installed,
            model_installed,
            model: Some(selected.label().to_owned()),
            error: Some(if !binary_installed {
                FasterWhisperCommandError::binary_missing().message
            } else {
                FasterWhisperCommandError::model_missing().message
            }),
            ..FasterWhisperRuntimeStatus::default()
        });
    }
    let service_for_task = Arc::clone(&service);
    tauri::async_runtime::spawn_blocking(move || {
        ensure_worker(&app, service_for_task.as_ref(), selected)
    })
        .await
        .map_err(|error| {
            FasterWhisperCommandError::new(
                "internal",
                format!("A inicialização local foi interrompida: {error}"),
            )
        })?
}

#[tauri::command]
pub async fn faster_whisper_transcribe(
    app: AppHandle,
    service: State<'_, Arc<FasterWhisperService>>,
    request: FasterWhisperTranscriptionRequest,
) -> Result<FasterWhisperTranscriptionResponse, FasterWhisperCommandError> {
    validate_request(&request)?;
    let request_id = request.request_id.clone();
    let cancellation = service.register(&request_id)?;
    let service_for_task = Arc::clone(&service);
    let result = tauri::async_runtime::spawn_blocking(move || {
        transcribe_blocking(app, service_for_task.as_ref(), request, cancellation)
    })
    .await
    .map_err(|error| {
        FasterWhisperCommandError::new(
            "internal",
            format!("A tarefa local de voz foi interrompida: {error}"),
        )
    });
    service.unregister(&request_id);
    result?
}

#[tauri::command]
pub fn faster_whisper_cancel(
    service: State<'_, Arc<FasterWhisperService>>,
    request_id: String,
) -> Result<bool, FasterWhisperCommandError> {
    if request_id.is_empty()
        || request_id.len() > 64
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(FasterWhisperCommandError::new(
            "invalid-request",
            "Identificador de transcrição inválido.",
        ));
    }
    service.cancel(&request_id)
}

#[tauri::command]
pub fn faster_whisper_reset_context(
    service: State<'_, Arc<FasterWhisperService>>,
    context_scope: Option<String>,
) -> Result<bool, FasterWhisperCommandError> {
    if context_scope.as_ref().is_some_and(|scope| scope.len() > 80) {
        return Err(FasterWhisperCommandError::new(
            "invalid-config",
            "O contexto de voz é inválido.",
        ));
    }
    let command = serde_json::json!({
        "op": "resetContext",
        "contextScope": context_scope,
    });
    let mut guard = service.worker.lock().map_err(|_| {
        FasterWhisperCommandError::new("internal", "O worker local não está disponível.")
    })?;
    let Some(worker) = guard.as_mut() else {
        return Ok(false);
    };
    serde_json::to_writer(&mut worker.stdin, &command).map_err(|error| {
        FasterWhisperCommandError::new(
            "runtime-write",
            format!("Não foi possível limpar o contexto: {error}"),
        )
    })?;
    worker.stdin.write_all(b"\n").map_err(|error| {
        FasterWhisperCommandError::new(
            "runtime-write",
            format!("Não foi possível limpar o contexto: {error}"),
        )
    })?;
    worker.stdin.flush().map_err(|error| {
        FasterWhisperCommandError::new(
            "runtime-write",
            format!("Não foi possível limpar o contexto: {error}"),
        )
    })?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn request(audio_bytes: Vec<u8>) -> FasterWhisperTranscriptionRequest {
        FasterWhisperTranscriptionRequest {
            request_id: "test-request".to_owned(),
            audio_bytes,
            model: FasterWhisperModel::Small,
            language: "pt".to_owned(),
            translate: false,
            timeout_ms: 45_000,
            initial_prompt: Some("aeroporto, bagagem".to_owned()),
            context_scope: Some("airport-arrival".to_owned()),
        }
    }

    #[test]
    fn accepts_multilingual_transcription_without_translation() {
        let metadata = validate_request(&request(valid_wav(1_000))).unwrap();
        assert_eq!(metadata.duration_ms, 1_000);
    }

    #[test]
    fn rejects_translation_and_invalid_audio() {
        let mut invalid = request(valid_wav(1_000));
        invalid.translate = true;
        assert_eq!(validate_request(&invalid).unwrap_err().code, "invalid-config");
        assert_eq!(validate_wav(b"not a wav").unwrap_err().code, "invalid-wav");
    }

    #[test]
    fn request_artifacts_are_removed() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("portuwana-fw-test-{unique}"));
        fs::create_dir_all(&root).unwrap();
        let directory = {
            let artifacts = RequestArtifacts::create(&root, "request").unwrap();
            fs::write(artifacts.audio_path(), valid_wav(100)).unwrap();
            artifacts.directory.clone()
        };
        assert!(!directory.exists());
        fs::remove_dir(root).unwrap();
    }
}
