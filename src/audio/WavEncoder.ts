const wavHeaderBytes = 44;

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export class WavEncoder {
  static encodeArrayBuffer(pcm: Float32Array, sampleRate: number): ArrayBuffer {
    if (pcm.length === 0) {
      throw new Error("Cannot encode an empty PCM buffer");
    }
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error("WAV sample rate must be a positive number");
    }

    const bytesPerSample = 2;
    const channels = 1;
    const dataBytes = pcm.length * bytesPerSample;
    const buffer = new ArrayBuffer(wavHeaderBytes + dataBytes);
    const view = new DataView(buffer);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataBytes, true);

    pcm.forEach((sample, index) => {
      const clamped = Math.max(-1, Math.min(1, sample));
      const encoded = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(wavHeaderBytes + index * bytesPerSample, encoded, true);
    });

    return buffer;
  }

  static encode(pcm: Float32Array, sampleRate: number): Blob {
    return new Blob([this.encodeArrayBuffer(pcm, sampleRate)], {
      type: "audio/wav",
    });
  }
}
