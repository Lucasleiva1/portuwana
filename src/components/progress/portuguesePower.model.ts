import { applyPowerReward, clampPower } from "../../lesson/scoring";

export const clampPortuguesePower = clampPower;

export function addPortuguesePower(current: number, amount: number): number {
  return applyPowerReward(current, amount);
}
