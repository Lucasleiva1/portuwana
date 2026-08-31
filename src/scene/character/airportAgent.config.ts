import type { CharacterRigConfig } from "./character.types";

export const airportAgentConfig = {
  logicalViewport: { width: 1600, height: 900 },
  position: { x: 1_170, y: 900 },
  anchor: { x: 0.5, y: 1 },
  baseScale: 0.6,
  expressionMode: "full-frame",
  eyesTransform: {
    open: { x: 0, y: 0, scale: 1, rotation: 0 },
    closed: { x: 0, y: 0, scale: 1, rotation: 0 },
  },
  mouthTransform: {
    closed: { x: 1, y: -550, scale: 0.17, rotation: 0 },
    mid: { x: 0, y: -515, scale: 0.25, rotation: 0 },
    open: { x: 0, y: -544, scale: 0.18, rotation: 0 },
  },
  overlayCalibration: {
    eyes: true,
    mouth: false,
  },
} satisfies CharacterRigConfig;
