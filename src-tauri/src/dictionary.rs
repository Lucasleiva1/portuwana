use std::{
    collections::BTreeSet,
    fs::File,
    io::{BufRead, BufReader, Cursor, Read},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use bzip2::read::BzDecoder;
use flate2::read::GzDecoder;
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Sqlite, SqlitePool, Transaction,
};
use tauri::{AppHandle, Emitter, Manager};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};
use walkdir::WalkDir;
use xz2::read::XzDecoder;

const DICTIONARY_SCHEMA_VERSION: i64 = 2;
const BATCH_SIZE: usize = 350;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum SourceFamily {
    WiktionaryPt,
    WiktextractEs,
    Apertium,
    FreeDict,
}

impl SourceFamily {
    fn key(&self) -> &'static str {
        match self {
            Self::WiktionaryPt => "wiktionary-pt",
            Self::WiktextractEs => "wiktextract-es",
            Self::Apertium => "apertium-es-pt",
            Self::FreeDict => "freedict-pt-es",
        }
    }

    fn display_name(&self) -> &'static str {
        match self {
            Self::WiktionaryPt => "Wikcionário português",
            Self::WiktextractEs => "Wikcionario español / Wiktextract",
            Self::Apertium => "Apertium español ↔ portugués",
            Self::FreeDict => "FreeDict português → espanhol",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DetectedSource {
    source_key: String,
    family: SourceFamily,
    display_name: String,
    file_path: String,
    file_name: String,
    file_size: u64,
    modified_at: Option<String>,
    format: String,
    license_label: String,
    redistribution_notes: String,
    validation: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDetectionReport {
    source_path: String,
    exists: bool,
    sources: Vec<DetectedSource>,
    missing_families: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryBuildProgress {
    stage: String,
    source: Option<String>,
    processed: u64,
    accepted: u64,
    errors: u64,
    elapsed_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSourceReport {
    family: String,
    file_name: String,
    status: String,
    processed: u64,
    accepted: u64,
    errors: u64,
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryBuildReport {
    build_version: String,
    status: String,
    source_path: String,
    sources: Vec<ImportedSourceReport>,
    term_count: i64,
    translation_count: i64,
    relation_count: i64,
    error_count: u64,
    database_size_bytes: u64,
    fts_enabled: bool,
    elapsed_ms: u64,
}

#[derive(Clone, Debug)]
struct LexicalRecord {
    source_term: String,
    source_language: &'static str,
    target_term: String,
    target_language: &'static str,
    part_of_speech: String,
    definition: Option<String>,
    context: String,
    locale: String,
    variants: Vec<String>,
    relations: Vec<String>,
    common_score: i64,
    external_reference: String,
}

#[derive(Default)]
struct ParseStats {
    processed: u64,
    errors: u64,
}

#[derive(Deserialize)]
struct WiktextractEntry {
    word: String,
    #[serde(default)]
    lang_code: String,
    #[serde(default)]
    pos: String,
    #[serde(default)]
    senses: Vec<WiktextractSense>,
    #[serde(default)]
    translations: Vec<WiktextractTranslation>,
    #[serde(default)]
    forms: Vec<WiktextractWord>,
    #[serde(default)]
    synonyms: Vec<WiktextractWord>,
}

#[derive(Deserialize)]
struct WiktextractSense {
    #[serde(default)]
    glosses: Vec<String>,
}

#[derive(Deserialize)]
struct WiktextractTranslation {
    word: String,
    #[serde(default)]
    lang_code: String,
    #[serde(default)]
    sense: String,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Deserialize)]
struct WiktextractWord {
    #[serde(default)]
    word: Option<String>,
    #[serde(default)]
    form: Option<String>,
}

impl WiktextractWord {
    fn value(&self) -> Option<&str> {
        self.word.as_deref().or(self.form.as_deref())
    }
}

#[tauri::command]
pub fn dictionary_detect_sources(source_path: String) -> Result<SourceDetectionReport, String> {
    detect_sources(Path::new(&source_path))
}

#[tauri::command]
pub async fn dictionary_build(
    app: AppHandle,
    source_path: String,
) -> Result<DictionaryBuildReport, String> {
    let sources_path = PathBuf::from(source_path);
    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || build_dictionary(app_for_task, sources_path))
        .await
        .map_err(|error| format!("Dictionary build task failed: {error}"))?
}

fn detect_sources(path: &Path) -> Result<SourceDetectionReport, String> {
    if !path.exists() {
        return Ok(SourceDetectionReport {
            source_path: path.to_string_lossy().into_owned(),
            exists: false,
            sources: Vec::new(),
            missing_families: expected_family_keys(),
        });
    }
    if !path.is_dir() {
        return Err(format!("The dictionary source path is not a folder: {}", path.display()));
    }

    let mut sources = Vec::new();
    for entry in WalkDir::new(path)
        .max_depth(3)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
    {
        let file_path = entry.path();
        let lower = entry.file_name().to_string_lossy().to_lowercase();
        let candidate = if lower.ends_with(".xml.bz2") {
            Some((
                SourceFamily::WiktionaryPt,
                "MediaWiki XML/BZ2 (streaming)",
                "REVIEW_REQUIRED",
                "Verificar la licencia y fecha del dump antes de redistribuir cualquier derivado.",
                "valid",
            ))
        } else if lower.ends_with(".jsonl.gz") {
            Some((
                SourceFamily::WiktextractEs,
                "JSONL/GZ (streaming)",
                "REVIEW_REQUIRED",
                "Archivo estructurado de Wiktextract; documentar origen exacto del dump.",
                "valid",
            ))
        } else if lower.ends_with(".jsonl") {
            Some((
                SourceFamily::WiktextractEs,
                "JSONL sin comprimir (streaming)",
                "REVIEW_REQUIRED",
                "Formato DEV aceptado; el archivo no se copia ni se empaqueta.",
                "valid-uncompressed",
            ))
        } else if lower.ends_with(".zip") && inspect_apertium_zip(file_path) {
            Some((
                SourceFamily::Apertium,
                "ZIP con diccionario bilingüe .dix",
                "GPL-3.0-or-later (embedded COPYING)",
                "Conservar atribución de Apertium y revisar obligaciones antes de redistribuir la base derivada.",
                "valid",
            ))
        } else if lower.ends_with(".tar.xz") && inspect_freedict_archive(file_path) {
            Some((
                SourceFamily::FreeDict,
                "TAR.XZ con StarDict",
                "CC BY-SA 3.0 (embedded .ifo)",
                "La base derivada requiere atribución y ShareAlike según los metadatos incluidos.",
                "valid",
            ))
        } else {
            None
        };

        if let Some((family, format, license, notes, validation)) = candidate {
            let metadata = entry.metadata().map_err(|error| error.to_string())?;
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let modified_at = metadata.modified().ok().and_then(system_time_label);
            let source_key = source_key(&family, file_path, metadata.len(), modified_at.as_deref());
            sources.push(DetectedSource {
                source_key,
                display_name: family.display_name().to_string(),
                family,
                file_path: file_path.to_string_lossy().into_owned(),
                file_name,
                file_size: metadata.len(),
                modified_at,
                format: format.to_string(),
                license_label: license.to_string(),
                redistribution_notes: notes.to_string(),
                validation: validation.to_string(),
            });
        }
    }

    sources.sort_by(|left, right| {
        left.family
            .key()
            .cmp(right.family.key())
            .then(left.file_name.cmp(&right.file_name))
    });
    let detected = sources
        .iter()
        .map(|source| source.family.key())
        .collect::<BTreeSet<_>>();
    let missing_families = expected_family_keys()
        .into_iter()
        .filter(|family| !detected.contains(family.as_str()))
        .collect();

    Ok(SourceDetectionReport {
        source_path: path.to_string_lossy().into_owned(),
        exists: true,
        sources,
        missing_families,
    })
}

fn expected_family_keys() -> Vec<String> {
    [
        SourceFamily::WiktionaryPt,
        SourceFamily::WiktextractEs,
        SourceFamily::Apertium,
        SourceFamily::FreeDict,
    ]
    .iter()
    .map(|family| family.key().to_string())
    .collect()
}

fn source_key(
    family: &SourceFamily,
    path: &Path,
    size: u64,
    modified_at: Option<&str>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(size.to_le_bytes());
    hasher.update(modified_at.unwrap_or("unknown").as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    format!("{}-{}", family.key(), &digest[..16])
}

fn system_time_label(time: SystemTime) -> Option<String> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs().to_string())
}

fn inspect_apertium_zip(path: &Path) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return false;
    };
    (0..archive.len()).any(|index| {
        archive
            .by_index(index)
            .map(|entry| {
                let name = entry.name().to_lowercase();
                name.ends_with(".dix")
                    && (name.contains("es-pt") || name.contains("pt-es"))
                    && !name.ends_with(".es.dix")
                    && !name.ends_with(".pt.dix")
            })
            .unwrap_or(false)
    })
}

fn inspect_freedict_archive(path: &Path) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let decoder = XzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let Ok(entries) = archive.entries() else {
        return false;
    };
    let mut has_ifo = false;
    let mut has_idx = false;
    let mut has_dict = false;
    for entry in entries.filter_map(Result::ok) {
        let Ok(path) = entry.path() else {
            continue;
        };
        let name = path.to_string_lossy().to_lowercase();
        has_ifo |= name.ends_with(".ifo");
        has_idx |= name.ends_with(".idx") || name.ends_with(".idx.gz");
        has_dict |= name.ends_with(".dict") || name.ends_with(".dict.dz");
    }
    has_ifo && has_idx && has_dict
}

fn build_dictionary(app: AppHandle, sources_path: PathBuf) -> Result<DictionaryBuildReport, String> {
    let database_path = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("portuwana.db");
    build_dictionary_core(Some(app), database_path, sources_path)
}

pub fn build_dictionary_at(
    database_path: PathBuf,
    sources_path: PathBuf,
) -> Result<DictionaryBuildReport, String> {
    build_dictionary_core(None, database_path, sources_path)
}

fn build_dictionary_core(
    app: Option<AppHandle>,
    database_path: PathBuf,
    sources_path: PathBuf,
) -> Result<DictionaryBuildReport, String> {
    let started = Instant::now();
    let detection = detect_sources(&sources_path)?;
    if !detection.exists {
        return Err("Fuentes no encontradas. Seleccioná otra carpeta en DEV.".to_string());
    }
    if detection.sources.is_empty() {
        return Err("No se detectaron fuentes léxicas compatibles en la carpeta.".to_string());
    }

    emit_progress(
        app.as_ref(),
        &started,
        "preparing",
        None,
        0,
        0,
        0,
    );

    let options = SqliteConnectOptions::new()
        .filename(&database_path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(30));
    let pool = tauri::async_runtime::block_on(
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options),
    )
    .map_err(|error| format!("Could not open dictionary SQLite database: {error}"))?;

    tauri::async_runtime::block_on(prepare_dictionary_build(&pool))?;
    let build_version = format!(
        "phase1-part7-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let sources_json = serde_json::to_string(&detection.sources).map_err(|error| error.to_string())?;
    let build_id = tauri::async_runtime::block_on(async {
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO dictionary_builds (
                schema_version, build_version, status, started_at, source_path, sources_json
             ) VALUES (?, ?, 'building', CURRENT_TIMESTAMP, ?, ?) RETURNING id",
        )
        .bind(DICTIONARY_SCHEMA_VERSION)
        .bind(&build_version)
        .bind(sources_path.to_string_lossy().as_ref())
        .bind(&sources_json)
        .fetch_one(&pool)
        .await
        .map_err(|error| error.to_string())
    })?;

    let mut source_reports = Vec::new();
    let mut total_errors = 0u64;
    for source in &detection.sources {
        emit_progress(
            app.as_ref(),
            &started,
            "importing",
            Some(source.file_name.clone()),
            0,
            0,
            0,
        );
        let source_id = tauri::async_runtime::block_on(upsert_source(&pool, source))?;
        let report = import_source(app.as_ref(), &started, &pool, source_id, source);
        total_errors += report.errors;
        tauri::async_runtime::block_on(update_source_report(&pool, source_id, &report))?;
        source_reports.push(report);
    }

    emit_progress(
        app.as_ref(),
        &started,
        "indexing",
        None,
        0,
        0,
        total_errors,
    );
    let fts_enabled = tauri::async_runtime::block_on(rebuild_search_indices(&pool))?;
    let (term_count, translation_count, relation_count) =
        tauri::async_runtime::block_on(dictionary_counts(&pool))?;

    tauri::async_runtime::block_on(async {
        let _ = sqlx::query("PRAGMA optimize").execute(&pool).await;
        Ok::<(), String>(())
    })?;
    let database_size_bytes = std::fs::metadata(&database_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let status = if total_errors == 0 {
        "completed"
    } else {
        "completed_with_errors"
    };
    tauri::async_runtime::block_on(async {
        sqlx::query(
            "UPDATE dictionary_builds
             SET status = ?, completed_at = CURRENT_TIMESTAMP,
                 term_count = ?, translation_count = ?, relation_count = ?,
                 error_count = ?, database_size_bytes = ?, fts_enabled = ?
             WHERE id = ?",
        )
        .bind(status)
        .bind(term_count)
        .bind(translation_count)
        .bind(relation_count)
        .bind(total_errors as i64)
        .bind(database_size_bytes as i64)
        .bind(if fts_enabled { 1 } else { 0 })
        .bind(build_id)
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    })?;

    emit_progress(
        app.as_ref(),
        &started,
        "completed",
        None,
        term_count as u64,
        translation_count as u64,
        total_errors,
    );

    Ok(DictionaryBuildReport {
        build_version,
        status: status.to_string(),
        source_path: sources_path.to_string_lossy().into_owned(),
        sources: source_reports,
        term_count,
        translation_count,
        relation_count,
        error_count: total_errors,
        database_size_bytes,
        fts_enabled,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

async fn prepare_dictionary_build(pool: &SqlitePool) -> Result<(), String> {
    let statements = [
        "DROP TABLE IF EXISTS dictionary_fts",
        "DELETE FROM dictionary_search_index",
        "DELETE FROM dictionary_translation_sources",
        "DELETE FROM dictionary_entry_sources",
        "DELETE FROM dictionary_relations",
        "DELETE FROM dictionary_translations",
        "DELETE FROM dictionary_senses",
        "DELETE FROM dictionary_entries",
        "DELETE FROM dictionary_sources",
    ];
    for statement in statements {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

async fn upsert_source(pool: &SqlitePool, source: &DetectedSource) -> Result<i64, String> {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO dictionary_sources (
            source_key, display_name, family, file_path, file_name, file_size,
            file_modified_at, license_label, redistribution_notes, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'importing')
         ON CONFLICT(source_key) DO UPDATE SET
            file_path = excluded.file_path,
            file_name = excluded.file_name,
            file_size = excluded.file_size,
            file_modified_at = excluded.file_modified_at,
            license_label = excluded.license_label,
            redistribution_notes = excluded.redistribution_notes,
            status = 'importing'
         RETURNING id",
    )
    .bind(&source.source_key)
    .bind(&source.display_name)
    .bind(source.family.key())
    .bind(&source.file_path)
    .bind(&source.file_name)
    .bind(source.file_size as i64)
    .bind(&source.modified_at)
    .bind(&source.license_label)
    .bind(&source.redistribution_notes)
    .fetch_one(pool)
    .await
    .map_err(|error| error.to_string())
}

async fn update_source_report(
    pool: &SqlitePool,
    source_id: i64,
    report: &ImportedSourceReport,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE dictionary_sources
         SET status = ?, imported_at = CURRENT_TIMESTAMP,
             processed_count = ?, accepted_count = ?, error_count = ?
         WHERE id = ?",
    )
    .bind(&report.status)
    .bind(report.processed as i64)
    .bind(report.accepted as i64)
    .bind(report.errors as i64)
    .bind(source_id)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn import_source(
    app: Option<&AppHandle>,
    started: &Instant,
    pool: &SqlitePool,
    source_id: i64,
    source: &DetectedSource,
) -> ImportedSourceReport {
    let mut writer = BatchWriter::new(app.cloned(), *started, pool.clone(), source_id, source.file_name.clone());
    let path = Path::new(&source.file_path);
    let parse_result = match source.family {
        SourceFamily::Apertium => parse_apertium_zip(path, |record| writer.push(record)),
        SourceFamily::WiktextractEs => {
            parse_wiktextract_file(path, |record| writer.push(record))
        }
        SourceFamily::WiktionaryPt => {
            parse_wiktionary_bz2(path, |record| writer.push(record))
        }
        SourceFamily::FreeDict => parse_freedict_archive(path, |record| writer.push(record)),
    };
    let flush_result = writer.finish();
    let accepted = writer.accepted;

    match (parse_result, flush_result) {
        (Ok(stats), Ok(())) => ImportedSourceReport {
            family: source.family.key().to_string(),
            file_name: source.file_name.clone(),
            status: if stats.errors == 0 { "imported" } else { "imported_with_errors" }.to_string(),
            processed: stats.processed,
            accepted,
            errors: stats.errors,
            message: None,
        },
        (parse, flush) => {
            let message = parse
                .err()
                .or_else(|| flush.err())
                .unwrap_or_else(|| "Unknown import error".to_string());
            ImportedSourceReport {
                family: source.family.key().to_string(),
                file_name: source.file_name.clone(),
                status: "error".to_string(),
                processed: 0,
                accepted,
                errors: 1,
                message: Some(message),
            }
        }
    }
}

struct BatchWriter {
    app: Option<AppHandle>,
    started: Instant,
    pool: SqlitePool,
    source_id: i64,
    source_name: String,
    records: Vec<LexicalRecord>,
    accepted: u64,
}

impl BatchWriter {
    fn new(
        app: Option<AppHandle>,
        started: Instant,
        pool: SqlitePool,
        source_id: i64,
        source_name: String,
    ) -> Self {
        Self {
            app,
            started,
            pool,
            source_id,
            source_name,
            records: Vec::with_capacity(BATCH_SIZE),
            accepted: 0,
        }
    }

    fn push(&mut self, record: LexicalRecord) -> Result<(), String> {
        if record.source_term.trim().is_empty() || record.target_term.trim().is_empty() {
            return Ok(());
        }
        self.records.push(record);
        self.accepted += 1;
        if self.records.len() >= BATCH_SIZE {
            self.flush()?;
            emit_progress(
                self.app.as_ref(),
                &self.started,
                "importing",
                Some(self.source_name.clone()),
                self.accepted,
                self.accepted,
                0,
            );
        }
        Ok(())
    }

    fn flush(&mut self) -> Result<(), String> {
        if self.records.is_empty() {
            return Ok(());
        }
        let records = std::mem::take(&mut self.records);
        tauri::async_runtime::block_on(insert_records(&self.pool, self.source_id, records))
    }

    fn finish(&mut self) -> Result<(), String> {
        self.flush()
    }
}

async fn insert_records(
    pool: &SqlitePool,
    source_id: i64,
    records: Vec<LexicalRecord>,
) -> Result<(), String> {
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    for record in records {
        insert_record(&mut transaction, source_id, &record).await?;
    }
    transaction.commit().await.map_err(|error| error.to_string())
}

async fn insert_record(
    transaction: &mut Transaction<'_, Sqlite>,
    source_id: i64,
    record: &LexicalRecord,
) -> Result<(), String> {
    let source_term = clean_term(&record.source_term);
    let target_term = clean_term(&record.target_term);
    if source_term.is_empty() || target_term.is_empty() {
        return Ok(());
    }
    let source_normalized = normalize(&source_term);
    let target_normalized = normalize(&target_term);
    let source_search_key = search_key(&source_term);
    let target_search_key = search_key(&target_term);
    let part_of_speech = normalize_part_of_speech(&record.part_of_speech);

    let source_entry_id = upsert_entry(
        transaction,
        EntryUpsert {
            term: &source_term,
            language: record.source_language,
            normalized: &source_normalized,
            search_key: &source_search_key,
            part_of_speech: &part_of_speech,
            definition: record.definition.as_deref(),
            locale: &record.locale,
            common_score: record.common_score,
        },
    )
    .await?;
    let target_entry_id = upsert_entry(
        transaction,
        EntryUpsert {
            term: &target_term,
            language: record.target_language,
            normalized: &target_normalized,
            search_key: &target_search_key,
            part_of_speech: &part_of_speech,
            definition: None,
            locale: if record.target_language == "pt" {
                &record.locale
            } else {
                ""
            },
            common_score: record.common_score,
        },
    )
    .await?;

    link_entry_source(
        transaction,
        source_entry_id,
        source_id,
        &record.external_reference,
    )
    .await?;
    link_entry_source(
        transaction,
        target_entry_id,
        source_id,
        &record.external_reference,
    )
    .await?;

    if let Some(definition) = record.definition.as_deref().filter(|value| !value.trim().is_empty()) {
        sqlx::query(
            "INSERT OR IGNORE INTO dictionary_senses (
                entry_id, definition, context_label, locale
             ) VALUES (?, ?, ?, ?)",
        )
        .bind(source_entry_id)
        .bind(definition)
        .bind(&record.context)
        .bind(&record.locale)
        .execute(&mut **transaction)
        .await
        .map_err(|error| error.to_string())?;
    }

    let direct_translation_id = upsert_translation(
        transaction,
        source_entry_id,
        &target_term,
        record.target_language,
        &target_normalized,
        &record.context,
        &record.locale,
        record.common_score,
        target_entry_id,
    )
    .await?;
    let inverse_translation_id = upsert_translation(
        transaction,
        target_entry_id,
        &source_term,
        record.source_language,
        &source_normalized,
        &record.context,
        &record.locale,
        record.common_score.saturating_sub(2),
        source_entry_id,
    )
    .await?;
    link_translation_source(
        transaction,
        direct_translation_id,
        source_id,
        &record.external_reference,
    )
    .await?;
    link_translation_source(
        transaction,
        inverse_translation_id,
        source_id,
        &record.external_reference,
    )
    .await?;

    for variant in &record.variants {
        insert_relation(
            transaction,
            source_entry_id,
            "variant",
            variant,
            record.source_language,
            &record.context,
        )
        .await?;
    }
    for relation in &record.relations {
        insert_relation(
            transaction,
            source_entry_id,
            "synonym",
            relation,
            record.source_language,
            &record.context,
        )
        .await?;
    }
    Ok(())
}

struct EntryUpsert<'a> {
    term: &'a str,
    language: &'a str,
    normalized: &'a str,
    search_key: &'a str,
    part_of_speech: &'a str,
    definition: Option<&'a str>,
    locale: &'a str,
    common_score: i64,
}

async fn upsert_entry(
    transaction: &mut Transaction<'_, Sqlite>,
    entry: EntryUpsert<'_>,
) -> Result<i64, String> {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO dictionary_entries (
            term, language, normalized, search_key, part_of_speech,
            definition, locale, common_score
         ) VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?)
         ON CONFLICT(language, normalized, part_of_speech) DO UPDATE SET
            definition = COALESCE(dictionary_entries.definition, excluded.definition),
            locale = COALESCE(dictionary_entries.locale, excluded.locale),
            common_score = MAX(dictionary_entries.common_score, excluded.common_score),
            updated_at = CURRENT_TIMESTAMP
         RETURNING id",
    )
    .bind(entry.term)
    .bind(entry.language)
    .bind(entry.normalized)
    .bind(entry.search_key)
    .bind(entry.part_of_speech)
    .bind(entry.definition)
    .bind(entry.locale)
    .bind(entry.common_score)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| error.to_string())
}

async fn link_entry_source(
    transaction: &mut Transaction<'_, Sqlite>,
    entry_id: i64,
    source_id: i64,
    external_reference: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR IGNORE INTO dictionary_entry_sources (
            entry_id, source_id, external_reference
         ) VALUES (?, ?, ?)",
    )
    .bind(entry_id)
    .bind(source_id)
    .bind(external_reference)
    .execute(&mut **transaction)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn upsert_translation(
    transaction: &mut Transaction<'_, Sqlite>,
    entry_id: i64,
    translated_term: &str,
    translated_language: &str,
    normalized_translation: &str,
    context: &str,
    locale: &str,
    source_priority: i64,
    target_entry_id: i64,
) -> Result<i64, String> {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO dictionary_translations (
            entry_id, translated_term, translated_language,
            normalized_translation, context_label, locale,
            source_priority, target_entry_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(
            entry_id, translated_language, normalized_translation,
            context_label, locale
         ) DO UPDATE SET
            source_priority = MAX(dictionary_translations.source_priority, excluded.source_priority),
            target_entry_id = COALESCE(dictionary_translations.target_entry_id, excluded.target_entry_id)
         RETURNING id",
    )
    .bind(entry_id)
    .bind(translated_term)
    .bind(translated_language)
    .bind(normalized_translation)
    .bind(context)
    .bind(locale)
    .bind(source_priority)
    .bind(target_entry_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| error.to_string())
}

async fn link_translation_source(
    transaction: &mut Transaction<'_, Sqlite>,
    translation_id: i64,
    source_id: i64,
    external_reference: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR IGNORE INTO dictionary_translation_sources (
            translation_id, source_id, external_reference
         ) VALUES (?, ?, ?)",
    )
    .bind(translation_id)
    .bind(source_id)
    .bind(external_reference)
    .execute(&mut **transaction)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

async fn insert_relation(
    transaction: &mut Transaction<'_, Sqlite>,
    entry_id: i64,
    relation_type: &str,
    related_term: &str,
    related_language: &str,
    context: &str,
) -> Result<(), String> {
    let cleaned = clean_term(related_term);
    if cleaned.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "INSERT OR IGNORE INTO dictionary_relations (
            entry_id, relation_type, related_term, related_language,
            normalized_related_term, context_label
         ) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(entry_id)
    .bind(relation_type)
    .bind(&cleaned)
    .bind(related_language)
    .bind(normalize(&cleaned))
    .bind(context)
    .execute(&mut **transaction)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

async fn rebuild_search_indices(pool: &SqlitePool) -> Result<bool, String> {
    sqlx::query("DELETE FROM dictionary_search_index")
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query(
        "INSERT INTO dictionary_search_index (
            entry_id, language, term, normalized, search_key, translations
         )
         SELECT e.id, e.language, e.term, e.normalized, e.search_key,
                COALESCE(GROUP_CONCAT(DISTINCT t.translated_term), '')
         FROM dictionary_entries e
         LEFT JOIN dictionary_translations t ON t.entry_id = e.id
         GROUP BY e.id",
    )
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    let fts_created = sqlx::query(
        "CREATE VIRTUAL TABLE dictionary_fts USING fts5(
            entry_id UNINDEXED,
            language UNINDEXED,
            term,
            normalized,
            search_key,
            translations,
            tokenize = 'unicode61 remove_diacritics 2'
         )",
    )
    .execute(pool)
    .await
    .is_ok();
    if fts_created {
        if let Err(error) = sqlx::query(
            "INSERT INTO dictionary_fts (
                entry_id, language, term, normalized, search_key, translations
             )
             SELECT entry_id, language, term, normalized, search_key, translations
             FROM dictionary_search_index",
        )
        .execute(pool)
        .await
        {
            let _ = sqlx::query("DROP TABLE IF EXISTS dictionary_fts")
                .execute(pool)
                .await;
            eprintln!("dictionary.fts.buildFailed: {error}");
            return Ok(false);
        }
    }
    Ok(fts_created)
}

async fn dictionary_counts(pool: &SqlitePool) -> Result<(i64, i64, i64), String> {
    let terms = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM dictionary_entries")
        .fetch_one(pool)
        .await
        .map_err(|error| error.to_string())?;
    let translations =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM dictionary_translations")
            .fetch_one(pool)
            .await
            .map_err(|error| error.to_string())?;
    let relations = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM dictionary_relations")
        .fetch_one(pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok((terms, translations, relations))
}

fn emit_progress(
    app: Option<&AppHandle>,
    started: &Instant,
    stage: &str,
    source: Option<String>,
    processed: u64,
    accepted: u64,
    errors: u64,
) {
    let progress = DictionaryBuildProgress {
        stage: stage.to_string(),
        source,
        processed,
        accepted,
        errors,
        elapsed_ms: started.elapsed().as_millis() as u64,
    };
    if let Some(app) = app {
        let _ = app.emit("dictionary-build-progress", progress);
    } else if progress.stage != "importing" || progress.accepted % 5_000 < BATCH_SIZE as u64 {
        eprintln!(
            "dictionary.{} source={} accepted={} errors={} elapsed_ms={}",
            progress.stage,
            progress.source.as_deref().unwrap_or("-"),
            progress.accepted,
            progress.errors,
            progress.elapsed_ms
        );
    }
}

fn parse_apertium_zip<F>(path: &Path, mut emit: F) -> Result<ParseStats, String>
where
    F: FnMut(LexicalRecord) -> Result<(), String>,
{
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    let entry_index = (0..archive.len())
        .find(|index| {
            archive
                .by_index(*index)
                .map(|entry| {
                    let name = entry.name().to_lowercase();
                    name.ends_with(".dix")
                        && (name.contains("es-pt") || name.contains("pt-es"))
                        && !name.ends_with(".es.dix")
                        && !name.ends_with(".pt.dix")
                })
                .unwrap_or(false)
        })
        .ok_or_else(|| "Apertium ZIP does not contain a bilingual .dix resource".to_string())?;
    let entry = archive.by_index(entry_index).map_err(|error| error.to_string())?;
    let entry_name = entry.name().to_lowercase();
    let left_language = if entry_name.contains("pt-es") { "pt" } else { "es" };
    let right_language = if left_language == "es" { "pt" } else { "es" };
    parse_apertium_reader(BufReader::new(entry), left_language, right_language, &mut emit)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ApertiumCapture {
    None,
    Left,
    Right,
    Identical,
}

fn parse_apertium_reader<R, F>(
    reader: R,
    left_language: &'static str,
    right_language: &'static str,
    emit: &mut F,
) -> Result<ParseStats, String>
where
    R: BufRead,
    F: FnMut(LexicalRecord) -> Result<(), String>,
{
    let mut xml = Reader::from_reader(reader);
    xml.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut stats = ParseStats::default();
    let mut in_entry = false;
    let mut capture = ApertiumCapture::None;
    let mut left = String::new();
    let mut right = String::new();
    let mut identical = String::new();
    let mut part_of_speech = String::new();
    let mut locale = String::new();
    let mut restriction = String::new();

    loop {
        match xml.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => match event.name().as_ref() {
                b"e" => {
                    in_entry = true;
                    left.clear();
                    right.clear();
                    identical.clear();
                    part_of_speech.clear();
                    locale.clear();
                    restriction.clear();
                    for attribute in event.attributes().flatten() {
                        match attribute.key.as_ref() {
                            b"v" => locale = String::from_utf8_lossy(&attribute.value).into_owned(),
                            b"r" => restriction = String::from_utf8_lossy(&attribute.value).into_owned(),
                            _ => {}
                        }
                    }
                }
                b"l" if in_entry => capture = ApertiumCapture::Left,
                b"r" if in_entry => capture = ApertiumCapture::Right,
                b"i" if in_entry => capture = ApertiumCapture::Identical,
                b"s" if in_entry && part_of_speech.is_empty() => {
                    for attribute in event.attributes().flatten() {
                        if attribute.key.as_ref() == b"n" {
                            part_of_speech =
                                String::from_utf8_lossy(&attribute.value).into_owned();
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(event)) if in_entry => match event.name().as_ref() {
                b"b" => captured_text_mut(capture, &mut left, &mut right, &mut identical)
                    .push(' '),
                b"j" => captured_text_mut(capture, &mut left, &mut right, &mut identical)
                    .push('-'),
                b"s" if part_of_speech.is_empty() => {
                    for attribute in event.attributes().flatten() {
                        if attribute.key.as_ref() == b"n" {
                            part_of_speech =
                                String::from_utf8_lossy(&attribute.value).into_owned();
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Text(text)) if in_entry && capture != ApertiumCapture::None => {
                let decoded = text.decode().map_err(|error| error.to_string())?;
                let unescaped = quick_xml::escape::unescape(&decoded)
                    .map_err(|error| error.to_string())?;
                captured_text_mut(capture, &mut left, &mut right, &mut identical)
                    .push_str(&unescaped);
            }
            Ok(Event::End(event)) => match event.name().as_ref() {
                b"l" | b"r" | b"i" => capture = ApertiumCapture::None,
                b"e" if in_entry => {
                    stats.processed += 1;
                    let (source, target) = if !identical.trim().is_empty() {
                        (identical.trim(), identical.trim())
                    } else {
                        (left.trim(), right.trim())
                    };
                    if !source.is_empty() && !target.is_empty() {
                        let context = if restriction.is_empty() {
                            "".to_string()
                        } else {
                            format!("Apertium restriction {restriction}")
                        };
                        emit(LexicalRecord {
                            source_term: source.to_string(),
                            source_language: left_language,
                            target_term: target.to_string(),
                            target_language: right_language,
                            part_of_speech: part_of_speech.clone(),
                            definition: None,
                            context,
                            locale: if locale.eq_ignore_ascii_case("br") {
                                "pt-BR".to_string()
                            } else if locale.eq_ignore_ascii_case("pt") {
                                "pt-PT".to_string()
                            } else {
                                String::new()
                            },
                            variants: Vec::new(),
                            relations: Vec::new(),
                            common_score: if locale.eq_ignore_ascii_case("br") { 92 } else { 82 },
                            external_reference: format!("entry:{}", stats.processed),
                        })?;
                    }
                    in_entry = false;
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("Apertium XML parse failed: {error}")),
            _ => {}
        }
        buffer.clear();
    }
    Ok(stats)
}

fn captured_text_mut<'a>(
    capture: ApertiumCapture,
    left: &'a mut String,
    right: &'a mut String,
    identical: &'a mut String,
) -> &'a mut String {
    match capture {
        ApertiumCapture::Left => left,
        ApertiumCapture::Right => right,
        ApertiumCapture::Identical => identical,
        ApertiumCapture::None => identical,
    }
}

fn parse_wiktextract_file<F>(path: &Path, emit: F) -> Result<ParseStats, String>
where
    F: FnMut(LexicalRecord) -> Result<(), String>,
{
    let file = File::open(path).map_err(|error| error.to_string())?;
    let lower = path.to_string_lossy().to_lowercase();
    if lower.ends_with(".gz") {
        parse_wiktextract_reader(BufReader::new(GzDecoder::new(file)), emit)
    } else {
        parse_wiktextract_reader(BufReader::new(file), emit)
    }
}

fn parse_wiktextract_reader<R, F>(reader: R, mut emit: F) -> Result<ParseStats, String>
where
    R: BufRead,
    F: FnMut(LexicalRecord) -> Result<(), String>,
{
    let mut stats = ParseStats::default();
    for line in reader.lines() {
        stats.processed += 1;
        let line = match line {
            Ok(line) => line,
            Err(_) => {
                stats.errors += 1;
                continue;
            }
        };
        let entry: WiktextractEntry = match serde_json::from_str(&line) {
            Ok(entry) => entry,
            Err(_) => {
                stats.errors += 1;
                continue;
            }
        };
        if entry.lang_code != "es" {
            continue;
        }
        let definition = entry
            .senses
            .iter()
            .flat_map(|sense| sense.glosses.iter())
            .find(|gloss| !gloss.trim().is_empty())
            .cloned();
        let variants = entry
            .forms
            .iter()
            .filter_map(WiktextractWord::value)
            .take(12)
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let relations = entry
            .synonyms
            .iter()
            .filter_map(WiktextractWord::value)
            .take(12)
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        for translation in entry
            .translations
            .iter()
            .filter(|translation| translation.lang_code == "pt" || translation.lang_code == "pt-br")
        {
            let locale = if translation.lang_code == "pt-br"
                || translation
                    .tags
                    .iter()
                    .any(|tag| tag.to_lowercase().contains("brazil"))
            {
                "pt-BR"
            } else {
                ""
            };
            emit(LexicalRecord {
                source_term: entry.word.clone(),
                source_language: "es",
                target_term: translation.word.clone(),
                target_language: "pt",
                part_of_speech: entry.pos.clone(),
                definition: definition.clone(),
                context: translation.sense.clone(),
                locale: locale.to_string(),
                variants: variants.clone(),
                relations: relations.clone(),
                common_score: if locale == "pt-BR" { 86 } else { 76 },
                external_reference: format!("jsonl:{}", stats.processed),
            })?;
        }
    }
    Ok(stats)
}

fn parse_wiktionary_bz2<F>(path: &Path, emit: F) -> Result<ParseStats, String>
where
    F: FnMut(LexicalRecord) -> Result<(), String>,
{
    let file = File::open(path).map_err(|error| error.to_string())?;
    parse_wiktionary_xml_reader(BufReader::new(BzDecoder::new(file)), emit)
}

fn parse_wiktionary_xml_reader<R, F>(reader: R, mut emit: F) -> Result<ParseStats, String>
where
    R: BufRead,
    F: FnMut(LexicalRecord) -> Result<(), String>,
{
    let mut xml = Reader::from_reader(reader);
    xml.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut stats = ParseStats::default();
    let mut capture_title = false;
    let mut capture_text = false;
    let mut title = String::new();
    let mut page_text = String::new();

    loop {
        match xml.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => match event.name().as_ref() {
                b"title" => {
                    capture_title = true;
                    title.clear();
                }
                b"text" => {
                    capture_text = true;
                    page_text.clear();
                }
                _ => {}
            },
            Ok(Event::Text(text)) => {
                let decoded = text.decode().map_err(|error| error.to_string())?;
                let unescaped = quick_xml::escape::unescape(&decoded)
                    .map_err(|error| error.to_string())?;
                if capture_title {
                    title.push_str(&unescaped);
                }
                if capture_text {
                    page_text.push_str(&unescaped);
                }
            }
            Ok(Event::CData(text)) if capture_text => {
                page_text.push_str(&text.decode().map_err(|error| error.to_string())?);
            }
            Ok(Event::End(event)) => match event.name().as_ref() {
                b"title" => capture_title = false,
                b"text" => capture_text = false,
                b"page" => {
                    stats.processed += 1;
                    for record in wiktionary_page_records(&title, &page_text, stats.processed) {
                        emit(record)?;
                    }
                    title.clear();
                    page_text.clear();
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("Wiktionary XML parse failed: {error}")),
            _ => {}
        }
        buffer.clear();
    }
    Ok(stats)
}

fn wiktionary_page_records(title: &str, text: &str, page_number: u64) -> Vec<LexicalRecord> {
    let lower = text.to_lowercase();
    if !(lower.contains("português") || lower.contains("{{-pt-") || lower.contains("{{pt}}")) {
        return Vec::new();
    }
    let definition = text
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with('#') && !line.starts_with("#:") && !line.starts_with("#*"))
        .map(|line| strip_wiki_markup(line.trim_start_matches('#').trim()));
    let part_of_speech = if lower.contains("substantivo") {
        "noun"
    } else if lower.contains("adjetivo") {
        "adjective"
    } else if lower.contains("verbo") {
        "verb"
    } else {
        ""
    };
    extract_translation_templates(text, "es")
        .into_iter()
        .map(|translation| LexicalRecord {
            source_term: title.to_string(),
            source_language: "pt",
            target_term: translation,
            target_language: "es",
            part_of_speech: part_of_speech.to_string(),
            definition: definition.clone(),
            context: String::new(),
            locale: if lower.contains("brasil") { "pt-BR".to_string() } else { String::new() },
            variants: Vec::new(),
            relations: Vec::new(),
            common_score: if lower.contains("brasil") { 88 } else { 78 },
            external_reference: format!("page:{page_number}"),
        })
        .collect()
}

fn extract_translation_templates(text: &str, language: &str) -> Vec<String> {
    let mut translations = BTreeSet::new();
    let mut remaining = text;
    while let Some(start) = remaining.find("{{") {
        remaining = &remaining[start + 2..];
        let Some(end) = remaining.find("}}") else {
            break;
        };
        let template = &remaining[..end];
        let parts = template.split('|').map(str::trim).collect::<Vec<_>>();
        if parts.len() >= 3 {
            let kind = parts[0].to_lowercase();
            let lang = parts[1].to_lowercase();
            if matches!(kind.as_str(), "t" | "t+" | "trad" | "trad+") && lang == language {
                let value = clean_term(parts[2]);
                if !value.is_empty() {
                    translations.insert(value);
                }
            }
        }
        remaining = &remaining[end + 2..];
    }
    translations.into_iter().collect()
}

fn parse_freedict_archive<F>(path: &Path, mut emit: F) -> Result<ParseStats, String>
where
    F: FnMut(LexicalRecord) -> Result<(), String>,
{
    let file = File::open(path).map_err(|error| error.to_string())?;
    let decoder = XzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let mut ifo = Vec::new();
    let mut index = Vec::new();
    let mut dictionary = Vec::new();
    let mut index_gz = false;
    let mut dictionary_gz = false;
    for entry in archive.entries().map_err(|error| error.to_string())? {
        let mut entry = entry.map_err(|error| error.to_string())?;
        let name = entry
            .path()
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .to_lowercase();
        if name.ends_with(".ifo") {
            entry.read_to_end(&mut ifo).map_err(|error| error.to_string())?;
        } else if name.ends_with(".idx.gz") || name.ends_with(".idx") {
            index_gz = name.ends_with(".gz");
            entry.read_to_end(&mut index).map_err(|error| error.to_string())?;
        } else if name.ends_with(".dict.dz") || name.ends_with(".dict") {
            dictionary_gz = name.ends_with(".dz");
            entry
                .read_to_end(&mut dictionary)
                .map_err(|error| error.to_string())?;
        }
    }
    if ifo.is_empty() || index.is_empty() || dictionary.is_empty() {
        return Err("FreeDict archive is missing .ifo, .idx(.gz), or .dict(.dz)".to_string());
    }
    let index = if index_gz {
        read_all(GzDecoder::new(Cursor::new(index)))?
    } else {
        index
    };
    let dictionary = if dictionary_gz {
        read_all(GzDecoder::new(Cursor::new(dictionary)))?
    } else {
        dictionary
    };
    let ifo_text = String::from_utf8_lossy(&ifo);
    let offset_64 = ifo_text.contains("idxoffsetbits=64");
    let mut cursor = 0usize;
    let mut stats = ParseStats::default();
    while cursor < index.len() {
        let Some(null_offset) = index[cursor..].iter().position(|byte| *byte == 0) else {
            stats.errors += 1;
            break;
        };
        let word_end = cursor + null_offset;
        let word = String::from_utf8_lossy(&index[cursor..word_end]).into_owned();
        cursor = word_end + 1;
        let offset_size = if offset_64 { 8 } else { 4 };
        if cursor + offset_size + 4 > index.len() {
            stats.errors += 1;
            break;
        }
        let offset = if offset_64 {
            u64::from_be_bytes(index[cursor..cursor + 8].try_into().unwrap())
        } else {
            u32::from_be_bytes(index[cursor..cursor + 4].try_into().unwrap()) as u64
        };
        cursor += offset_size;
        let size = u32::from_be_bytes(index[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        stats.processed += 1;
        let offset = offset as usize;
        if offset + size > dictionary.len() {
            stats.errors += 1;
            continue;
        }
        let html = String::from_utf8_lossy(&dictionary[offset..offset + size]);
        let part_of_speech = extract_html_grammar(&html);
        let translations = extract_html_list_items(&html);
        for translation in translations {
            emit(LexicalRecord {
                source_term: word.clone(),
                source_language: "pt",
                target_term: translation,
                target_language: "es",
                part_of_speech: part_of_speech.clone(),
                definition: None,
                context: String::new(),
                locale: String::new(),
                variants: Vec::new(),
                relations: Vec::new(),
                common_score: 72,
                external_reference: format!("stardict:{}", stats.processed),
            })?;
        }
    }
    Ok(stats)
}

fn read_all<R: Read>(mut reader: R) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes)
}

fn extract_html_grammar(html: &str) -> String {
    let Some(class_start) = html.find("class=\"grammar\"") else {
        return String::new();
    };
    let tail = &html[class_start..];
    let Some(content_start) = tail.find('>') else {
        return String::new();
    };
    let content = &tail[content_start + 1..];
    let Some(content_end) = content.find("</font>") else {
        return String::new();
    };
    strip_html(&content[..content_end])
}

fn extract_html_list_items(html: &str) -> Vec<String> {
    let mut items = BTreeSet::new();
    let mut remaining = html;
    while let Some(start) = remaining.find("<li>") {
        remaining = &remaining[start + 4..];
        let Some(end) = remaining.find("</li>") else {
            break;
        };
        let item = clean_term(&strip_html(&remaining[..end]));
        if !item.is_empty() {
            items.insert(item);
        }
        remaining = &remaining[end + 5..];
    }
    if items.is_empty() {
        let fallback = clean_term(&strip_html(html));
        if !fallback.is_empty() {
            items.insert(fallback);
        }
    }
    items.into_iter().collect()
}

fn strip_html(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                output.push(' ');
            }
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    decode_entities(&output)
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn strip_wiki_markup(value: &str) -> String {
    value
        .replace("'''", "")
        .replace("''", "")
        .replace("[[", "")
        .replace("]]", "")
        .split("{{")
        .next()
        .unwrap_or(value)
        .trim()
        .to_string()
}

fn clean_term(value: &str) -> String {
    value
        .replace(['\n', '\r', '\t'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|character: char| {
            character.is_whitespace()
                || matches!(character, ',' | ';' | ':' | '/' | '|' | '·')
        })
        .to_string()
}

fn normalize(value: &str) -> String {
    value
        .nfkc()
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn search_key(value: &str) -> String {
    normalize(value)
        .nfkd()
        .filter(|character| !is_combining_mark(*character))
        .map(|character| {
            if character.is_alphanumeric() || character.is_whitespace() || character == '-' {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_part_of_speech(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "n" | "noun" | "substantivo" => "noun",
        "adj" | "adjective" | "adjetivo" => "adjective",
        "vblex" | "vbser" | "vbhaver" | "verb" | "verbo" => "verb",
        "adv" | "adverb" | "advérbio" => "adverb",
        "pr" | "preposition" | "preposição" => "preposition",
        "np" | "proper-noun" => "proper noun",
        other => other,
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temporary_fixture_path(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("portuwana-{name}-{}-{unique}", std::process::id()))
    }

    #[test]
    fn normalizes_accents_without_destroying_original_form() {
        assert_eq!(normalize("  OlÁ  "), "olá");
        assert_eq!(search_key("Olá, BAGAGEM!"), "ola bagagem");
    }

    #[test]
    fn parses_apertium_pairs_and_generates_locale_metadata() {
        let xml = r#"<dictionary><section><e v="br"><p><l>equipaje<s n="n"/></l><r>bagagem<s n="n"/></r></p></e><e><i>hotel<s n="n"/></i></e></section></dictionary>"#;
        let mut records = Vec::new();
        let stats = parse_apertium_reader(
            BufReader::new(Cursor::new(xml.as_bytes())),
            "es",
            "pt",
            &mut |record| {
                records.push(record);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(stats.processed, 2);
        assert_eq!(records[0].source_term, "equipaje");
        assert_eq!(records[0].target_term, "bagagem");
        assert_eq!(records[0].locale, "pt-BR");
        assert_eq!(records[1].source_term, "hotel");
    }

    #[test]
    fn parses_wiktextract_jsonl_with_multiple_senses_and_inverse_ready_pairs() {
        let jsonl = r#"{"word":"maleta","lang_code":"es","pos":"noun","senses":[{"glosses":["Equipaje de viaje"]},{"glosses":["Otro sentido"]}],"translations":[{"word":"mala","lang_code":"pt","sense":"viaje"}],"forms":[{"form":"maletas"}],"synonyms":[{"word":"valija"}]}"#;
        let mut records = Vec::new();
        let stats = parse_wiktextract_reader(
            BufReader::new(Cursor::new(jsonl.as_bytes())),
            |record| {
                records.push(record);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(stats.errors, 0);
        assert_eq!(records[0].source_term, "maleta");
        assert_eq!(records[0].target_term, "mala");
        assert_eq!(records[0].definition.as_deref(), Some("Equipaje de viaje"));
        assert_eq!(records[0].relations, vec!["valija"]);
    }

    #[test]
    fn parses_wiktionary_portuguese_xml_translation_templates() {
        let xml = r#"<mediawiki><page><title>bagagem</title><revision><text xml:space="preserve"><![CDATA[== Português ==
=== Substantivo ===
# Conjunto de malas de uma viagem.
{{trad|es|equipaje}}
{{t+|es|maleta}}]]></text></revision></page></mediawiki>"#;
        let mut records = Vec::new();
        let stats = parse_wiktionary_xml_reader(
            BufReader::new(Cursor::new(xml.as_bytes())),
            |record| {
                records.push(record);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(stats.processed, 1);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].source_language, "pt");
        assert_eq!(records[0].part_of_speech, "noun");
    }

    #[test]
    fn parses_freedict_html_items() {
        let html = r#"<div><font class="grammar" color="green">noun</font><ol><li><div>equipaje</div></li><li><div>maleta</div></li></ol></div>"#;
        assert_eq!(extract_html_grammar(html), "noun");
        assert_eq!(extract_html_list_items(html), vec!["equipaje", "maleta"]);
    }

    #[test]
    fn gzip_jsonl_fixture_is_streamed() {
        let jsonl = r#"{"word":"hola","lang_code":"es","translations":[{"word":"olá","lang_code":"pt"}]}
"#;
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(jsonl.as_bytes()).unwrap();
        let compressed = encoder.finish().unwrap();
        let mut records = Vec::new();
        parse_wiktextract_reader(BufReader::new(GzDecoder::new(Cursor::new(compressed))), |record| {
            records.push(record);
            Ok(())
        })
        .unwrap();
        assert_eq!(records[0].target_term, "olá");
    }

    #[test]
    fn bzip2_wiktionary_fixture_is_streamed() {
        let xml = r#"<mediawiki><page><title>olá</title><revision><text><![CDATA[== Português ==
# Saudação.
{{trad|es|hola}}]]></text></revision></page></mediawiki>"#;
        let fixture = temporary_fixture_path("wiktionary.xml.bz2");
        {
            let file = File::create(&fixture).unwrap();
            let mut encoder = bzip2::write::BzEncoder::new(file, bzip2::Compression::fast());
            encoder.write_all(xml.as_bytes()).unwrap();
            encoder.finish().unwrap();
        }
        let mut records = Vec::new();
        parse_wiktionary_bz2(&fixture, |record| {
            records.push(record);
            Ok(())
        })
        .unwrap();
        std::fs::remove_file(&fixture).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].target_term, "hola");
    }

    #[test]
    fn zip_apertium_fixture_is_inspected_and_imported() {
        let xml = r#"<dictionary><section><e><p><l>hola<s n="n"/></l><r>olá<s n="n"/></r></p></e></section></dictionary>"#;
        let fixture = temporary_fixture_path("apertium.zip");
        {
            let file = File::create(&fixture).unwrap();
            let mut archive = zip::ZipWriter::new(file);
            archive
                .start_file(
                    "sample/apertium-sample.es-pt.dix",
                    zip::write::SimpleFileOptions::default(),
                )
                .unwrap();
            archive.write_all(xml.as_bytes()).unwrap();
            archive.finish().unwrap();
        }
        assert!(inspect_apertium_zip(&fixture));
        let mut records = Vec::new();
        parse_apertium_zip(&fixture, |record| {
            records.push(record);
            Ok(())
        })
        .unwrap();
        std::fs::remove_file(&fixture).unwrap();
        assert_eq!(records[0].source_term, "hola");
        assert_eq!(records[0].target_term, "olá");
    }

    #[test]
    fn tar_xz_freedict_fixture_is_inspected_and_imported() {
        let html = br#"<div><font class="grammar">noun</font><ol><li><div>equipaje</div></li></ol></div>"#;
        let mut index = b"bagagem\0".to_vec();
        index.extend_from_slice(&0u32.to_be_bytes());
        index.extend_from_slice(&(html.len() as u32).to_be_bytes());
        let mut index_encoder =
            flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        index_encoder.write_all(&index).unwrap();
        let compressed_index = index_encoder.finish().unwrap();
        let fixture = temporary_fixture_path("freedict.tar.xz");
        {
            let file = File::create(&fixture).unwrap();
            let xz = xz2::write::XzEncoder::new(file, 1);
            let mut archive = tar::Builder::new(xz);
            append_tar_fixture(
                &mut archive,
                "mini/mini.ifo",
                b"StarDict's dict ifo file\nversion=3.0.0\nwordcount=1\nsametypesequence=h\n",
            );
            append_tar_fixture(&mut archive, "mini/mini.idx.gz", &compressed_index);
            append_tar_fixture(&mut archive, "mini/mini.dict", html);
            let xz = archive.into_inner().unwrap();
            xz.finish().unwrap();
        }
        assert!(inspect_freedict_archive(&fixture));
        let mut records = Vec::new();
        parse_freedict_archive(&fixture, |record| {
            records.push(record);
            Ok(())
        })
        .unwrap();
        std::fs::remove_file(&fixture).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].source_term, "bagagem");
        assert_eq!(records[0].target_term, "equipaje");
    }

    fn append_tar_fixture<W: Write>(archive: &mut tar::Builder<W>, path: &str, bytes: &[u8]) {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        archive.append_data(&mut header, path, Cursor::new(bytes)).unwrap();
    }
}
