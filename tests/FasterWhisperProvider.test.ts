import { describe, expect, it, vi } from "vitest";
import { createSilentRecording } from "../src/mocks/audio";
import {
  defaultFasterWhisperConfig,
  fasterWhisperConfigSchema,
} from "../src/speech/faster-whisper/fasterWhisper.config";
import { FasterWhisperModelManager } from "../src/speech/faster-whisper/FasterWhisperModelManager";
import { FasterWhisperProvider } from "../src/speech/faster-whisper/FasterWhisperProvider";
import { PortuwanaSTTProvider } from "../src/speech/faster-whisper/PortuwanaSTTProvider";
import { WhisperProvider } from "../src/speech/whisper/WhisperProvider";

const cudaStatus = {
  ready: true,
  binaryInstalled: true,
  modelInstalled: true,
  workerRunning: true,
  provider: "faster-whisper",
  fasterWhisperVersion: "1.2.1",
  ctranslate2Version: "4.7.2",
  model: "small" as const,
  backend: "cuda" as const,
  computeType: "int8_float32",
  cudaDeviceCount: 1,
  loadMs: 2_000,
  gpuName: "NVIDIA GeForce GTX 1050 Ti",
  driverVersion: "581.80",
  vramTotalMiB: 4_096,
  vramUsedMiB: 1_070,
  fallbackReason: null,
  error: null,
};

function fasterInvoke(
  transcribe: (args?: Record<string, unknown>) => unknown | Promise<unknown>,
) {
  const mock = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "faster_whisper_status") {
      return cudaStatus;
    }
    if (command === "faster_whisper_transcribe") {
      return transcribe(args);
    }
    if (command === "faster_whisper_cancel") {
      return true;
    }
    if (command === "faster_whisper_reset_context") {
      return true;
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  const invoke = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => (await mock(command, args)) as T;
  return { invoke, mock };
}

describe("Faster-Whisper configuration", () => {
  it("uses multilingual small without enabling translation", () => {
    expect(defaultFasterWhisperConfig).toMatchObject({
      model: "small",
      language: "pt",
      translate: false,
      timeoutMs: 45_000,
      contextScope: "airport-arrival",
    });
    expect(
      fasterWhisperConfigSchema.safeParse({
        ...defaultFasterWhisperConfig,
        language: "auto",
      }).success,
    ).toBe(true);
    expect(
      fasterWhisperConfigSchema.safeParse({
        ...defaultFasterWhisperConfig,
        translate: true,
      }).success,
    ).toBe(false);
  });

  it("defaults to small and parses the real CUDA runtime metadata", async () => {
    const { invoke } = fasterInvoke(() => undefined);
    const manager = new FasterWhisperModelManager({
      invoke,
      storage: null,
      tauriAvailable: true,
    });

    expect(manager.activeModel).toBe("small");
    await expect(manager.getStatus()).resolves.toEqual(cudaStatus);
  });
});

describe("FasterWhisperProvider", () => {
  it("sends contextual 16 kHz audio to the persistent command", async () => {
    const { invoke } = fasterInvoke((args) => {
      const request = args?.request as Record<string, unknown>;
      expect(request.model).toBe("small");
      expect(request.language).toBe("es");
      expect(request.translate).toBe(false);
      expect(request.contextScope).toBe("dictionary-es");
      expect((request.audioBytes as number[]).slice(0, 4)).toEqual([82, 73, 70, 70]);
      return {
        text: "hombre",
        language: "es",
        durationMs: 100,
        processingMs: 210,
        inferenceMs: 180,
        provider: "faster-whisper",
        model: "small",
        backend: "cuda",
        computeType: "int8_float32",
        realTimeFactor: 2.1,
        runtimeLoadMs: 2_000,
        gpuName: "NVIDIA GeForce GTX 1050 Ti",
        driverVersion: "581.80",
        vramTotalMiB: 4_096,
        vramUsedMiB: 1_070,
        fallbackReason: null,
      };
    });
    const manager = new FasterWhisperModelManager({
      invoke,
      storage: null,
      tauriAvailable: true,
    });
    const provider = new FasterWhisperProvider({
      invoke,
      modelManager: manager,
      tauriAvailable: true,
    });

    await expect(
      provider.transcribe(createSilentRecording(), { language: "es" }),
    ).resolves.toMatchObject({
      status: "success",
      text: "hombre",
      provider: "faster-whisper",
      backend: "cuda",
    });
  });

  it("uses whisper.cpp only after Faster-Whisper fails", async () => {
    const order: string[] = [];
    const faster = fasterInvoke(() => {
      order.push("faster-whisper");
      return Promise.reject({ code: "runtime-stopped", message: "worker stopped" });
    });
    const manager = new FasterWhisperModelManager({
      invoke: faster.invoke,
      storage: null,
      tauriAvailable: true,
    });
    const primary = new FasterWhisperProvider({
      invoke: faster.invoke,
      modelManager: manager,
      tauriAvailable: true,
    });
    const fallbackInvoke = async <T>(command: string): Promise<T> => {
      if (command === "whisper_status") {
        return {
          version: "1.9.3",
          binaryInstalled: true,
          models: [
            { model: "base", installed: true },
            { model: "small", installed: false },
          ],
        } as T;
      }
      if (command === "whisper_transcribe") {
        order.push("whisper.cpp");
        return {
          text: "Preciso de ajuda.",
          language: "pt",
          durationMs: 100,
          processingMs: 300,
          provider: "whisper.cpp",
          model: "base",
          realTimeFactor: 3,
        } as T;
      }
      return true as T;
    };
    const fallback = new WhisperProvider({
      invoke: fallbackInvoke,
      tauriAvailable: true,
    });
    const provider = new PortuwanaSTTProvider({ primary, fallback });

    await expect(provider.transcribe(createSilentRecording())).resolves.toMatchObject({
      status: "success",
      provider: "whisper.cpp",
    });
    expect(order).toEqual(["faster-whisper", "whisper.cpp"]);
    expect(provider.lastFallbackReason).toBe("worker stopped");
  });

  it("also falls back when Faster-Whisper cannot report its status", async () => {
    const primaryInvoke = async <T>(): Promise<T> => {
      throw new Error("runtime did not start");
    };
    const manager = new FasterWhisperModelManager({
      invoke: primaryInvoke,
      storage: null,
      tauriAvailable: true,
    });
    const primary = new FasterWhisperProvider({
      invoke: primaryInvoke,
      modelManager: manager,
      tauriAvailable: true,
    });
    const fallbackInvoke = async <T>(command: string): Promise<T> => {
      if (command === "whisper_status") {
        return {
          version: "1.9.3",
          binaryInstalled: true,
          models: [
            { model: "base", installed: true },
            { model: "small", installed: false },
          ],
        } as T;
      }
      if (command === "whisper_transcribe") {
        return {
          text: "Ainda não.",
          language: "pt",
          durationMs: 100,
          processingMs: 300,
          provider: "whisper.cpp",
          model: "base",
          realTimeFactor: 3,
        } as T;
      }
      return false as T;
    };
    const provider = new PortuwanaSTTProvider({
      primary,
      fallback: new WhisperProvider({
        invoke: fallbackInvoke,
        tauriAvailable: true,
      }),
    });

    await expect(provider.transcribe(createSilentRecording())).resolves.toMatchObject({
      status: "success",
      provider: "whisper.cpp",
      model: "base",
    });
    expect(provider.lastFallbackReason).toBe("runtime did not start");
  });
});
