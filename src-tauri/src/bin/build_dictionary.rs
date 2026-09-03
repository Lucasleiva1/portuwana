use std::{env, path::PathBuf, process::ExitCode};

fn main() -> ExitCode {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    if arguments.len() != 2 {
        eprintln!("Usage: build_dictionary <sources-folder> <portuwana-db-path>");
        return ExitCode::from(2);
    }
    let sources_path = PathBuf::from(&arguments[0]);
    let database_path = PathBuf::from(&arguments[1]);
    match portuwana_lib::dictionary::build_dictionary_at(database_path, sources_path) {
        Ok(report) => match serde_json::to_string_pretty(&report) {
            Ok(json) => {
                println!("{json}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("Could not serialize build report: {error}");
                ExitCode::from(1)
            }
        },
        Err(error) => {
            eprintln!("Dictionary build failed: {error}");
            ExitCode::from(1)
        }
    }
}
