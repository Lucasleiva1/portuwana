export type LessonLocale = "pt-BR";
export type LessonLevel = "A1";
export type HelpLevel = 1 | 2 | 3 | 4;
export type HelpKind = "replay" | "slower" | "hint" | "translation" | "example";
export type LessonExpression =
  | "neutral"
  | "smile"
  | "confused"
  | "surprised"
  | "serious";

export interface VocabularyItem {
  term: string;
  meaning: string;
}

export interface DialogueNode {
  id: string;
  speaker: string;
  text: string;
  audioAsset?: string | undefined;
  slowAudioAsset?: string | undefined;
  translation?: string | undefined;
  slowText?: string | undefined;
  hint?: string | undefined;
  exampleAnswers?: readonly string[] | undefined;
  acceptedIntents: readonly string[];
  transitions: Readonly<Record<string, string>>;
  fallbackNodeId?: string | undefined;
  powerReward?: number | undefined;
  expression?: LessonExpression | undefined;
  terminal?: boolean | undefined;
}

export interface Lesson {
  version: 1;
  id: string;
  title: string;
  locale: LessonLocale;
  level: LessonLevel;
  scene: "airport-arrival";
  startNodeId: string;
  achievements: readonly string[];
  vocabulary: readonly VocabularyItem[];
  nodes: readonly DialogueNode[];
}

export interface TurnHelpUsage {
  replay: number;
  slower: number;
  hint: number;
  translation: number;
  example: number;
  highestLevel: 0 | HelpLevel;
}

export interface LessonHelp {
  kind: HelpKind;
  level: HelpLevel;
  text: string;
}

export type LessonResolutionStatus = "advanced" | "retry" | "unknown";

export interface LessonResolution {
  status: LessonResolutionStatus;
  intent: string;
  fromNodeId: string;
  toNodeId: string;
  reward: number;
  helpUsage: TurnHelpUsage;
}
