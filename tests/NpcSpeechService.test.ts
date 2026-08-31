import { describe, expect, it, vi } from "vitest";
import type { DialogueNode } from "../src/lesson/lesson.types";
import { NpcSpeechService } from "../src/speech/playback/NpcSpeechService";
import type {
  ProviderAvailability,
  TTSInput,
  TTSProvider,
  TTSResult,
} from "../src/speech/providers/types";
import { airportAgentVoice } from "../src/speech/voice/airportAgent.voice";

const node: DialogueNode = {
  id: "test",
  speaker: "Funcionária",
  text: "Olá",
  acceptedIntents: [],
  transitions: {},
  terminal: true,
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
      ...node,
      audioAsset: "/assets/audio/airport/01-welcome.wav",
    });

    expect(plan.mode).toBe("audio");
    expect(plan.mode === "audio" && plan.source).toBe("local");
    expect(tts.synthesize).not.toHaveBeenCalled();
  });

  it("falls back to text when neither local audio nor TTS is configured", async () => {
    const plan = await new NpcSpeechService({ voice: airportAgentVoice }).resolve(node);
    expect(plan.mode).toBe("textOnly");
  });

  it("uses configured TTS without inventing a voice id", async () => {
    const tts = new ReadyTts();
    const plan = await new NpcSpeechService({
      ttsProvider: tts,
      voice: airportAgentVoice,
    }).resolve(node, true);

    expect(plan.mode).toBe("audio");
    expect(plan.mode === "audio" && plan.source).toBe("tts");
    expect(tts.synthesize).toHaveBeenCalledWith({
      text: "Olá",
      locale: "pt-BR",
      rate: 0.82,
    });
  });
});
