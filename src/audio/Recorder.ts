import type { RecordedAudio } from "./audio.types";
import { WavEncoder } from "./WavEncoder";

export const whisperSampleRate = 16_000;

export function resampleMono(
  input: Float32Array,
  sourceRate: number,
  targetRate = whisperSampleRate,
): Float32Array {
  if (input.length === 0) {
    return new Float32Array();
  }
  if (sourceRate <= 0 || targetRate <= 0) {
    throw new Error("Audio sample rates must be positive");
  }
  if (sourceRate === targetRate) {
    return input.slice();
  }

  const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;

  if (ratio > 1) {
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const start = outputIndex * ratio;
      const end = Math.min(input.length, (outputIndex + 1) * ratio);
      const firstIndex = Math.floor(start);
      const lastIndex = Math.ceil(end);
      let weightedSum = 0;
      let totalWeight = 0;

      for (let inputIndex = firstIndex; inputIndex < lastIndex; inputIndex += 1) {
        const overlap = Math.max(
          0,
          Math.min(end, inputIndex + 1) - Math.max(start, inputIndex),
        );
        weightedSum += (input[inputIndex] ?? 0) * overlap;
        totalWeight += overlap;
      }
      output[outputIndex] = totalWeight > 0 ? weightedSum / totalWeight : 0;
    }
    return output;
  }

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const position = outputIndex * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[outputIndex] =
      (input[left] ?? 0) * (1 - fraction) + (input[right] ?? 0) * fraction;
  }
  return output;
}

export class Recorder {
  createRecording(pcm: Float32Array, sourceSampleRate: number): RecordedAudio {
    const normalized = resampleMono(pcm, sourceSampleRate, whisperSampleRate);
    if (normalized.length === 0) {
      throw new Error("Cannot create a recording from empty audio");
    }
    const durationMs = normalized.length / whisperSampleRate * 1_000;
    return {
      pcm: normalized,
      sampleRate: whisperSampleRate,
      durationMs,
      wavBlob: WavEncoder.encode(normalized, whisperSampleRate),
    };
  }
}
