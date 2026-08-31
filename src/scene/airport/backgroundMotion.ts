export interface BackgroundMotionFrame {
  alphas: readonly number[];
  stateIndex: number;
  transitioning: boolean;
}

export const airportBackgroundMotionConfig = {
  holdDurationMs: 4_800,
  transitionDurationMs: 1_200,
} as const;

function smoothStep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export function getBackgroundMotionFrame(
  elapsedMs: number,
  stateCount: number,
  holdDurationMs = airportBackgroundMotionConfig.holdDurationMs,
  transitionDurationMs = airportBackgroundMotionConfig.transitionDurationMs,
): BackgroundMotionFrame {
  const count = Math.max(1, Math.floor(stateCount));
  const alphas = Array.from({ length: count }, () => 0);
  if (count === 1 || holdDurationMs < 0 || transitionDurationMs <= 0) {
    alphas[0] = 1;
    return { alphas, stateIndex: 0, transitioning: false };
  }

  const segmentDurationMs = holdDurationMs + transitionDurationMs;
  const safeElapsedMs = Math.max(0, elapsedMs);
  const segmentIndex = Math.floor(safeElapsedMs / segmentDurationMs);
  const stateIndex = segmentIndex % count;
  const segmentElapsedMs = safeElapsedMs % segmentDurationMs;

  if (segmentElapsedMs < holdDurationMs) {
    alphas[stateIndex] = 1;
    return { alphas, stateIndex, transitioning: false };
  }

  const nextStateIndex = (stateIndex + 1) % count;
  const progress = smoothStep(
    (segmentElapsedMs - holdDurationMs) / transitionDurationMs,
  );
  alphas[stateIndex] = 1 - progress;
  alphas[nextStateIndex] = progress;
  return { alphas, stateIndex, transitioning: true };
}
