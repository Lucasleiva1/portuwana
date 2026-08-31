import type {
  ProviderAvailability,
  TTSInput,
  TTSProvider,
  TTSResult,
} from "../providers/types";

export interface AzureSpeechConfig {
  key?: string;
  region?: string;
}

export type AzureSpeechSdk = typeof import(
  "microsoft-cognitiveservices-speech-sdk"
);

export class AzureTTSProvider implements TTSProvider {
  readonly id = "azure-tts";
  readonly #hasCredentials: boolean;

  constructor(config?: AzureSpeechConfig) {
    this.#hasCredentials = Boolean(config?.key?.trim() && config.region?.trim());
  }

  #notConfigured() {
    return {
      status: "notConfigured" as const,
      reason: this.#hasCredentials
        ? "Azure TTS execution is deferred to a later phase"
        : "Azure Speech credentials are not configured",
    };
  }

  getStatus(): ProviderAvailability {
    return this.#notConfigured();
  }

  async synthesize(input: TTSInput): Promise<TTSResult> {
    void input;
    return this.#notConfigured();
  }
}
