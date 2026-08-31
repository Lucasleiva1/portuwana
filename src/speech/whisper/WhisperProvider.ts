import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import type { RecordedAudio } from "../../audio/audio.types";
import { logger } from "../../logging/logger";
import {
  transcriptResultSchema,
  type TranscriptResult,
} from "../../schemas";
import type {
  ProviderAvailability,
  STTProvider,
} from "../providers/types";
import {
  defaultWhisperConfig,
  whisperConfigSchema,
  type WhisperConfig,
} from "./whisper.config";
import { WhisperModelManager } from "./WhisperModelManager";

const nativeResponseSchema = z.object({
  text: z.string().trim().min(1),
  language: z.literal("pt"),
  durationMs: z.number().nonnegative(),
  processingMs: z.number().nonnegative(),
  provider: z.literal("whisper.cpp"),
  model: z.enum(["base", "small"]),
  realTimeFactor: z.number().nonnegative(),
});

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface WhisperProviderOptions {
  invoke?: Invoke;
  modelManager?: WhisperModelManager;
  config?: Partial<WhisperConfig>;
  tauriAvailable?: boolean;
}

interface NativeError {
  code: string;
  message: string;
}

function requestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseNativeError(error: unknown): NativeError {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return { code: error.code, message: error.message };
  }
  if (typeof error === "string") {
    try {
      return parseNativeError(JSON.parse(error));
    } catch {
      return { code: "process-failed", message: error };
    }
  }
  return {
    code: "process-failed",
    message: "Não consegui processar sua fala. Tente novamente ou escreva sua resposta.",
  };
}

function notConfigured(
  code: "binary-missing" | "model-missing" | "not-tauri",
  reason: string,
): TranscriptResult {
  return transcriptResultSchema.parse({
    status: "notConfigured",
    code,
    reason,
  });
}

export class WhisperProvider implements STTProvider {
  readonly id = "whisper-local";
  readonly #invoke: Invoke;
  readonly #modelManager: WhisperModelManager;
  readonly #tauriAvailable: boolean;
  #config: WhisperConfig;
  #activeRequestId: string | null = null;
  #availability: ProviderAvailability = {
    status: "notConfigured",
    reason: "Whisper ainda não foi verificado.",
  };

  constructor(options: WhisperProviderOptions = {}) {
    this.#invoke = options.invoke ?? tauriInvoke;
    this.#tauriAvailable = options.tauriAvailable ?? isTauri();
    this.#modelManager =
      options.modelManager ??
      new WhisperModelManager({
        invoke: this.#invoke,
        tauriAvailable: this.#tauriAvailable,
      });
    this.#config = whisperConfigSchema.parse({
      ...defaultWhisperConfig,
      ...options.config,
      model: options.config?.model ?? this.#modelManager.activeModel,
    });
  }

  get config(): WhisperConfig {
    return this.#config;
  }

  setConfig(config: Partial<WhisperConfig>): WhisperConfig {
    this.#config = whisperConfigSchema.parse({ ...this.#config, ...config });
    if (config.model) {
      this.#modelManager.setActiveModel(config.model);
    }
    return this.#config;
  }

  getStatus(): ProviderAvailability {
    return this.#availability;
  }

  async refreshStatus(): Promise<ProviderAvailability> {
    if (!this.#tauriAvailable) {
      this.#availability = {
        status: "notConfigured",
        reason: "Whisper só está disponível no aplicativo desktop.",
      };
      return this.#availability;
    }
    const status = await this.#modelManager.getStatus();
    const model = status.models.find(
      (entry) => entry.model === this.#config.model,
    );
    if (!status.binaryInstalled) {
      this.#availability = {
        status: "notConfigured",
        reason: "Whisper não está configurado. Você pode continuar escrevendo.",
      };
    } else if (!model?.installed) {
      this.#availability = {
        status: "notConfigured",
        reason: "Modelo de voz não encontrado. Você pode continuar escrevendo.",
      };
    } else {
      this.#availability = { status: "ready" };
    }
    return this.#availability;
  }

  async transcribe(audio: RecordedAudio): Promise<TranscriptResult> {
    if (
      audio.sampleRate !== 16_000 ||
      audio.durationMs <= 0 ||
      audio.pcm.length === 0 ||
      audio.wavBlob.type !== "audio/wav"
    ) {
      return transcriptResultSchema.parse({
        status: "error",
        code: "invalid-wav",
        message: "O áudio deve ser WAV PCM 16-bit, mono e 16 kHz.",
      });
    }

    const availability = await this.refreshStatus();
    if (availability.status === "notConfigured") {
      if (!this.#tauriAvailable) {
        return notConfigured("not-tauri", availability.reason);
      }
      const status = await this.#modelManager.getStatus();
      const code = status.binaryInstalled ? "model-missing" : "binary-missing";
      return notConfigured(code, availability.reason);
    }

    const config = whisperConfigSchema.parse(this.#config);
    const currentRequestId = requestId();
    this.#activeRequestId = currentRequestId;
    void logger.info("stt.whisper.start", {
      audioDurationMs: Math.round(audio.durationMs),
      model: config.model,
    });

    try {
      const response = nativeResponseSchema.parse(
        await this.#invoke("whisper_transcribe", {
          request: {
            requestId: currentRequestId,
            audioBytes: Array.from(
              new Uint8Array(await audio.wavBlob.arrayBuffer()),
            ),
            ...config,
          },
        }),
      );
      const result = transcriptResultSchema.parse({
        status: "success",
        ...response,
      });
      void logger.info("stt.whisper.completed", {
        audioDurationMs: Math.round(response.durationMs),
        processingMs: Math.round(response.processingMs),
        model: response.model,
        realTimeFactor: Number(response.realTimeFactor.toFixed(2)),
      });
      return result;
    } catch (error) {
      const nativeError = parseNativeError(error);
      const logEvent =
        nativeError.code === "timeout"
          ? "stt.whisper.timeout"
          : nativeError.code === "cancelled"
            ? "stt.whisper.cancelled"
            : nativeError.code === "model-missing"
              ? "stt.model.missing"
              : nativeError.code === "binary-missing"
                ? "stt.binary.missing"
                : "stt.whisper.failed";
      void logger.warn(logEvent, {
        code: nativeError.code,
        model: config.model,
        audioDurationMs: Math.round(audio.durationMs),
      });
      if (
        nativeError.code === "model-missing" ||
        nativeError.code === "binary-missing"
      ) {
        return notConfigured(
          nativeError.code as "model-missing" | "binary-missing",
          nativeError.message,
        );
      }
      return transcriptResultSchema.parse({
        status: "error",
        code: nativeError.code,
        message: nativeError.message,
      });
    } finally {
      if (this.#activeRequestId === currentRequestId) {
        this.#activeRequestId = null;
      }
    }
  }

  async cancel(): Promise<boolean> {
    const activeRequestId = this.#activeRequestId;
    if (!activeRequestId) {
      return false;
    }
    return this.#invoke<boolean>("whisper_cancel", {
      requestId: activeRequestId,
    });
  }
}
