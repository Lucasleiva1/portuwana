import { describe, expect, it } from "vitest";
import { deriveSpeakButtonPresentation } from "../src/components/controls/SpeakButton";

describe("conversation button states", () => {
  it("enables Falar only while waiting for the user", () => {
    expect(deriveSpeakButtonPresentation("waitingForUser")).toEqual({
      state: "idle",
      label: "Falar",
      disabled: false,
    });
    expect(deriveSpeakButtonPresentation("npcSpeaking").disabled).toBe(true);
  });

  it("exposes real listening, recording and processing states", () => {
    expect(deriveSpeakButtonPresentation("listening")).toEqual({
      state: "listening",
      label: "Escutando…",
      disabled: true,
    });
    expect(deriveSpeakButtonPresentation("recording")).toEqual({
      state: "recording",
      label: "Falando…",
      disabled: true,
    });
    expect(deriveSpeakButtonPresentation("processingAudio").state).toBe(
      "processing",
    );
    expect(deriveSpeakButtonPresentation("analyzingIntent").state).toBe(
      "processing",
    );
    expect(deriveSpeakButtonPresentation("transcribing")).toEqual({
      state: "processing",
      label: "Entendendo…",
      disabled: true,
    });
  });
});
