export interface AmbientMotionFrame {
  alpha: number;
  locationIndex: number;
}

const fadeInEnd = 0.12;
const holdEnd = 0.6;
const fadeOutEnd = 0.72;

function smoothStep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export function getAmbientMotionFrame(
  elapsedMs: number,
  phaseMs: number,
  locationCount: number,
  cycleDurationMs: number,
): AmbientMotionFrame {
  if (locationCount < 1 || cycleDurationMs <= 0) {
    return { alpha: 0, locationIndex: 0 };
  }

  const totalMs = Math.max(0, elapsedMs + phaseMs);
  const cycleIndex = Math.floor(totalMs / cycleDurationMs);
  const progress = (totalMs % cycleDurationMs) / cycleDurationMs;

  let alpha = 0;
  if (progress < fadeInEnd) {
    alpha = smoothStep(progress / fadeInEnd);
  } else if (progress < holdEnd) {
    alpha = 1;
  } else if (progress < fadeOutEnd) {
    alpha = 1 - smoothStep((progress - holdEnd) / (fadeOutEnd - holdEnd));
  }

  return {
    alpha,
    locationIndex: cycleIndex % locationCount,
  };
}
