import { describe, expect, it } from "vitest";
import { getBackgroundMotionFrame } from "../src/scene/airport/backgroundMotion";

describe("airport background state motion", () => {
  const hold = 4_800;
  const transition = 1_200;
  const segment = hold + transition;

  it("holds the original frame before dissolving to state B", () => {
    expect(getBackgroundMotionFrame(2_000, 3, hold, transition)).toEqual({
      alphas: [1, 0, 0],
      stateIndex: 0,
      transitioning: false,
    });

    const midpoint = getBackgroundMotionFrame(
      hold + transition / 2,
      3,
      hold,
      transition,
    );
    expect(midpoint.alphas[0]).toBeCloseTo(0.5, 5);
    expect(midpoint.alphas[1]).toBeCloseTo(0.5, 5);
    expect(midpoint.transitioning).toBe(true);
  });

  it("advances B to C and loops C back to the original", () => {
    expect(getBackgroundMotionFrame(segment, 3, hold, transition).alphas).toEqual([
      0, 1, 0,
    ]);
    expect(
      getBackgroundMotionFrame(segment * 2, 3, hold, transition).alphas,
    ).toEqual([0, 0, 1]);
    expect(
      getBackgroundMotionFrame(segment * 3, 3, hold, transition).alphas,
    ).toEqual([1, 0, 0]);
  });

  it("fails closed to one static state", () => {
    expect(getBackgroundMotionFrame(9_000, 0, hold, transition)).toEqual({
      alphas: [1],
      stateIndex: 0,
      transitioning: false,
    });
  });
});
