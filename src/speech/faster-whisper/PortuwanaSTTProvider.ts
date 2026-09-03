import type { RecordedAudio } from "../../audio/audio.types";
import { logger } from "../../logging/logger";
import type { TranscriptResult } from "../../schemas";
import type {
  ProviderAvailability,
  STTOptions,
  STTProvider,
} from "../providers/types";
import { WhisperProvider } from "../whisper/WhisperProvider";
import type { FasterWhisperConfig } from "./fasterWhisper.config";
import { FasterWhisperProvider } from "./FasterWhisperProvider";

interface PortuwanaSTTProviderOptions {
  primary?: FasterWhisperProvider;
  fallback?: WhisperProvider;
}

export class PortuwanaSTTProvider implements STTProvider {
  readonly id = "portuwana-local-stt";
  readonly primary: FasterWhisperProvider;
  readonly fallback: WhisperProvider;
  #active: "primary" | "fallback" | null = null;
  #lastFallbackReason: string | null = null;

  constructor(options: PortuwanaSTTProviderOptions = {}) {
    this.primary = options.primary ?? new FasterWhisperProvider();
    this.fallback = options.fallback ?? new WhisperProvider();
  }

  get config(): FasterWhisperConfig {
    return this.primary.config;
  }

  get lastFallbackReason(): string | null {
    return this.#lastFallbackReason;
  }

  setConfig(config: Partial<FasterWhisperConfig>): FasterWhisperConfig {
    return this.primary.setConfig(config);
  }

  getStatus(): ProviderAvailability {
    return this.primary.getStatus();
  }

  refreshStatus(): Promise<ProviderAvailability> {
    return this.primary.refreshStatus();
  }

  async transcribe(audio: RecordedAudio, options: STTOptions = {}): Promise<TranscriptResult> {
    this.#lastFallbackReason = null;
    this.#active = "primary";
    let primaryResult: TranscriptResult;
    try {
      primaryResult = await this.primary.transcribe(audio, options);
    } catch (error) {
      primaryResult = {
        status: "error",
        code: "primary-unavailable",
        message: error instanceof Error ? error.message : "Faster-Whisper no está disponible.",
      };
    }
    if (primaryResult.status === "success" || primaryResult.status === "error" && primaryResult.code === "cancelled") {
      this.#active = null;
      return primaryResult;
    }

    this.#lastFallbackReason =
      primaryResult.status === "notConfigured"
        ? primaryResult.reason
        : primaryResult.message;
    void logger.warn("stt.fallback.whisperCpp", {
      reason: this.#lastFallbackReason,
    });
    this.#active = "fallback";
    const fallbackResult = await this.fallback.transcribe(
      audio,
      options.language ? { language: options.language } : {},
    );
    this.#active = null;
    return fallbackResult;
  }

  async cancel(): Promise<boolean> {
    if (this.#active === "primary") {
      return this.primary.cancel();
    }
    if (this.#active === "fallback") {
      return this.fallback.cancel();
    }
    return false;
  }

  resetContext(contextScope?: string): Promise<boolean> {
    return this.primary.resetContext(contextScope);
  }
}
