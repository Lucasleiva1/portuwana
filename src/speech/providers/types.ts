import type { PronunciationResult, TranscriptResult } from "../../schemas";
import type { RecordedAudio } from "../../audio/audio.types";
import type { ConversationMode } from "../../lesson/lesson.types";

export interface AudioPayload {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
}

export type ProviderAvailability =
  | { status: "ready" }
  | { status: "notConfigured"; reason: string };

export type TTSResult =
  | { status: "success"; audio: Uint8Array; mimeType: string }
  | { status: "notConfigured"; reason: string }
  | { status: "error"; message: string };

export interface TTSInput {
  text: string;
  locale: string;
  voiceId?: string | undefined;
  rate?: number | undefined;
}

export interface PronunciationRequest {
  audio: AudioPayload;
  transcript: string;
  locale: string;
  mode: ConversationMode;
  targetText?: string | undefined;
}

export interface STTOptions {
  language?: "pt" | "es" | "auto" | undefined;
  initialPrompt?: string | undefined;
  contextScope?: string | undefined;
}

export interface STTProvider {
  readonly id: string;
  getStatus(): ProviderAvailability;
  transcribe(audio: RecordedAudio, options?: STTOptions): Promise<TranscriptResult>;
}

export interface TTSProvider {
  readonly id: string;
  getStatus(): ProviderAvailability;
  synthesize(input: TTSInput): Promise<TTSResult>;
}

export interface PronunciationProvider {
  readonly id: string;
  getStatus(): ProviderAvailability;
  assess(request: PronunciationRequest): Promise<PronunciationResult>;
}
