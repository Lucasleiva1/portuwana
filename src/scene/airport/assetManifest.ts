export const airportAssetPaths = {
  background: "/assets/airport/background.webp",
  agentMaster: "/assets/airport/character/agent-master-v2.png",
  body: "/assets/airport/character/body.png",
  eyesOpen: "/assets/airport/character/eyes-open.png",
  eyesClosed: "/assets/airport/character/eyes-closed-v2.png",
  mouthClosed: "/assets/airport/character/mouth-closed.png",
  mouthMid: "/assets/airport/character/mouth-mid.png",
  mouthOpen: "/assets/airport/character/mouth-open.png",
  expressionNeutral:
    "/assets/airport/character/expression-neutral.png",
  expressionSmile: "/assets/airport/character/expression-smile.png",
  expressionConfused:
    "/assets/airport/character/expression-confused.png",
  expressionSurprised:
    "/assets/airport/character/expression-surprised.png",
  expressionSerious:
    "/assets/airport/character/expression-serious.png",
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
  return (
    availability.mouthClosed &&
    availability.mouthMid &&
    availability.mouthOpen
  );
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
