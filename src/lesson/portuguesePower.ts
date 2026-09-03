import { applyPowerReward, clampPower } from "./scoring";

export const clampPortuguesePower = clampPower;

export function addPortuguesePower(current: number, amount: number): number {
  return applyPowerReward(current, amount);
}

export interface PortuguesePowerDimensions {
  communication: number;
  comprehension: number;
  pronunciation: number;
  autonomy: number;
}

export function createPortuguesePowerDimensions(
  initial: number,
): PortuguesePowerDimensions {
  const value = clampPortuguesePower(initial);
  return {
    communication: value,
    comprehension: value,
    pronunciation: value,
    autonomy: value,
  };
}

export function applyConversationDimensions(
  dimensions: PortuguesePowerDimensions,
  reward: number,
  usedHelp: boolean,
): PortuguesePowerDimensions {
  const safeReward = Math.max(0, reward);
  return {
    communication: addPortuguesePower(dimensions.communication, safeReward),
    comprehension: addPortuguesePower(
      dimensions.comprehension,
      Math.ceil(safeReward * 0.75),
    ),
    pronunciation: dimensions.pronunciation,
    autonomy: addPortuguesePower(
      dimensions.autonomy,
      usedHelp ? Math.floor(safeReward * 0.4) : safeReward,
    ),
  };
}

export function applyPronunciationDimension(
  dimensions: PortuguesePowerDimensions,
  contribution: number,
): PortuguesePowerDimensions {
  return {
    ...dimensions,
    pronunciation: addPortuguesePower(
      dimensions.pronunciation,
      Math.max(0, contribution),
    ),
  };
}
