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
    expect(airportAssetPaths.agentMaster).toBe(
      "/assets/airport/character/agent-master-v2.png",
    );
    expect(airportAssetPaths.eyesClosed).toBe(
      "/assets/airport/character/eyes-closed-v2.png",
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
