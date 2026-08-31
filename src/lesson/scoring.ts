import type { HelpLevel, LessonResolutionStatus } from "./lesson.types";

const rewardByHelpLevel: Readonly<Record<0 | HelpLevel, number>> = {
  0: 8,
  1: 7,
  2: 6,
  3: 4,
  4: 3,
};

export function clampPower(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function calculatePowerReward(input: {
  status: LessonResolutionStatus;
  highestHelpLevel: 0 | HelpLevel;
  maxReward?: number | undefined;
}): number {
  if (input.status !== "advanced") {
    return 0;
  }

  const baseReward = rewardByHelpLevel[input.highestHelpLevel];
  return Math.max(0, Math.min(baseReward, input.maxReward ?? baseReward));
}

export function applyPowerReward(current: number, reward: number): number {
  return clampPower(current + Math.max(0, reward));
}
