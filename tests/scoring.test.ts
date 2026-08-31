import { describe, expect, it } from "vitest";
import {
  applyPowerReward,
  calculatePowerReward,
  clampPower,
} from "../src/lesson/scoring";

describe("lesson scoring", () => {
  it.each([
    [0, 8],
    [1, 7],
    [2, 6],
    [3, 4],
    [4, 3],
  ] as const)("awards %i help level correctly", (highestHelpLevel, reward) => {
    expect(
      calculatePowerReward({ status: "advanced", highestHelpLevel }),
    ).toBe(reward);
  });

  it("does not reward retry or unknown results", () => {
    expect(calculatePowerReward({ status: "retry", highestHelpLevel: 0 })).toBe(0);
    expect(calculatePowerReward({ status: "unknown", highestHelpLevel: 0 })).toBe(0);
  });

  it("clamps Portuguese Power to 0–100 and never subtracts", () => {
    expect(clampPower(-10)).toBe(0);
    expect(applyPowerReward(96, 8)).toBe(100);
    expect(applyPowerReward(55, -8)).toBe(55);
  });
});
