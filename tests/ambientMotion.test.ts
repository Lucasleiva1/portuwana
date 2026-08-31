import { describe, expect, it } from "vitest";
import { getAmbientMotionFrame } from "../src/scene/airport/ambientMotion";

describe("airport ambient motion", () => {
  const duration = 12_000;

  it("fades in, holds and fades out without moving while visible", () => {
    expect(getAmbientMotionFrame(0, 0, 3, duration)).toEqual({
      alpha: 0,
      locationIndex: 0,
    });
    expect(getAmbientMotionFrame(2_400, 0, 3, duration)).toEqual({
      alpha: 1,
      locationIndex: 0,
    });

    const fading = getAmbientMotionFrame(7_920, 0, 3, duration);
    expect(fading.locationIndex).toBe(0);
    expect(fading.alpha).toBeCloseTo(0.5, 5);

    expect(getAmbientMotionFrame(9_600, 0, 3, duration)).toEqual({
      alpha: 0,
      locationIndex: 0,
    });
  });

  it("changes position only at the start of an invisible cycle", () => {
    expect(getAmbientMotionFrame(duration, 0, 3, duration)).toEqual({
      alpha: 0,
      locationIndex: 1,
    });
    expect(getAmbientMotionFrame(duration * 3, 0, 3, duration)).toEqual({
      alpha: 0,
      locationIndex: 0,
    });
  });

  it("fails closed when the configuration is invalid", () => {
    expect(getAmbientMotionFrame(4_000, 0, 0, duration)).toEqual({
      alpha: 0,
      locationIndex: 0,
    });
  });
});
