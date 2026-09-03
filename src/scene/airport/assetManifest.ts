export const airportAssetPaths = {
  background: "/assets/airport/background.webp",
  backgroundStateB:
    "/assets/airport/ambient/background-state-b-v1.png",
  backgroundStateC:
    "/assets/airport/ambient/background-state-c-v1.png",
  backgroundStateD:
    "/assets/airport/ambient/background-state-d-v1.png",
  backgroundStateE:
    "/assets/airport/ambient/background-state-e-v1.png",
  backgroundStateF:
    "/assets/airport/ambient/background-state-f-v1.png",
  ambientTravelerMan: "/assets/airport/ambient/ambient-traveler-man-v2.png",
  ambientTravelerWoman:
    "/assets/airport/ambient/ambient-traveler-woman-v2.png",
  agentMaster: "/assets/airport/character/agent-master-v2.png",
  body: "/assets/airport/character/body.png",
  eyesOpen: "/assets/airport/character/eyes-open.png",
  eyesClosed: "/assets/airport/character/eyes-closed-v2.png",
  mouthClosed: "/assets/airport/character/mouth-closed.png",
  mouthMid: "/assets/airport/character/mouth-mid-v2.png",
  mouthOpen: "/assets/airport/character/mouth-open-v2.png",
  expressionNeutral:
    "/assets/airport/character/expression-neutral.png",
  expressionSmile: "/assets/airport/character/expression-smile-v2.png",
  expressionConfused:
    "/assets/airport/character/expression-confused-v2.png",
  expressionSurprised:
    "/assets/airport/character/expression-surprised-v2.png",
  expressionSerious: "/assets/airport/character/expression-serious-v2.png",
} as const;

export type AirportAssetKey = keyof typeof airportAssetPaths;
export type CharacterAssetMode = "layered" | "master" | "placeholder";
export type AssetAvailability = Readonly<Record<AirportAssetKey, boolean>>;
export type AssetProbe = (path: string) => Promise<boolean>;

export interface ResolvedAirportAssets {
  availability: AssetAvailability;
  characterMode: CharacterAssetMode;
}

export async function probePublicAsset(path: string): Promise<boolean> {
  try {
    const response = await fetch(path, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export function selectCharacterAssetMode(
  availability: Pick<AssetAvailability, "body" | "agentMaster">,
): CharacterAssetMode {
  if (availability.body) {
    return "layered";
  }
  if (availability.agentMaster) {
    return "master";
  }
  return "placeholder";
}

export function hasCompleteMouthSet(availability: AssetAvailability): boolean {
  return availability.mouthMid && availability.mouthOpen;
}

export async function resolveAirportAssets(
  probe: AssetProbe = probePublicAsset,
): Promise<ResolvedAirportAssets> {
  const entries = await Promise.all(
    Object.entries(airportAssetPaths).map(async ([key, path]) => {
      const available = await probe(path);
      return [key, available] as const;
    }),
  );
  const availability = Object.fromEntries(entries) as Record<
    AirportAssetKey,
    boolean
  >;

  return {
    availability,
    characterMode: selectCharacterAssetMode(availability),
  };
}
