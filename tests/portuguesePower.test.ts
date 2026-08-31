import { describe, expect, it } from "vitest";
import {
  addPortuguesePower,
  clampPortuguesePower,
} from "../src/components/progress/portuguesePower.model";

describe("PortuguesePower", () => {
  it("clamps values to the 0-100 range", () => {
    expect(clampPortuguesePower(-20)).toBe(0);
    expect(clampPortuguesePower(62.4)).toBe(62);
    expect(clampPortuguesePower(140)).toBe(100);
  });

  it("adds power without exceeding 100", () => {
    expect(addPortuguesePower(96, 9)).toBe(100);
    expect(addPortuguesePower(55, 7)).toBe(62);
  });
});
