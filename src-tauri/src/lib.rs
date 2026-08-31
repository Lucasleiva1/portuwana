use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

mod whisper;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_technical_status",
        sql: include_str!("../migrations/0001_technical_status.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .manage(whisper::WhisperSidecarService::default())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:portuwana.db", migrations)
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.center()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            whisper::whisper_status,
            whisper::whisper_transcribe,
            whisper::whisper_cancel
        ])
        .run(tauri::generate_context!())
        .expect("failed to run PORTUWANA");
}
