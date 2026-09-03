import { describe, expect, it, vi } from "vitest";
import { createSilentRecording } from "../src/mocks/audio";
import {
  defaultWhisperConfig,
  whisperConfigSchema,
} from "../src/speech/whisper/whisper.config";
import { WhisperModelManager } from "../src/speech/whisper/WhisperModelManager";
import { WhisperProvider } from "../src/speech/whisper/WhisperProvider";

const readyStatus = {
  version: "1.9.3",
  binaryInstalled: true,
  models: [
    { model: "base" as const, installed: true },
    { model: "small" as const, installed: false },
  ],
};

function readyInvoke(
  transcribe: (args?: Record<string, unknown>) => unknown | Promise<unknown>,
) {
  const mock = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "whisper_status") {
      return readyStatus;
    }
    if (command === "whisper_transcribe") {
      return transcribe(args);
    }
    if (command === "whisper_cancel") {
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

describe("Whisper configuration", () => {
  it("defaults to multilingual base, Portuguese and no translation", () => {
    expect(defaultWhisperConfig).toMatchObject({
      model: "base",
      language: "pt",
      translate: false,
      timeoutMs: 45_000,
    });
    expect(
      whisperConfigSchema.safeParse({
        ...defaultWhisperConfig,
        translate: true,
      }).success,
    ).toBe(false);
    expect(
      whisperConfigSchema.safeParse({
        ...defaultWhisperConfig,
        language: "auto",
      }).success,
    ).toBe(true);
    expect(
      whisperConfigSchema.safeParse({
        ...defaultWhisperConfig,
        language: "en",
      }).success,
    ).toBe(false);
  });

  it("persists only supported model choices and reports fixed assets", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const { invoke } = readyInvoke(() => undefined);
    const manager = new WhisperModelManager({
      invoke,
      storage,
      tauriAvailable: true,
    });

    expect(manager.activeModel).toBe("base");
    manager.setActiveModel("small");
    expect(new WhisperModelManager({ invoke, storage }).activeModel).toBe(
      "small",
    );
    expect(await manager.getStatus()).toEqual(readyStatus);
  });
});

describe("WhisperProvider", () => {
  it("sends WAV bytes through the typed command and returns real metadata", async () => {
    const { invoke } = readyInvoke((args) => {
      const request = args?.request as Record<string, unknown>;
      expect(request.language).toBe("pt");
      expect(request.translate).toBe(false);
      expect(request.model).toBe("base");
      expect(request).not.toHaveProperty("binaryPath");
      expect(request).not.toHaveProperty("modelPath");
      expect((request.audioBytes as number[]).slice(0, 4)).toEqual([
        82, 73, 70, 70,
      ]);
      return {
        text: "Sim, preciso de ajuda.",
        language: "pt",
        durationMs: 100,
        processingMs: 240,
        provider: "whisper.cpp",
        model: "base",
        realTimeFactor: 2.4,
      };
    });
    const provider = new WhisperProvider({ invoke, tauriAvailable: true });

    await expect(provider.transcribe(createSilentRecording())).resolves.toEqual({
      status: "success",
      text: "Sim, preciso de ajuda.",
      language: "pt",
      durationMs: 100,
      processingMs: 240,
      provider: "whisper.cpp",
      model: "base",
      realTimeFactor: 2.4,
    });
  });

  it("maps a native timeout to a typed, recoverable result", async () => {
    const { invoke } = readyInvoke(() =>
      Promise.reject({ code: "timeout", message: "Demorou demais." }),
    );
    const provider = new WhisperProvider({ invoke, tauriAvailable: true });

    await expect(provider.transcribe(createSilentRecording())).resolves.toEqual({
      status: "error",
      code: "timeout",
      message: "Demorou demais.",
    });
  });

  it("can override the language for Spanish dictionary dictation", async () => {
    const { invoke } = readyInvoke((args) => {
      const request = args?.request as Record<string, unknown>;
      expect(request.language).toBe("es");
      return {
        text: "hombre",
        language: "es",
        durationMs: 100,
        processingMs: 150,
        provider: "whisper.cpp",
        model: "base",
        realTimeFactor: 1.5,
      };
    });
    const provider = new WhisperProvider({ invoke, tauriAvailable: true });

    await expect(
      provider.transcribe(createSilentRecording(), { language: "es" }),
    ).resolves.toMatchObject({
      status: "success",
      text: "hombre",
      language: "es",
    });
  });

  it("cancels the active request through its generated request id", async () => {
    const pending: { reject: ((error: unknown) => void) | null } = {
      reject: null,
    };
    const { invoke, mock } = readyInvoke(
      () =>
        new Promise((_resolve, reject) => {
          pending.reject = reject;
        }),
    );
    const provider = new WhisperProvider({ invoke, tauriAvailable: true });
    const transcription = provider.transcribe(createSilentRecording());
    await vi.waitFor(() =>
      expect(
        mock.mock.calls.some(([command]) => command === "whisper_transcribe"),
      ).toBe(true),
    );

    await expect(provider.cancel()).resolves.toBe(true);
    const cancelCall = mock.mock.calls.find(
      ([command]) => command === "whisper_cancel",
    );
    expect(cancelCall?.[1]?.requestId).toEqual(expect.any(String));
    if (!pending.reject) {
      throw new Error("The transcription command did not start");
    }
    pending.reject({ code: "cancelled", message: "Cancelada." });
    await expect(transcription).resolves.toMatchObject({
      status: "error",
      code: "cancelled",
    });
  });
});
