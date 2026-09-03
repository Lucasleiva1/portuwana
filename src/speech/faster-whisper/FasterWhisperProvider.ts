import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import type { RecordedAudio } from "../../audio/audio.types";
import { logger } from "../../logging/logger";
import { transcriptResultSchema, type TranscriptResult } from "../../schemas";
import type {
  ProviderAvailability,
  STTOptions,
  STTProvider,
} from "../providers/types";
import {
  defaultFasterWhisperConfig,
  fasterWhisperConfigSchema,
  type FasterWhisperConfig,
} from "./fasterWhisper.config";
import { FasterWhisperModelManager } from "./FasterWhisperModelManager";

const nullableText = z.string().trim().min(1).nullable().optional();
const nullableMetric = z.number().nonnegative().nullable().optional();

const nativeResponseSchema = z.object({
  text: z.string().trim().min(1),
  language: z.enum(["pt", "es"]),
  durationMs: z.number().nonnegative(),
  processingMs: z.number().nonnegative(),
  inferenceMs: z.number().nonnegative(),
  provider: z.literal("faster-whisper"),
  model: z.enum(["base", "small"]),
  backend: z.enum(["cuda", "cpu"]),
  computeType: z.string().trim().min(1),
  realTimeFactor: z.number().nonnegative(),
  runtimeLoadMs: z.number().nonnegative(),
  gpuName: nullableText,
  driverVersion: nullableText,
  vramTotalMiB: nullableMetric,
  vramUsedMiB: nullableMetric,
  fallbackReason: nullableText,
});

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface FasterWhisperProviderOptions {
  invoke?: Invoke;
  modelManager?: FasterWhisperModelManager;
  config?: Partial<FasterWhisperConfig>;
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
      return { code: "runtime-failed", message: error };
    }
  }
  return {
    code: "runtime-failed",
    message: "No pude procesar tu voz con Faster-Whisper.",
  };
}

function notConfigured(code: "binary-missing" | "model-missing" | "not-tauri", reason: string) {
  return transcriptResultSchema.parse({ status: "notConfigured", code, reason });
}

export class FasterWhisperProvider implements STTProvider {
  readonly id = "faster-whisper-local";
  readonly #invoke: Invoke;
  readonly #modelManager: FasterWhisperModelManager;
  readonly #tauriAvailable: boolean;
  #config: FasterWhisperConfig;
  #activeRequestId: string | null = null;
  #availability: ProviderAvailability = {
    status: "notConfigured",
    reason: "Faster-Whisper aún no fue verificado.",
  };

  constructor(options: FasterWhisperProviderOptions = {}) {
    this.#invoke = options.invoke ?? tauriInvoke;
    this.#tauriAvailable = options.tauriAvailable ?? isTauri();
    this.#modelManager =
      options.modelManager ??
      new FasterWhisperModelManager({
        invoke: this.#invoke,
        tauriAvailable: this.#tauriAvailable,
      });
    this.#config = fasterWhisperConfigSchema.parse({
      ...defaultFasterWhisperConfig,
      ...options.config,
      model: options.config?.model ?? this.#modelManager.activeModel,
    });
  }

  get config(): FasterWhisperConfig {
    return this.#config;
  }

  setConfig(config: Partial<FasterWhisperConfig>): FasterWhisperConfig {
    this.#config = fasterWhisperConfigSchema.parse({ ...this.#config, ...config });
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
        reason: "Faster-Whisper sólo está disponible en la aplicación de escritorio.",
      };
      return this.#availability;
    }
    const status = await this.#modelManager.getStatus();
    if (!status.ready) {
      this.#availability = {
        status: "notConfigured",
        reason: status.error ?? "Faster-Whisper no está preparado.",
      };
    } else {
      this.#availability = { status: "ready" };
    }
    return this.#availability;
  }

  async transcribe(audio: RecordedAudio, overrides: STTOptions = {}): Promise<TranscriptResult> {
    if (
      audio.sampleRate !== 16_000 ||
      audio.durationMs <= 0 ||
      audio.pcm.length === 0 ||
      audio.wavBlob.type !== "audio/wav"
    ) {
      return transcriptResultSchema.parse({
        status: "error",
        code: "invalid-wav",
        message: "El audio debe ser WAV PCM de 16 bits, mono y 16 kHz.",
      });
    }

    const availability = await this.refreshStatus();
    if (availability.status === "notConfigured") {
      if (!this.#tauriAvailable) {
        return notConfigured("not-tauri", availability.reason);
      }
      const status = await this.#modelManager.getStatus();
      return notConfigured(
        status.binaryInstalled ? "model-missing" : "binary-missing",
        availability.reason,
      );
    }

    const config = fasterWhisperConfigSchema.parse({
      ...this.#config,
      language: overrides.language ?? this.#config.language,
      initialPrompt: overrides.initialPrompt ?? this.#config.initialPrompt,
      contextScope:
        overrides.contextScope ??
        (overrides.language ? `dictionary-${overrides.language}` : this.#config.contextScope),
    });
    const currentRequestId = requestId();
    this.#activeRequestId = currentRequestId;
    void logger.info("stt.fasterWhisper.start", {
      audioDurationMs: Math.round(audio.durationMs),
      model: config.model,
      language: config.language,
    });

    try {
      const response = nativeResponseSchema.parse(
        await this.#invoke("faster_whisper_transcribe", {
          request: {
            requestId: currentRequestId,
            audioBytes: Array.from(new Uint8Array(await audio.wavBlob.arrayBuffer())),
            ...config,
          },
        }),
      );
      const result = transcriptResultSchema.parse({ status: "success", ...response });
      void logger.info("stt.fasterWhisper.completed", {
        backend: response.backend,
        computeType: response.computeType,
        model: response.model,
        audioDurationMs: Math.round(response.durationMs),
        inferenceMs: Math.round(response.inferenceMs),
        processingMs: Math.round(response.processingMs),
        realTimeFactor: Number(response.realTimeFactor.toFixed(2)),
      });
      return result;
    } catch (error) {
      const nativeError = parseNativeError(error);
      void logger.warn("stt.fasterWhisper.failed", {
        code: nativeError.code,
        model: config.model,
        audioDurationMs: Math.round(audio.durationMs),
      });
      if (nativeError.code === "binary-missing" || nativeError.code === "model-missing") {
        return notConfigured(nativeError.code, nativeError.message);
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
    if (!this.#activeRequestId) {
      return false;
    }
    return this.#invoke<boolean>("faster_whisper_cancel", {
      requestId: this.#activeRequestId,
    });
  }

  async resetContext(contextScope?: string): Promise<boolean> {
    return this.#invoke<boolean>("faster_whisper_reset_context", {
      contextScope: contextScope ?? null,
    });
  }
}
