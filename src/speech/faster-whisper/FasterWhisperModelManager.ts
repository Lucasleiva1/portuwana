import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  fasterWhisperModelSchema,
  type FasterWhisperModel,
} from "./fasterWhisper.config";

const storageKey = "portuwana.faster-whisper.model";

const optionalText = z.string().trim().min(1).nullable().optional();
const optionalMetric = z.number().nonnegative().nullable().optional();

const statusSchema = z.object({
  ready: z.boolean(),
  binaryInstalled: z.boolean(),
  modelInstalled: z.boolean(),
  workerRunning: z.boolean(),
  provider: optionalText,
  fasterWhisperVersion: optionalText,
  ctranslate2Version: optionalText,
  model: fasterWhisperModelSchema.nullable().optional(),
  backend: z.enum(["cuda", "cpu"]).nullable().optional(),
  computeType: optionalText,
  cudaDeviceCount: z.number().int().nonnegative(),
  loadMs: optionalMetric,
  gpuName: optionalText,
  driverVersion: optionalText,
  vramTotalMiB: optionalMetric,
  vramUsedMiB: optionalMetric,
  fallbackReason: optionalText,
  error: optionalText,
});

export type FasterWhisperRuntimeStatus = z.infer<typeof statusSchema>;

interface ModelStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface FasterWhisperModelManagerOptions {
  invoke?: Invoke;
  storage?: ModelStorage | null;
  tauriAvailable?: boolean;
}

function browserStorage(): ModelStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export class FasterWhisperModelManager {
  readonly #invoke: Invoke;
  readonly #storage: ModelStorage | null;
  readonly #tauriAvailable: boolean;
  #activeModel: FasterWhisperModel;

  constructor(options: FasterWhisperModelManagerOptions = {}) {
    this.#invoke = options.invoke ?? tauriInvoke;
    this.#storage = options.storage === undefined ? browserStorage() : options.storage;
    this.#tauriAvailable = options.tauriAvailable ?? isTauri();
    const stored = fasterWhisperModelSchema.safeParse(
      this.#storage?.getItem(storageKey),
    );
    this.#activeModel = stored.success ? stored.data : "small";
  }

  get activeModel(): FasterWhisperModel {
    return this.#activeModel;
  }

  setActiveModel(model: FasterWhisperModel): void {
    this.#activeModel = fasterWhisperModelSchema.parse(model);
    this.#storage?.setItem(storageKey, this.#activeModel);
  }

  async getStatus(): Promise<FasterWhisperRuntimeStatus> {
    if (!this.#tauriAvailable) {
      return statusSchema.parse({
        ready: false,
        binaryInstalled: false,
        modelInstalled: false,
        workerRunning: false,
        model: this.#activeModel,
        cudaDeviceCount: 0,
        error: "Faster-Whisper sólo está disponible en la aplicación de escritorio.",
      });
    }
    return statusSchema.parse(
      await this.#invoke("faster_whisper_status", {
        model: this.#activeModel,
      }),
    );
  }
}
