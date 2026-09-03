import { describe, expect, it } from "vitest";
import { createSilentAudio, createSilentRecording } from "../src/mocks/audio";
import { MockPronunciationProvider } from "../src/mocks/MockPronunciationProvider";
import { MockSTTProvider } from "../src/mocks/MockSTTProvider";
import { AzurePronunciationProvider } from "../src/speech/azure/AzurePronunciationProvider";
import { AzureTTSProvider } from "../src/speech/azure/AzureTTSProvider";
import { WhisperProvider } from "../src/speech/whisper/WhisperProvider";

describe("unconfigured providers", () => {
  it("returns notConfigured from Whisper", async () => {
    const result = await new WhisperProvider({ tauriAvailable: false }).transcribe(
      createSilentRecording(),
    );
    expect(result.status).toBe("notConfigured");
    expect(result.status === "notConfigured" && result.code).toBe("not-tauri");
  });

  it("returns notConfigured from Azure TTS without credentials", async () => {
    const result = await new AzureTTSProvider().synthesize({
      text: "Olá",
      locale: "pt-BR",
    });
    expect(result.status).toBe("notConfigured");
  });

  it("returns notConfigured from Azure pronunciation", async () => {
    const result = await new AzurePronunciationProvider().assess({
      audio: createSilentAudio(),
      transcript: "Olá",
      locale: "pt-BR",
      mode: "guided-conversation",
    });
    expect(result.status).toBe("notConfigured");
  });

  it("keeps the local mock providers controlled and deterministic", async () => {
    const stt = new MockSTTProvider("Ainda não.");
    expect(await stt.transcribe()).toBe("Ainda não.");
    stt.setResponse("Obrigado.");
    expect(await stt.transcribe()).toBe("Obrigado.");
    expect(
      (
        await new MockPronunciationProvider().assess({
          audio: createSilentAudio(),
          transcript: "Obrigado.",
          locale: "pt-BR",
          mode: "guided-conversation",
        })
      ).status,
    ).toBe("success");
  });
});
