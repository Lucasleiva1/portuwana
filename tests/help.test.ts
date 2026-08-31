import { describe, expect, it } from "vitest";
import {
  createEmptyHelpUsage,
  nextAvailableHelpLevel,
  registerHelpUsage,
} from "../src/lesson/help";

describe("progressive help", () => {
  it("records usage per turn and highest help level", () => {
    const replayed = registerHelpUsage(createEmptyHelpUsage(), "replay");
    const translated = registerHelpUsage(replayed, "translation");

    expect(translated.replay).toBe(1);
    expect(translated.translation).toBe(1);
    expect(translated.highestLevel).toBe(3);
  });

  it("reveals the next tier without exceeding level four", () => {
    expect(nextAvailableHelpLevel(1, "slower")).toBe(2);
    expect(nextAvailableHelpLevel(2, "hint")).toBe(3);
    expect(nextAvailableHelpLevel(4, "example")).toBe(4);
  });
});
