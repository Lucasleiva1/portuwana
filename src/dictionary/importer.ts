import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DictionaryBuildProgress,
  DictionaryBuildReport,
  SourceDetectionReport,
} from "./dictionary.types";

export const DEFAULT_DEV_DICTIONARY_SOURCE_PATH = import.meta.env.DEV
  ? "C:\\Users\\jaell\\Desktop\\PORTUWANA_DICTIONARY_SOURCES"
  : "";

export async function detectDictionarySources(
  sourcePath: string,
): Promise<SourceDetectionReport> {
  if (!isTauri()) {
    return {
      sourcePath,
      exists: false,
      sources: [],
      missingFamilies: [
        "wiktionary-pt",
        "wiktextract-es",
        "apertium-es-pt",
        "freedict-pt-es",
      ],
    };
  }
  return invoke<SourceDetectionReport>("dictionary_detect_sources", {
    sourcePath,
  });
}

export async function buildDictionary(
  sourcePath: string,
): Promise<DictionaryBuildReport> {
  if (!isTauri()) {
    throw new Error("El constructor del diccionario sólo está disponible en Tauri DEV.");
  }
  return invoke<DictionaryBuildReport>("dictionary_build", { sourcePath });
}

export async function listenToDictionaryBuild(
  onProgress: (progress: DictionaryBuildProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => undefined;
  }
  return listen<DictionaryBuildProgress>("dictionary-build-progress", (event) => {
    onProgress(event.payload);
  });
}
