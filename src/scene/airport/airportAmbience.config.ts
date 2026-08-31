import type { AirportAssetKey } from "./assetManifest";

export interface AmbientTravelerPlacement {
  x: number;
  y: number;
  scale: number;
  flipX: boolean;
}

export interface AmbientTravelerConfig {
  asset: AirportAssetKey;
  phaseMs: number;
  maxAlpha: number;
  placements: readonly AmbientTravelerPlacement[];
}

export const airportAmbienceConfig = {
  cycleDurationMs: 12_000,
  travelers: [
    {
      asset: "ambientTravelerMan",
      phaseMs: 0,
      maxAlpha: 0.72,
      placements: [
        { x: 110, y: 570, scale: 0.105, flipX: false },
        { x: 335, y: 560, scale: 0.09, flipX: true },
        { x: 610, y: 530, scale: 0.075, flipX: false },
      ],
    },
    {
      asset: "ambientTravelerWoman",
      phaseMs: 5_100,
      maxAlpha: 0.64,
      placements: [
        { x: 225, y: 560, scale: 0.09, flipX: false },
        { x: 590, y: 540, scale: 0.075, flipX: true },
        { x: 70, y: 550, scale: 0.085, flipX: false },
      ],
    },
  ] satisfies readonly AmbientTravelerConfig[],
} as const;
