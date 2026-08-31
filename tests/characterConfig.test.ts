import { describe, expect, it } from "vitest";
import { airportAgentConfig } from "../src/scene/character/airportAgent.config";

describe("airport agent configuration", () => {
  it("uses normalized anchors and an explicit logical viewport", () => {
    expect(airportAgentConfig.anchor.x).toBeGreaterThanOrEqual(0);
    expect(airportAgentConfig.anchor.x).toBeLessThanOrEqual(1);
    expect(airportAgentConfig.anchor.y).toBe(1);
    expect(airportAgentConfig.logicalViewport).toEqual({
      width: 1600,
      height: 900,
    });
    expect(airportAgentConfig.baseScale).toBeGreaterThan(0);
  });

  it("registers the calibrated blink overlay on the source canvas", () => {
    expect(airportAgentConfig.expressionMode).toBe("full-frame");
    expect(airportAgentConfig.eyesTransform.closed).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    });
    expect(airportAgentConfig.overlayCalibration).toEqual({
      eyes: true,
      mouth: false,
    });
  });

  it("keeps every overlay transform finite and positively scaled", () => {
    const transforms = [
      ...Object.values(airportAgentConfig.eyesTransform),
      ...Object.values(airportAgentConfig.mouthTransform),
    ];

    for (const transform of transforms) {
      expect(Number.isFinite(transform.x)).toBe(true);
      expect(Number.isFinite(transform.y)).toBe(true);
      expect(transform.scale).toBeGreaterThan(0);
      expect(Number.isFinite(transform.rotation)).toBe(true);
    }
  });
});
