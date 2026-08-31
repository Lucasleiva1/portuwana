import { AudioSessionCoordinator } from "../../audio/AudioSessionCoordinator";
import { AudioEngineError } from "../../audio/audio.types";

export interface SpeechPlaybackCallbacks {
  onStarted?: (() => void) | undefined;
  onEnded?: (() => void) | undefined;
  onFailed?: ((error: Error) => void) | undefined;
  onAmplitude?: ((amplitude: number) => void) | undefined;
}

export interface SpeechPlaybackRequest {
  source: string | Blob;
  playbackRate?: number | undefined;
  callbacks?: SpeechPlaybackCallbacks | undefined;
}

export class SpeechPlaybackEngine {
  readonly #coordinator: AudioSessionCoordinator;
  readonly #getAudioContext: () => AudioContext;
  #audio: HTMLAudioElement | null = null;
  #sourceNode: MediaElementAudioSourceNode | null = null;
  #analyser: AnalyserNode | null = null;
  #meterTimer: number | null = null;
  #objectUrl: string | null = null;
  #playing = false;

  constructor(
    coordinator: AudioSessionCoordinator,
    getAudioContext: () => AudioContext,
  ) {
    this.#coordinator = coordinator;
    this.#getAudioContext = getAudioContext;
  }

  get isPlaying(): boolean {
    return this.#playing;
  }

  async play(request: SpeechPlaybackRequest): Promise<void> {
    this.stop();
    if (!this.#coordinator.beginNpcPlayback()) {
      throw new AudioEngineError(
        "playback-conflict",
        "A reprodução não pode começar enquanto o microfone está ativo.",
      );
    }

    const source =
      typeof request.source === "string"
        ? request.source
        : (this.#objectUrl = URL.createObjectURL(request.source));
    const audio = new Audio(source);
    this.#audio = audio;
    audio.preload = "auto";
    audio.playbackRate = request.playbackRate ?? 1;

    try {
      const context = this.#getAudioContext();
      if (context.state === "suspended") {
        await context.resume();
      }
      const sourceNode = context.createMediaElementSource(audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      sourceNode.connect(analyser);
      analyser.connect(context.destination);
      this.#sourceNode = sourceNode;
      this.#analyser = analyser;
    } catch {
      this.#sourceNode = null;
      this.#analyser = null;
    }

    await new Promise<void>((resolve, reject) => {
      let started = false;
      const cleanupListeners = () => {
        audio.removeEventListener("playing", handlePlaying);
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("error", handleError);
      };
      const handlePlaying = () => {
        if (started) {
          return;
        }
        started = true;
        this.#playing = true;
        this.#startMeter(request.callbacks?.onAmplitude);
        request.callbacks?.onStarted?.();
      };
      const handleEnded = () => {
        cleanupListeners();
        this.#cleanupPlayback();
        request.callbacks?.onEnded?.();
        resolve();
      };
      const handleError = () => {
        const error = new Error("The NPC audio asset could not be played");
        cleanupListeners();
        this.#cleanupPlayback();
        request.callbacks?.onFailed?.(error);
        reject(error);
      };
      audio.addEventListener("playing", handlePlaying);
      audio.addEventListener("ended", handleEnded);
      audio.addEventListener("error", handleError);
      void audio.play().catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error("Playback failed");
        cleanupListeners();
        this.#cleanupPlayback();
        request.callbacks?.onFailed?.(error);
        reject(error);
      });
    });
  }

  stop(): void {
    this.#audio?.pause();
    if (this.#audio) {
      this.#audio.removeAttribute("src");
      this.#audio.load();
    }
    this.#cleanupPlayback();
  }

  destroy(): void {
    this.stop();
  }

  #startMeter(callback?: (amplitude: number) => void): void {
    if (!callback) {
      return;
    }
    const data = new Uint8Array(this.#analyser?.fftSize ?? 32);
    let smoothed = 0;
    this.#meterTimer = window.setInterval(() => {
      if (!this.#analyser) {
        smoothed = smoothed * 0.7 + 0.16;
      } else {
        this.#analyser.getByteTimeDomainData(data);
        let sum = 0;
        data.forEach((value) => {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        });
        const rms = Math.sqrt(sum / data.length);
        smoothed = smoothed * 0.64 + Math.min(1, rms * 5) * 0.36;
      }
      callback(smoothed);
    }, 90);
  }

  #cleanupPlayback(): void {
    if (this.#meterTimer !== null) {
      window.clearInterval(this.#meterTimer);
      this.#meterTimer = null;
    }
    this.#sourceNode?.disconnect();
    this.#analyser?.disconnect();
    this.#sourceNode = null;
    this.#analyser = null;
    this.#audio = null;
    this.#playing = false;
    if (this.#objectUrl) {
      URL.revokeObjectURL(this.#objectUrl);
      this.#objectUrl = null;
    }
    this.#coordinator.finish();
  }
}
