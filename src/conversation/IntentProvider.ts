import type { LessonLocale } from "../lesson/lesson.types";

export interface IntentInput {
  text: string;
  locale: LessonLocale;
  allowedIntents: readonly string[];
}

export type IntentUnderstanding =
  | "understood"
  | "partial_match"
  | "ambiguous"
  | "off_topic"
  | "unclear";

export interface IntentResult {
  intent: string;
  status: IntentUnderstanding;
  understood: boolean;
  confidence: number;
  alternatives: readonly string[];
}

export interface IntentProvider {
  analyze(input: IntentInput): Promise<IntentResult>;
}
