import { describe, expect, it } from "vitest";
import { getBackgroundMotionFrame } from "../src/scene/airport/backgroundMotion";

describe("airport background state motion", () => {
  const hold = 4_800;
  const transition = 1_200;
  const segment = hold + transition;

  it("holds the original frame before dissolving to state B", () => {
    expect(getBackgroundMotionFrame(2_000, 6, hold, transition)).toEqual({
      alphas: [1, 0, 0, 0, 0, 0],
      stateIndex: 0,
      transitioning: false,
    });

    const midpoint = getBackgroundMotionFrame(
      hold + transition / 2,
      6,
      hold,
      transition,
    );
    expect(midpoint.alphas[0]).toBeCloseTo(0.5, 5);
    expect(midpoint.alphas[1]).toBeCloseTo(0.5, 5);
    expect(midpoint.transitioning).toBe(true);
  });

  it("advances through B, C, D, E and F before looping", () => {
    for (let stateIndex = 1; stateIndex < 6; stateIndex += 1) {
      const expected = Array.from({ length: 6 }, (_, index) =>
        index === stateIndex ? 1 : 0,
      );
      expect(
        getBackgroundMotionFrame(
          segment * stateIndex,
          6,
          hold,
          transition,
        ).alphas,
      ).toEqual(expected);
    }
    expect(
      getBackgroundMotionFrame(segment * 6, 6, hold, transition).alphas,
    ).toEqual([1, 0, 0, 0, 0, 0]);
  });

  it("fails closed to one static state", () => {
    expect(getBackgroundMotionFrame(9_000, 0, hold, transition)).toEqual({
      alphas: [1],
      stateIndex: 0,
      transitioning: false,
    });
  });
});
