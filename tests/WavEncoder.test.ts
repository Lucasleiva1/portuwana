import { describe, expect, it } from "vitest";
import { WavEncoder } from "../src/audio/WavEncoder";

function ascii(view: DataView, offset: number, length: number): string {
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(offset + index)),
  ).join("");
}

describe("WavEncoder", () => {
  it("writes a mono 16-bit PCM WAV header at 16 kHz", () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buffer = WavEncoder.encodeArrayBuffer(pcm, 16_000);
    const view = new DataView(buffer);

    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(pcm.length * 2);
    expect(buffer.byteLength).toBe(44 + pcm.length * 2);
  });

  it("rejects empty PCM and invalid sample rates", () => {
    expect(() => WavEncoder.encodeArrayBuffer(new Float32Array(), 16_000)).toThrow(
      "empty",
    );
    expect(() =>
      WavEncoder.encodeArrayBuffer(new Float32Array([0]), 0),
    ).toThrow("sample rate");
  });
});
