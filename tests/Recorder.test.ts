import { describe, expect, it } from "vitest";
import { Recorder, resampleMono } from "../src/audio/Recorder";

describe("Recorder", () => {
  it("resamples 48 kHz hardware PCM to mono 16 kHz", () => {
    const source = new Float32Array(48_000).map((_, index) =>
      Math.sin(index / 20),
    );
    const recording = new Recorder().createRecording(source, 48_000);

    expect(recording.sampleRate).toBe(16_000);
    expect(recording.pcm.length).toBe(16_000);
    expect(recording.durationMs).toBeCloseTo(1_000, 3);
    expect(recording.wavBlob.type).toBe("audio/wav");
    expect(recording.wavBlob.size).toBe(44 + 16_000 * 2);
  });

  it("supports upsampling and rejects an empty recording", () => {
    expect(resampleMono(new Float32Array([0, 1]), 8_000)).toHaveLength(4);
    expect(() =>
      new Recorder().createRecording(new Float32Array(), 48_000),
    ).toThrow("empty audio");
  });
});
