export type MicrophonePermissionState =
  | "unknown"
  | "requesting"
  | "granted"
  | "denied"
  | "unavailable"
  | "error";

export type AudioCaptureState =
  | "idle"
  | "requesting"
  | "listening"
  | "recording"
  | "processing";

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  isDefault: boolean;
}

export interface RecordedAudio {
  pcm: Float32Array;
  sampleRate: number;
  durationMs: number;
  wavBlob: Blob;
}

export interface AudioTimeoutConfig {
  maxWaitForSpeechMs: number;
  maxRecordingMs: number;
}

export const defaultAudioTimeouts: AudioTimeoutConfig = Object.freeze({
  maxWaitForSpeechMs: 8_000,
  maxRecordingMs: 20_000,
});

export type NoSpeechReason = "wait-timeout" | "recording-timeout" | "misfire";

export type AudioEngineErrorCode =
  | "permission-denied"
  | "microphone-unavailable"
  | "device-disconnected"
  | "vad-unavailable"
  | "audio-context"
  | "empty-recording"
  | "playback-conflict"
  | "unknown";

export class AudioEngineError extends Error {
  readonly code: AudioEngineErrorCode;
  readonly originalCause: unknown;

  constructor(code: AudioEngineErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "AudioEngineError";
    this.code = code;
    this.originalCause = cause;
  }
}

export interface AudioEngineCallbacks {
  onPermissionChanged?: ((state: MicrophonePermissionState) => void) | undefined;
  onDevicesChanged?: ((devices: readonly AudioInputDevice[]) => void) | undefined;
  onCaptureStateChanged?: ((state: AudioCaptureState) => void) | undefined;
  onLevel?: ((level: number) => void) | undefined;
  onSpeechStart?: (() => void) | undefined;
  onSpeechEnd?: (() => void) | undefined;
  onAudioCaptured?: ((audio: RecordedAudio) => void) | undefined;
  onNoSpeech?: ((reason: NoSpeechReason) => void) | undefined;
  onError?: ((error: AudioEngineError) => void) | undefined;
}
