import { describe, expect, it, vi } from "vitest";
import { AudioDeviceService } from "../src/audio/AudioDeviceService";
import { AudioEngine } from "../src/audio/AudioEngine";
import { MicrophoneService } from "../src/audio/MicrophoneService";
import type {
  VadCallbacks,
  VadController,
  VadInitialization,
} from "../src/audio/VadService";

const liveTrack = {
  readyState: "live",
  stop: vi.fn(),
};
const stream = {
  getAudioTracks: () => [liveTrack],
  getTracks: () => [liveTrack],
} as unknown as MediaStream;

class FakeMicrophone extends MicrophoneService {
  stops = 0;

  constructor() {
    super(null);
  }

  override get permission() {
    return "granted" as const;
  }

  override async request(): Promise<MediaStream> {
    return stream;
  }

  override stop(): void {
    this.stops += 1;
  }
}

class DeferredMicrophone extends FakeMicrophone {
  #resolve: ((value: MediaStream) => void) | null = null;

  override request(): Promise<MediaStream> {
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  grant(): void {
    this.#resolve?.(stream);
    this.#resolve = null;
  }
}

class FakeDevices extends AudioDeviceService {
  stoppedWatching = false;

  constructor() {
    super(null, null);
  }

  override async refresh() {
    return [];
  }

  override watch(): void {
    // Device events are covered by AudioDeviceService.test.ts.
  }

  override stopWatching(): void {
    this.stoppedWatching = true;
  }
}

class FakeVad implements VadController {
  callbacks: VadCallbacks | null = null;
  starts = 0;
  pauses = 0;
  destroys = 0;

  async initialize(options: VadInitialization): Promise<void> {
    this.callbacks = options.callbacks;
  }

  async start(): Promise<void> {
    this.starts += 1;
  }

  async pause(): Promise<void> {
    this.pauses += 1;
  }

  async destroy(): Promise<void> {
    this.destroys += 1;
  }
}

class FakeTimers {
  #nextId = 1;
  readonly callbacks = new Map<number, () => void>();

  setTimeout(callback: () => void): number {
    const id = this.#nextId;
    this.#nextId += 1;
    this.callbacks.set(id, callback);
    return id;
  }

  clearTimeout(id: number): void {
    this.callbacks.delete(id);
  }

  runFirst(): void {
    const entry = this.callbacks.entries().next().value as
      | [number, () => void]
      | undefined;
    if (entry) {
      this.callbacks.delete(entry[0]);
      entry[1]();
    }
  }
}

function setupEngine(microphone: FakeMicrophone = new FakeMicrophone()) {
  const devices = new FakeDevices();
  const vad = new FakeVad();
  const timers = new FakeTimers();
  const context = {
    state: "running",
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as AudioContext;
  const engine = new AudioEngine({
    microphone,
    devices,
    vad,
    timers,
    createAudioContext: () => context,
    timeouts: { maxWaitForSpeechMs: 5, maxRecordingMs: 10 },
  });
  return { engine, microphone, devices, vad, timers, context };
}

describe("AudioEngine", () => {
  it("captures VAD speech as in-memory mono 16 kHz WAV", async () => {
    const { engine, vad } = setupEngine();
    const states: string[] = [];
    const captured = vi.fn();
    engine.setCallbacks({
      onCaptureStateChanged: (state) => states.push(state),
      onAudioCaptured: captured,
    });

    await engine.initialize();
    await engine.startListening();
    vad.callbacks?.onSpeechStart();
    vad.callbacks?.onSpeechEnd(new Float32Array(3_200).fill(0.2));

    await vi.waitFor(() => expect(captured).toHaveBeenCalledOnce());
    const recording = captured.mock.calls[0]?.[0];
    expect(recording.sampleRate).toBe(16_000);
    expect(recording.durationMs).toBeCloseTo(200, 2);
    expect(recording.wavBlob.type).toBe("audio/wav");
    expect(states).toEqual(
      expect.arrayContaining(["requesting", "listening", "recording", "processing", "idle"]),
    );
    await engine.destroy();
  });

  it("stops safely after a no-speech timeout", async () => {
    const { engine, timers, microphone, vad, devices, context } = setupEngine();
    const noSpeech = vi.fn();
    engine.setCallbacks({ onNoSpeech: noSpeech });

    await engine.initialize();
    await engine.startListening();
    timers.runFirst();
    await vi.waitFor(() =>
      expect(noSpeech).toHaveBeenCalledWith("wait-timeout"),
    );
    expect(engine.captureState).toBe("idle");
    expect(microphone.stops).toBeGreaterThan(0);
    expect(vad.pauses).toBeGreaterThan(0);

    await engine.destroy();
    expect(vad.destroys).toBe(1);
    expect(devices.stoppedWatching).toBe(true);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("invalidates a permission request that resolves after Cancelar", async () => {
    const microphone = new DeferredMicrophone();
    const { engine } = setupEngine(microphone);
    const states: string[] = [];
    engine.setCallbacks({
      onCaptureStateChanged: (state) => states.push(state),
    });

    const pendingStart = engine.startListening();
    await vi.waitFor(() => expect(engine.captureState).toBe("requesting"));
    await engine.cancelCapture();
    microphone.grant();
    await pendingStart;

    expect(engine.captureState).toBe("idle");
    expect(states[states.length - 1]).toBe("idle");
    expect(states).not.toContain("listening");
    expect(microphone.stops).toBeGreaterThan(0);
    await engine.destroy();
  });
});
