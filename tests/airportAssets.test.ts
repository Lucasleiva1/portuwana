import { describe, expect, it } from "vitest";
import {
  airportAssetPaths,
  resolveAirportAssets,
  selectCharacterAssetMode,
} from "../src/scene/airport/assetManifest";

describe("airport asset contract", () => {
  it("uses the documented public paths", () => {
    expect(airportAssetPaths.background).toBe(
      "/assets/airport/background.webp",
    );
    expect(airportAssetPaths.backgroundStateB).toBe(
      "/assets/airport/ambient/background-state-b-v1.png",
    );
    expect(airportAssetPaths.backgroundStateC).toBe(
      "/assets/airport/ambient/background-state-c-v1.png",
    );
    expect(airportAssetPaths.ambientTravelerMan).toBe(
      "/assets/airport/ambient/ambient-traveler-man-v2.png",
    );
    expect(airportAssetPaths.ambientTravelerWoman).toBe(
      "/assets/airport/ambient/ambient-traveler-woman-v2.png",
    );
    expect(airportAssetPaths.agentMaster).toBe(
      "/assets/airport/character/agent-master-v2.png",
    );
    expect(airportAssetPaths.eyesClosed).toBe(
      "/assets/airport/character/eyes-closed-v2.png",
    );
    expect(airportAssetPaths.mouthMid).toBe(
      "/assets/airport/character/mouth-mid-v2.png",
    );
    expect(airportAssetPaths.mouthOpen).toBe(
      "/assets/airport/character/mouth-open-v2.png",
    );
    expect(airportAssetPaths.expressionSmile).toBe(
      "/assets/airport/character/expression-smile-v2.png",
    );
    expect(airportAssetPaths.expressionConfused).toBe(
      "/assets/airport/character/expression-confused-v2.png",
    );
    expect(airportAssetPaths.expressionSurprised).toBe(
      "/assets/airport/character/expression-surprised-v2.png",
    );
    expect(airportAssetPaths.expressionSerious).toBe(
      "/assets/airport/character/expression-serious-v2.png",
    );
  });

  it("selects the layered rig before the master", () => {
    expect(selectCharacterAssetMode({ body: true, agentMaster: true })).toBe(
      "layered",
    );
    expect(selectCharacterAssetMode({ body: false, agentMaster: true })).toBe(
      "master",
    );
  });

  it("falls back cleanly when every asset is missing", async () => {
    const result = await resolveAirportAssets(async () => false);
    expect(result.characterMode).toBe("placeholder");
    expect(result.availability.background).toBe(false);
    expect(result.availability.agentMaster).toBe(false);
  });
});
