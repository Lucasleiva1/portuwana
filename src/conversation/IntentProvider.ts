import type { LessonLocale } from "../lesson/lesson.types";

export interface IntentInput {
  text: string;
  locale: LessonLocale;
  allowedIntents: readonly string[];
}

export interface IntentResult {
  intent: string;
  understood: boolean;
  confidence: number;
}

export interface IntentProvider {
  analyze(input: IntentInput): Promise<IntentResult>;
}
