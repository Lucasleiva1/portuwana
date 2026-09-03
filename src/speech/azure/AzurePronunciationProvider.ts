import type { PronunciationResult } from "../../schemas";
import type {
  PronunciationRequest,
  PronunciationProvider,
  ProviderAvailability,
} from "../providers/types";
import type { AzureSpeechConfig } from "./AzureTTSProvider";

export class AzurePronunciationProvider implements PronunciationProvider {
  readonly id = "azure-pronunciation";
  readonly #hasCredentials: boolean;

  constructor(config?: AzureSpeechConfig) {
    this.#hasCredentials = Boolean(config?.key?.trim() && config.region?.trim());
  }

  #notConfigured() {
    return {
      status: "notConfigured" as const,
      reason: this.#hasCredentials
        ? "Azure pronunciation execution is deferred to a later phase"
        : "Azure Speech credentials are not configured",
    };
  }

  getStatus(): ProviderAvailability {
    return this.#notConfigured();
  }

  async assess(
    request: PronunciationRequest,
  ): Promise<PronunciationResult> {
    void request;
    return this.#notConfigured();
  }
}
