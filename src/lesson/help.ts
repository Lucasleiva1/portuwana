import type { HelpKind, HelpLevel, TurnHelpUsage } from "./lesson.types";

export const helpLevelByKind: Readonly<Record<HelpKind, HelpLevel>> = {
  replay: 1,
  slower: 1,
  hint: 2,
  translation: 3,
  example: 4,
};

export function createEmptyHelpUsage(): TurnHelpUsage {
  return {
    replay: 0,
    slower: 0,
    hint: 0,
    translation: 0,
    example: 0,
    highestLevel: 0,
  };
}

export function registerHelpUsage(
  usage: TurnHelpUsage,
  kind: HelpKind,
): TurnHelpUsage {
  const level = helpLevelByKind[kind];
  return {
    ...usage,
    [kind]: usage[kind] + 1,
    highestLevel: Math.max(usage.highestLevel, level) as 0 | HelpLevel,
  };
}

export function nextAvailableHelpLevel(
  current: HelpLevel,
  usedKind: HelpKind,
): HelpLevel {
  return Math.min(4, Math.max(current, helpLevelByKind[usedKind] + 1)) as HelpLevel;
}
