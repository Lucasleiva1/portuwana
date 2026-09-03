export type DictionaryLanguage = "es" | "pt";

export type DictionaryDirection = "auto" | "es-pt" | "pt-es";

export type DictionaryUiState =
  | "idle"
  | "searching"
  | "results"
  | "noResults"
  | "error"
  | "dictionaryNotBuilt";

export interface DictionaryTranslation {
  term: string;
  language: DictionaryLanguage;
  context: string;
  locale: string;
  sources: readonly string[];
  score: number;
}

export interface DictionaryResult {
  id: number | string;
  term: string;
  language: DictionaryLanguage;
  normalized: string;
  partOfSpeech: string;
  definition: string | null;
  translations: readonly DictionaryTranslation[];
  score: number;
}

export interface TranslationOutcome {
  original: string;
  translatedText: string;
  direction: Exclude<DictionaryDirection, "auto">;
  mode: "word" | "phrase";
  primaryResult: DictionaryResult | null;
  unresolvedTerms: readonly string[];
  approximate: boolean;
}

export interface DictionaryHistoryItem {
  id: number;
  term: string;
  direction: DictionaryDirection;
  chosenResult: string | null;
  searchedAt: string;
}

export interface DictionaryFavorite {
  id: number;
  term: string;
  language: DictionaryLanguage;
  primaryTranslation: string;
  createdAt: string;
}

export type DictionarySourceFamily =
  | "wiktionaryPt"
  | "wiktextractEs"
  | "apertium"
  | "freeDict";

export interface DetectedDictionarySource {
  sourceKey: string;
  family: DictionarySourceFamily;
  displayName: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  modifiedAt: string | null;
  format: string;
  licenseLabel: string;
  redistributionNotes: string;
  validation: string;
}

export interface SourceDetectionReport {
  sourcePath: string;
  exists: boolean;
  sources: readonly DetectedDictionarySource[];
  missingFamilies: readonly string[];
}

export interface DictionaryBuildProgress {
  stage: string;
  source: string | null;
  processed: number;
  accepted: number;
  errors: number;
  elapsedMs: number;
}

export interface ImportedSourceReport {
  family: string;
  fileName: string;
  status: string;
  processed: number;
  accepted: number;
  errors: number;
  message: string | null;
}

export interface DictionaryBuildReport {
  buildVersion: string;
  status: string;
  sourcePath: string;
  sources: readonly ImportedSourceReport[];
  termCount: number;
  translationCount: number;
  relationCount: number;
  errorCount: number;
  databaseSizeBytes: number;
  ftsEnabled: boolean;
  elapsedMs: number;
}
