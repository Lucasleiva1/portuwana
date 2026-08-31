import type { AudioPayload } from "../speech/providers/types";
import type { RecordedAudio } from "../audio/audio.types";
import { WavEncoder } from "../audio/WavEncoder";

export function createSilentAudio(
  durationMs = 100,
  sampleRate = 16_000,
): AudioPayload {
  const sampleCount = Math.round((durationMs / 1_000) * sampleRate);

  return {
    samples: new Float32Array(sampleCount),
    sampleRate,
    channels: 1,
  };
}

export function createSilentRecording(durationMs = 100): RecordedAudio {
  const sampleRate = 16_000;
  const pcm = new Float32Array(
    Math.max(1, Math.round((durationMs / 1_000) * sampleRate)),
  );
  return {
    pcm,
    sampleRate,
    durationMs: (pcm.length / sampleRate) * 1_000,
    wavBlob: WavEncoder.encode(pcm, sampleRate),
  };
}
