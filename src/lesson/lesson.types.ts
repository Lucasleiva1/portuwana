export type LessonLocale = "pt-BR";
export type LessonLevel = "A1";
export type HelpLevel = 1 | 2 | 3 | 4;
export type HelpKind = "replay" | "slower" | "hint" | "translation" | "example";
export type ConversationMode = "guided-conversation" | "guided-practice";
export type RecoveryKind =
  | "unclear"
  | "partial_match"
  | "ambiguous"
  | "off_topic"
  | "silence";
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

export interface NpcLine {
  id: string;
  speaker: string;
  text: string;
  audioAsset?: string | undefined;
  slowAudioAsset?: string | undefined;
  translation?: string | undefined;
  slowText?: string | undefined;
  expression?: LessonExpression | undefined;
  emotion?: "neutral" | "warm" | "reassuring" | "focused" | undefined;
  durationMs?: number | undefined;
}

export interface DialogueNode {
  id: string;
  lineIds: readonly string[];
  hint?: string | undefined;
  exampleAnswers?: readonly string[] | undefined;
  acceptedIntents: readonly string[];
  transitions: Readonly<Record<string, string>>;
  fallbackNodeId?: string | undefined;
  powerReward?: number | undefined;
  mode?: ConversationMode | undefined;
  targetPhrase?: string | undefined;
  terminal?: boolean | undefined;
}

export interface Lesson {
  version: 2;
  id: string;
  title: string;
  locale: LessonLocale;
  level: LessonLevel;
  scene: "airport-arrival";
  defaultMode: ConversationMode;
  startNodeId: string;
  achievements: readonly string[];
  vocabulary: readonly VocabularyItem[];
  lines: readonly NpcLine[];
  recoveryLineIds: Readonly<Record<RecoveryKind, readonly string[]>>;
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
