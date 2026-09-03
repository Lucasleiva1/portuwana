import type { PronunciationResult } from "../schemas";
import type {
  PronunciationProvider,
  PronunciationRequest,
  ProviderAvailability,
} from "../speech/providers/types";

export class MockPronunciationProvider implements PronunciationProvider {
  readonly id = "mock-pronunciation";

  getStatus(): ProviderAvailability {
    return { status: "ready" };
  }

  async assess(request: PronunciationRequest): Promise<PronunciationResult> {
    const words = request.transcript
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .map((word, index) => ({ word, accuracy: Math.max(68, 92 - index * 4) }));
    return {
      status: "success",
      overallScore: 84,
      fluencyScore: 82,
      accuracyScore: 86,
      words,
    };
  }
}
