import { logger } from "../logging/logger";
import { SpeechPlaybackEngine } from "../speech/playback/SpeechPlaybackEngine";
import { AudioDeviceService } from "./AudioDeviceService";
import { AudioSessionCoordinator } from "./AudioSessionCoordinator";
import {
  AudioEngineError,
  defaultAudioTimeouts,
  type AudioCaptureState,
  type AudioEngineCallbacks,
  type AudioTimeoutConfig,
  type NoSpeechReason,
} from "./audio.types";
import { LevelMeter } from "./LevelMeter";
import { MicrophoneService } from "./MicrophoneService";
import { Recorder } from "./Recorder";
import { VadService, type VadController } from "./VadService";

interface TimerApi {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timer: number): void;
}

const browserTimers: TimerApi = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (timer) => window.clearTimeout(timer),
};

interface AudioEngineDependencies {
  microphone?: MicrophoneService | undefined;
  devices?: AudioDeviceService | undefined;
  recorder?: Recorder | undefined;
  vad?: VadController | undefined;
  coordinator?: AudioSessionCoordinator | undefined;
  createAudioContext?: (() => AudioContext) | undefined;
  timers?: TimerApi | undefined;
  timeouts?: Partial<AudioTimeoutConfig> | undefined;
}

export class AudioEngine {
  readonly devices: AudioDeviceService;
  readonly playback: SpeechPlaybackEngine;
  readonly #microphone: MicrophoneService;
  readonly #recorder: Recorder;
  readonly #vad: VadController;
  readonly #coordinator: AudioSessionCoordinator;
  readonly #meter = new LevelMeter(15);
  readonly #createAudioContext: () => AudioContext;
  readonly #timers: TimerApi;
  readonly #timeouts: AudioTimeoutConfig;
  #callbacks: AudioEngineCallbacks = {};
  #audioContext: AudioContext | null = null;
  #waitTimer: number | null = null;
  #recordingTimer: number | null = null;
  #vadInitialized = false;
  #captureState: AudioCaptureState = "idle";
  #captureGeneration = 0;
  #disposed = false;

  constructor(dependencies: AudioEngineDependencies = {}) {
    this.#microphone = dependencies.microphone ?? new MicrophoneService();
    this.devices = dependencies.devices ?? new AudioDeviceService();
    this.#recorder = dependencies.recorder ?? new Recorder();
    this.#vad = dependencies.vad ?? new VadService();
    this.#coordinator =
      dependencies.coordinator ?? new AudioSessionCoordinator();
    this.#createAudioContext =
      dependencies.createAudioContext ?? (() => new AudioContext());
    this.#timers = dependencies.timers ?? browserTimers;
    this.#timeouts = {
      maxWaitForSpeechMs:
        dependencies.timeouts?.maxWaitForSpeechMs ??
        defaultAudioTimeouts.maxWaitForSpeechMs,
      maxRecordingMs:
        dependencies.timeouts?.maxRecordingMs ??
        defaultAudioTimeouts.maxRecordingMs,
    };
    this.playback = new SpeechPlaybackEngine(
      this.#coordinator,
      () => this.#getAudioContext(),
    );
  }

  get captureState(): AudioCaptureState {
    return this.#captureState;
  }

  setCallbacks(callbacks: AudioEngineCallbacks): void {
    this.#callbacks = callbacks;
  }

  async initialize(): Promise<void> {
    this.#assertActive();
    this.devices.watch((devices) => {
      this.#callbacks.onDevicesChanged?.(devices);
    });
    try {
      const devices = await this.devices.refresh();
      this.#callbacks.onDevicesChanged?.(devices);
    } catch (error) {
      await logger.warn("audio.device.enumerationFailed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  async startListening(): Promise<void> {
    this.#assertActive();
    const generation = ++this.#captureGeneration;
    if (!this.#coordinator.beginListening()) {
      const error = new AudioEngineError(
        "playback-conflict",
        "Aguarde a personagem terminar de falar.",
      );
      this.#callbacks.onError?.(error);
      throw error;
    }

    this.#setCaptureState("requesting");
    this.#callbacks.onPermissionChanged?.("requesting");
    void logger.info("audio.permission.requested");

    try {
      const context = this.#getAudioContext();
      const resume =
        context.state === "suspended" ? context.resume() : Promise.resolve();
      const microphone = this.#microphone.request(
        this.devices.selectedDeviceId,
      );
      await Promise.all([resume, microphone]);
      if (!this.#isCurrentCapture(generation)) {
        this.#microphone.stop();
        return;
      }
      this.#callbacks.onPermissionChanged?.("granted");
      await logger.info("audio.permission.granted");
      const devices = await this.devices.refresh();
      this.#callbacks.onDevicesChanged?.(devices);
      if (!this.#isCurrentCapture(generation)) {
        this.#microphone.stop();
        return;
      }

      if (!this.#vadInitialized) {
        await this.#vad.initialize({
          audioContext: context,
          getStream: () =>
            this.#microphone.request(this.devices.selectedDeviceId),
          pauseStream: async (stream) => {
            stream.getTracks().forEach((track) => track.stop());
            this.#microphone.stop();
          },
          callbacks: {
            onFrame: (frame) => this.#handleFrame(frame),
            onSpeechStart: () => this.#handleSpeechStart(),
            onSpeechEnd: (audio) => {
              void this.#handleSpeechEnd(audio);
            },
            onMisfire: () => this.#handleMisfire(),
          },
        });
        this.#vadInitialized = true;
      }

      if (!this.#isCurrentCapture(generation)) {
        this.#microphone.stop();
        return;
      }
      await this.#vad.start();
      if (!this.#isCurrentCapture(generation)) {
        await this.#vad.pause();
        this.#microphone.stop();
        return;
      }
      this.#setCaptureState("listening");
      await logger.info("audio.listening.started", {
        deviceSelected: Boolean(this.devices.selectedDeviceId),
      });
      this.#waitTimer = this.#timers.setTimeout(
        () => void this.#handleTimeout("wait-timeout"),
        this.#timeouts.maxWaitForSpeechMs,
      );
    } catch (error) {
      if (!this.#isCurrentCapture(generation)) {
        this.#microphone.stop();
        return;
      }
      const normalized = this.#normalizeError(error);
      const permission = this.#microphone.permission;
      this.#callbacks.onPermissionChanged?.(permission);
      if (permission === "denied") {
        await logger.warn("audio.permission.denied");
      }
      await this.#stopCapture();
      this.#callbacks.onError?.(normalized);
      await logger.error("audio.error", {
        code: normalized.code,
        message: normalized.message,
      });
      throw normalized;
    }
  }

  async cancelCapture(): Promise<void> {
    this.#captureGeneration += 1;
    await this.#stopCapture();
  }

  async selectDevice(deviceId: string): Promise<void> {
    const wasActive = this.#captureState !== "idle";
    if (wasActive) {
      this.#captureGeneration += 1;
      await this.#stopCapture();
    }
    this.devices.select(deviceId);
    if (this.#vadInitialized) {
      await this.#vad.destroy();
      this.#vadInitialized = false;
    }
    await logger.info("audio.device.changed", { deviceId });
  }

  async pauseAll(): Promise<void> {
    this.#captureGeneration += 1;
    this.playback.stop();
    await this.#stopCapture();
  }

  async destroy(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#captureGeneration += 1;
    this.devices.stopWatching();
    await this.#stopCapture();
    await this.#vad.destroy();
    this.playback.destroy();
    if (this.#audioContext && this.#audioContext.state !== "closed") {
      await this.#audioContext.close();
    }
    this.#audioContext = null;
    this.#callbacks = {};
  }

  #getAudioContext(): AudioContext {
    if (!this.#audioContext || this.#audioContext.state === "closed") {
      this.#audioContext = this.#createAudioContext();
    }
    return this.#audioContext;
  }

  #handleFrame(frame: Float32Array): void {
    const level = this.#meter.measure(frame);
    if (level !== null) {
      this.#callbacks.onLevel?.(level);
    }
  }

  #handleSpeechStart(): void {
    if (!this.#coordinator.markRecording()) {
      return;
    }
    this.#clearWaitTimer();
    this.#setCaptureState("recording");
    this.#callbacks.onSpeechStart?.();
    void logger.info("audio.speech.detected");
    this.#recordingTimer = this.#timers.setTimeout(
      () => void this.#handleTimeout("recording-timeout"),
      this.#timeouts.maxRecordingMs,
    );
  }

  async #handleSpeechEnd(pcm: Float32Array): Promise<void> {
    if (this.#captureState !== "recording") {
      return;
    }
    this.#clearTimers();
    this.#callbacks.onSpeechEnd?.();
    await logger.info("audio.speech.ended");
    this.#coordinator.markProcessing();
    this.#setCaptureState("processing");

    try {
      await this.#vad.pause();
      this.#microphone.stop();
      const recording = this.#recorder.createRecording(pcm, 16_000);
      await logger.info("audio.capture.completed", {
        durationMs: Math.round(recording.durationMs),
        sampleRate: recording.sampleRate,
        channels: 1,
      });
      this.#callbacks.onAudioCaptured?.(recording);
    } catch (error) {
      const normalized = new AudioEngineError(
        "empty-recording",
        "A gravação não contém áudio utilizável.",
        error,
      );
      await logger.warn("audio.capture.empty");
      this.#callbacks.onError?.(normalized);
    } finally {
      this.#coordinator.finish();
      this.#setCaptureState("idle");
      this.#meter.reset();
      this.#callbacks.onLevel?.(0);
    }
  }

  #handleMisfire(): void {
    this.#callbacks.onNoSpeech?.("misfire");
    void logger.debug("audio.vad.misfire");
  }

  async #handleTimeout(reason: NoSpeechReason): Promise<void> {
    await logger.warn("audio.timeout", { reason });
    await this.#stopCapture();
    this.#callbacks.onNoSpeech?.(reason);
  }

  async #stopCapture(): Promise<void> {
    this.#clearTimers();
    try {
      await this.#vad.pause();
    } catch {
      // Cleanup remains best-effort when VAD initialization failed.
    }
    this.#microphone.stop();
    this.#coordinator.finish();
    this.#meter.reset();
    this.#callbacks.onLevel?.(0);
    this.#setCaptureState("idle");
  }

  #setCaptureState(state: AudioCaptureState): void {
    this.#captureState = state;
    this.#callbacks.onCaptureStateChanged?.(state);
  }

  #clearWaitTimer(): void {
    if (this.#waitTimer !== null) {
      this.#timers.clearTimeout(this.#waitTimer);
      this.#waitTimer = null;
    }
  }

  #clearTimers(): void {
    this.#clearWaitTimer();
    if (this.#recordingTimer !== null) {
      this.#timers.clearTimeout(this.#recordingTimer);
      this.#recordingTimer = null;
    }
  }

  #normalizeError(error: unknown): AudioEngineError {
    if (error instanceof AudioEngineError) {
      return error;
    }
    return new AudioEngineError(
      "vad-unavailable",
      "Não foi possível iniciar a detecção de voz.",
      error,
    );
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("AudioEngine has already been disposed");
    }
  }

  #isCurrentCapture(generation: number): boolean {
    return !this.#disposed && generation === this.#captureGeneration;
  }
}
