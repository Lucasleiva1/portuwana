import { describe, expect, it } from "vitest";
import { AudioSessionCoordinator } from "../src/audio/AudioSessionCoordinator";

describe("AudioSessionCoordinator", () => {
  it("blocks the microphone while the NPC is speaking", () => {
    const coordinator = new AudioSessionCoordinator();
    expect(coordinator.beginNpcPlayback()).toBe(true);
    expect(coordinator.beginListening()).toBe(false);
    expect(coordinator.mode).toBe("npcSpeaking");
  });

  it("blocks NPC playback while the microphone is active", () => {
    const coordinator = new AudioSessionCoordinator();
    expect(coordinator.beginListening()).toBe(true);
    expect(coordinator.beginNpcPlayback()).toBe(false);
    expect(coordinator.markRecording()).toBe(true);
    expect(coordinator.mode).toBe("recording");
    coordinator.markProcessing();
    expect(coordinator.mode).toBe("processing");
    coordinator.finish();
    expect(coordinator.mode).toBe("idle");
  });
});
