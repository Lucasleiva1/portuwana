import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import { whisperModelSchema, type WhisperModel } from "./whisper.config";

const storageKey = "portuwana.whisper.model";

const statusSchema = z.object({
  version: z.string().trim().min(1),
  binaryInstalled: z.boolean(),
  models: z.array(
    z.object({
      model: whisperModelSchema,
      installed: z.boolean(),
    }),
  ),
});

export type WhisperRuntimeStatus = z.infer<typeof statusSchema>;

interface ModelStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface WhisperModelManagerOptions {
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

export class WhisperModelManager {
  readonly #invoke: Invoke;
  readonly #storage: ModelStorage | null;
  readonly #tauriAvailable: boolean;
  #activeModel: WhisperModel;

  constructor(options: WhisperModelManagerOptions = {}) {
    this.#invoke = options.invoke ?? tauriInvoke;
    this.#storage = options.storage === undefined ? browserStorage() : options.storage;
    this.#tauriAvailable = options.tauriAvailable ?? isTauri();
    const stored = whisperModelSchema.safeParse(this.#storage?.getItem(storageKey));
    this.#activeModel = stored.success ? stored.data : "base";
  }

  get activeModel(): WhisperModel {
    return this.#activeModel;
  }

  setActiveModel(model: WhisperModel): void {
    this.#activeModel = whisperModelSchema.parse(model);
    this.#storage?.setItem(storageKey, this.#activeModel);
  }

  async getStatus(): Promise<WhisperRuntimeStatus> {
    if (!this.#tauriAvailable) {
      return {
        version: "unavailable",
        binaryInstalled: false,
        models: [
          { model: "base", installed: false },
          { model: "small", installed: false },
        ],
      };
    }
    return statusSchema.parse(await this.#invoke("whisper_status"));
  }

  async isReady(model = this.#activeModel): Promise<boolean> {
    const status = await this.getStatus();
    return (
      status.binaryInstalled &&
      status.models.some((entry) => entry.model === model && entry.installed)
    );
  }
}
