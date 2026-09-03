import type { StateValue } from "xstate";
import type {
  MicrophonePermissionState,
  NoSpeechReason,
  RecordedAudio,
} from "../audio/audio.types";
import type { ConversationProvider } from "../conversation/ConversationProvider";
import type { IntentResult } from "../conversation/IntentProvider";
import type {
  ConversationMode,
  DialogueNode,
  HelpKind,
  HelpLevel,
  Lesson,
  LessonResolution,
  NpcLine,
  RecoveryKind,
  TurnHelpUsage,
} from "../lesson/lesson.types";
import type { PronunciationResult, SuccessfulTranscriptResult } from "../schemas";
import type { PortuguesePowerDimensions } from "../lesson/portuguesePower";
import type { PronunciationFeedback } from "../speech/pronunciation/pronunciationFeedback";

export type ConversationFeedback =
  | "understood"
  | "partial_match"
  | "ambiguous"
  | "off_topic"
  | "unclear"
  | null;

export type PronunciationStatus =
  | "idle"
  | "assessing"
  | "ready"
  | "unavailable"
  | "error";

export interface ConversationMachineInput {
  lesson: unknown;
  conversationProvider: ConversationProvider;
  initialPower?: number | undefined;
  timing?: {
    processingMs: number;
    feedbackMs: number;
  } | undefined;
}

export interface ConversationContext {
  lessonSource: unknown;
  conversationProvider: ConversationProvider;
  initialPower: number;
  processingDelayMs: number;
  feedbackDelayMs: number;
  engine: import("../lesson/LessonEngine").LessonEngine | null;
  lesson: Lesson | null;
  lessonId: string | null;
  currentNode: DialogueNode | null;
  currentLine: NpcLine | null;
  currentNodeId: string | null;
  conversationMode: ConversationMode;
  currentTurn: number;
  totalTurns: number;
  lastUserText: string | null;
  lastIntent: string | null;
  lastIntentResult: IntentResult | null;
  lastResolution: LessonResolution | null;
  responseAttempt: number;
  lastRecoveryKind: RecoveryKind | null;
  nextAction: "feedback" | "speak";
  helpUsage: TurnHelpUsage;
  availableHelpLevel: HelpLevel;
  helpOpen: boolean;
  helpMessage: string | null;
  showTranslation: boolean;
  slowMode: boolean;
  feedback: ConversationFeedback;
  power: number;
  powerDimensions: PortuguesePowerDimensions;
  forceUnknownIntent: boolean;
  microphonePermission: MicrophonePermissionState;
  audioError: string | null;
  sttErrorCode: string | null;
  lastRecordedAudio: RecordedAudio | null;
  lastTranscript: SuccessfulTranscriptResult | null;
  pronunciationStatus: PronunciationStatus;
  pronunciationRequestId: string | null;
  pronunciationResult: PronunciationResult | null;
  pronunciationFeedback: PronunciationFeedback | null;
  error: string | null;
}

export type ConversationEvent =
  | { type: "APP_READY" }
  | { type: "LESSON_LOADED"; lesson: unknown }
  | { type: "NPC_FINISHED" }
  | { type: "NPC_AUDIO_START" }
  | { type: "NPC_AUDIO_END" }
  | { type: "NPC_AUDIO_ERROR"; message: string }
  | { type: "START_SPEAKING" }
  | { type: "REQUEST_MICROPHONE" }
  | { type: "MICROPHONE_GRANTED" }
  | { type: "MICROPHONE_DENIED"; message?: string | undefined }
  | { type: "START_LISTENING" }
  | { type: "SPEECH_DETECTED" }
  | { type: "SPEECH_ENDED" }
  | { type: "AUDIO_CAPTURED"; audio: RecordedAudio }
  | { type: "NO_SPEECH"; reason: NoSpeechReason }
  | { type: "CANCEL_RECORDING" }
  | { type: "AUDIO_ERROR"; message: string }
  | { type: "TRANSCRIPTION_STARTED" }
  | { type: "TRANSCRIPTION_SUCCEEDED"; result: SuccessfulTranscriptResult }
  | { type: "TRANSCRIPTION_FAILED"; code: string; message: string }
  | { type: "TRANSCRIPTION_TIMEOUT"; message?: string | undefined }
  | { type: "TRANSCRIPTION_CANCELLED" }
  | { type: "DISMISS_AUDIO_ERROR" }
  | { type: "OPEN_WRITING" }
  | { type: "SUBMIT_TEXT"; text: string }
  | { type: "CANCEL_WRITING" }
  | { type: "RETRY" }
  | { type: "OPEN_HELP" }
  | { type: "CLOSE_HELP" }
  | { type: "USE_HELP"; kind: HelpKind }
  | { type: "REPLAY_NPC"; slow: boolean }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "RESTART" }
  | { type: "COMPLETE" }
  | { type: "FAIL"; error?: string | undefined }
  | { type: "PRONUNCIATION_REQUESTED"; requestId: string }
  | {
      type: "PRONUNCIATION_COMPLETED";
      requestId: string;
      result: Extract<PronunciationResult, { status: "success" }>;
    }
  | {
      type: "PRONUNCIATION_UNAVAILABLE";
      requestId: string;
      result: Extract<PronunciationResult, { status: "notConfigured" }>;
    }
  | { type: "PRONUNCIATION_FAILED"; requestId: string; message: string }
  | { type: "DISMISS_PRONUNCIATION" }
  | { type: "DEV_JUMP_TO_NODE"; nodeId: string }
  | { type: "DEV_FORCE_UNKNOWN"; enabled: boolean }
  | { type: "DEV_SET_POWER"; value: number };

export type ConversationStateName =
  | "booting"
  | "loadingLesson"
  | "npcSpeaking"
  | "waitingForUser"
  | "requestingMicrophone"
  | "listening"
  | "recording"
  | "processingAudio"
  | "audioReady"
  | "writing"
  | "processingResponse"
  | "analyzingIntent"
  | "routingInterpretation"
  | "showingFeedback"
  | "transitioningNode"
  | "transcribing"
  | "pronunciationAssessment"
  | "lessonCompleted"
  | "paused"
  | "error";

export function getConversationStateName(value: StateValue): ConversationStateName {
  if (typeof value === "string") {
    return value as ConversationStateName;
  }

  const active = value.active;
  if (typeof active === "string") {
    return active as ConversationStateName;
  }
  if (active && typeof active === "object") {
    return Object.keys(active)[0] as ConversationStateName;
  }

  return Object.keys(value)[0] as ConversationStateName;
}
