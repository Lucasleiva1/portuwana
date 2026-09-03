import { describe, expect, it, vi } from "vitest";
import type { NpcLine } from "../src/lesson/lesson.types";
import { NpcSpeechService } from "../src/speech/playback/NpcSpeechService";
import type {
  ProviderAvailability,
  TTSInput,
  TTSProvider,
  TTSResult,
} from "../src/speech/providers/types";
import { airportAgentVoice } from "../src/speech/voice/airportAgent.voice";

const line: NpcLine = {
  id: "test-line",
  speaker: "Funcionária",
  text: "Olá",
};

class ReadyTts implements TTSProvider {
  readonly id = "test-tts";
  readonly synthesize = vi.fn(async (_input: TTSInput): Promise<TTSResult> => ({
    status: "success",
    audio: new Uint8Array([1, 2, 3]),
    mimeType: "audio/wav",
  }));

  getStatus(): ProviderAvailability {
    return { status: "ready" };
  }
}

describe("NpcSpeechService", () => {
  it("prioritizes a local asset over configured TTS", async () => {
    const tts = new ReadyTts();
    const service = new NpcSpeechService({ ttsProvider: tts, voice: airportAgentVoice });
    const plan = await service.resolve({
      ...line,
      audioAsset: "/assets/audio/airport/01-welcome.wav",
    });

    expect(plan.mode).toBe("audio");
    expect(plan.mode === "audio" && plan.source).toBe("local");
    expect(tts.synthesize).not.toHaveBeenCalled();
  });

  it("falls back to text when neither local audio nor TTS is configured", async () => {
    const plan = await new NpcSpeechService({ voice: airportAgentVoice }).resolve(line);
    expect(plan.mode).toBe("textOnly");
  });

  it("uses configured TTS without inventing a voice id", async () => {
    const tts = new ReadyTts();
    const plan = await new NpcSpeechService({
      ttsProvider: tts,
      voice: airportAgentVoice,
    }).resolve(line, true);

    expect(plan.mode).toBe("audio");
    expect(plan.mode === "audio" && plan.source).toBe("tts");
    expect(tts.synthesize).toHaveBeenCalledWith({
      text: "Olá",
      locale: "pt-BR",
      rate: 0.82,
    });
  });

  it("uses a prepared slow asset before TTS", async () => {
    const tts = new ReadyTts();
    const plan = await new NpcSpeechService({
      ttsProvider: tts,
      voice: airportAgentVoice,
    }).resolve(
      {
        ...line,
        audioAsset: "/normal.wav",
        slowAudioAsset: "/slow.wav",
      },
      true,
    );
    expect(plan.mode === "audio" && plan.source === "local" && plan.url).toBe(
      "/slow.wav",
    );
    expect(tts.synthesize).not.toHaveBeenCalled();
  });

  it("moderately slows a normal local asset when no TTS is available", async () => {
    const plan = await new NpcSpeechService({ voice: airportAgentVoice }).resolve(
      { ...line, audioAsset: "/normal.wav" },
      true,
    );
    expect(plan.mode === "audio" && plan.playbackRate).toBe(0.82);
  });

  it("reuses cached TTS audio for replay", async () => {
    const tts = new ReadyTts();
    const service = new NpcSpeechService({
      ttsProvider: tts,
      voice: airportAgentVoice,
    });
    const first = await service.resolve(line);
    const replay = await service.resolve(line);

    expect(first.mode === "audio" && first.cacheHit).toBe(false);
    expect(replay.mode === "audio" && replay.cacheHit).toBe(true);
    expect(tts.synthesize).toHaveBeenCalledTimes(1);
  });
});
