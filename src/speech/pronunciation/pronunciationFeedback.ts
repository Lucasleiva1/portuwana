import type { PronunciationResult } from "../../schemas";

export interface PronunciationFeedback {
  message: string;
  recommendation: string | null;
  level: "clear" | "good" | "understandable" | "practice";
}

export function pronunciationPowerContribution(score: number): number {
  if (score >= 90) {
    return 3;
  }
  if (score >= 75) {
    return 2;
  }
  if (score >= 55) {
    return 1;
  }
  return 0;
}

export function createPronunciationFeedback(
  result: Extract<PronunciationResult, { status: "success" }>,
): PronunciationFeedback {
  const level =
    result.overallScore >= 90
      ? "clear"
      : result.overallScore >= 75
        ? "good"
        : result.overallScore >= 55
          ? "understandable"
          : "practice";
  const messages: Readonly<Record<PronunciationFeedback["level"], string>> = {
    clear: "Pronúncia muito clara.",
    good: "Pronúncia boa.",
    understandable: "Dá para entender.",
    practice: "Continue praticando a pronúncia.",
  };
  const weakest = [...result.words]
    .filter((word) => word.accuracy < 72)
    .sort((left, right) => left.accuracy - right.accuracy)[0];

  return {
    message: messages[level],
    recommendation: weakest
      ? `Pratique um pouco a palavra “${weakest.word}”.`
      : null,
    level,
  };
}
