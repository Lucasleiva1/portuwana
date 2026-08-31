import type { SpeechProbabilities } from "@ricky0123/vad-web/dist/models";

export const vadAssets = Object.freeze({
  basePath: "/vad/",
  model: "/vad/silero_vad_v5.onnx",
  worklet: "/vad/vad.worklet.bundle.min.js",
  wasmModule: "/vad/ort-wasm-simd-threaded.mjs",
  wasmBinary: "/vad/ort-wasm-simd-threaded.wasm",
});

export interface VadRuntimeVerification {
  moduleAvailable: boolean;
  assets: typeof vadAssets;
}

export interface VadCallbacks {
  onFrame: (frame: Float32Array, speechProbability: number) => void;
  onSpeechStart: () => void;
  onSpeechEnd: (audio: Float32Array) => void;
  onMisfire: () => void;
}

export interface VadInitialization {
  audioContext: AudioContext;
  getStream: () => Promise<MediaStream>;
  pauseStream: (stream: MediaStream) => Promise<void>;
  callbacks: VadCallbacks;
}

export interface VadController {
  initialize(options: VadInitialization): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  destroy(): Promise<void>;
}

interface MicVadInstance {
  start(): Promise<void>;
  pause(): Promise<void>;
  destroy(): Promise<void>;
}

export class VadService implements VadController {
  #instance: MicVadInstance | null = null;

  async verifyBundle(): Promise<VadRuntimeVerification> {
    const vadModule = await import("@ricky0123/vad-web");
    return {
      moduleAvailable: typeof vadModule.MicVAD.new === "function",
      assets: vadAssets,
    };
  }

  async initialize(options: VadInitialization): Promise<void> {
    if (this.#instance) {
      return;
    }
    const { MicVAD } = await import("@ricky0123/vad-web");
    this.#instance = await MicVAD.new({
      model: "v5",
      baseAssetPath: vadAssets.basePath,
      onnxWASMBasePath: vadAssets.basePath,
      audioContext: options.audioContext,
      getStream: options.getStream,
      pauseStream: options.pauseStream,
      resumeStream: options.getStream,
      startOnLoad: false,
      processorType: "auto",
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.42,
      redemptionMs: 900,
      preSpeechPadMs: 320,
      minSpeechMs: 300,
      submitUserSpeechOnPause: false,
      onFrameProcessed: (
        probabilities: SpeechProbabilities,
        frame: Float32Array,
      ) => options.callbacks.onFrame(frame, probabilities.isSpeech),
      onSpeechStart: options.callbacks.onSpeechStart,
      onSpeechRealStart: () => undefined,
      onSpeechEnd: options.callbacks.onSpeechEnd,
      onVADMisfire: options.callbacks.onMisfire,
    });
  }

  async start(): Promise<void> {
    if (!this.#instance) {
      throw new Error("VAD must be initialized before it starts");
    }
    await this.#instance.start();
  }

  async pause(): Promise<void> {
    await this.#instance?.pause();
  }

  async destroy(): Promise<void> {
    await this.#instance?.destroy();
    this.#instance = null;
  }
}
