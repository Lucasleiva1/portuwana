import type { StateValue } from "xstate";
import type {
  MicrophonePermissionState,
  NoSpeechReason,
  RecordedAudio,
} from "../audio/audio.types";
import type { IntentProvider, IntentResult } from "../conversation/IntentProvider";
import type { DialogueNode, HelpKind, HelpLevel, Lesson, LessonResolution, TurnHelpUsage } from "../lesson/lesson.types";
import type { SuccessfulTranscriptResult } from "../schemas";

export type ConversationFeedback = "understood" | "not-understood" | null;

export interface ConversationMachineInput {
  lesson: unknown;
  intentProvider: IntentProvider;
  initialPower?: number | undefined;
  timing?: {
    processingMs: number;
    feedbackMs: number;
  } | undefined;
}

export interface ConversationContext {
  lessonSource: unknown;
  intentProvider: IntentProvider;
  initialPower: number;
  processingDelayMs: number;
  feedbackDelayMs: number;
  engine: import("../lesson/LessonEngine").LessonEngine | null;
  lesson: Lesson | null;
  lessonId: string | null;
  currentNode: DialogueNode | null;
  currentNodeId: string | null;
  currentTurn: number;
  totalTurns: number;
  lastUserText: string | null;
  lastIntent: string | null;
  lastIntentResult: IntentResult | null;
  lastResolution: LessonResolution | null;
  helpUsage: TurnHelpUsage;
  availableHelpLevel: HelpLevel;
  helpOpen: boolean;
  helpMessage: string | null;
  showTranslation: boolean;
  slowMode: boolean;
  feedback: ConversationFeedback;
  power: number;
  forceUnknownIntent: boolean;
  microphonePermission: MicrophonePermissionState;
  audioError: string | null;
  sttErrorCode: string | null;
  lastRecordedAudio: RecordedAudio | null;
  lastTranscript: SuccessfulTranscriptResult | null;
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
  | { type: "INTENT_RESOLVED"; result: IntentResult }
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
  | { type: "PRONUNCIATION_READY" }
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
