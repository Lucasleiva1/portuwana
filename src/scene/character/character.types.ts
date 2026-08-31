import type {
  AssetAvailability,
  CharacterAssetMode,
} from "../airport/assetManifest";

export type CharacterExpression =
  | "neutral"
  | "smile"
  | "confused"
  | "surprised"
  | "serious";

export type MouthState = "closed" | "mid" | "open";
export type EyeState = "open" | "closed";
export type FaceOverlayKind = "eyes" | "mouth";

export interface PointConfig {
  x: number;
  y: number;
}

export interface FaceOverlayTransform extends PointConfig {
  scale: number;
  rotation: number;
}

export interface CharacterOverlayTransforms {
  eyes: Record<EyeState, FaceOverlayTransform>;
  mouth: Record<MouthState, FaceOverlayTransform>;
}

export interface CharacterRigConfig {
  logicalViewport: { width: number; height: number };
  position: PointConfig;
  anchor: PointConfig;
  baseScale: number;
  expressionMode: "full-frame";
  eyesTransform: Record<EyeState, FaceOverlayTransform>;
  mouthTransform: Record<MouthState, FaceOverlayTransform>;
  overlayCalibration: {
    eyes: boolean;
    mouth: boolean;
  };
}

export interface CharacterRigStatus {
  mode: CharacterAssetMode;
  availableLayers: readonly string[];
  canBlink: boolean;
  canPreviewSpeaking: boolean;
  expressionMode: "full-frame";
  overlaysCalibrated: {
    eyes: boolean;
    mouth: boolean;
  };
}

export interface CharacterRigSource {
  availability: AssetAvailability;
  preferredMode: CharacterAssetMode;
}
