import {
  AudioEngineError,
  type MicrophonePermissionState,
} from "./audio.types";
import {
  browserMediaDevices,
  type MediaDevicesAdapter,
} from "./AudioDeviceService";

function isLive(stream: MediaStream | null): stream is MediaStream {
  return Boolean(
    stream?.getAudioTracks().some((track) => track.readyState === "live"),
  );
}

export class MicrophoneService {
  readonly #mediaDevices: MediaDevicesAdapter | null;
  #stream: MediaStream | null = null;
  #deviceId: string | null = null;
  #permission: MicrophonePermissionState = "unknown";

  constructor(mediaDevices: MediaDevicesAdapter | null = browserMediaDevices()) {
    this.#mediaDevices = mediaDevices;
  }

  get permission(): MicrophonePermissionState {
    return this.#permission;
  }

  async request(deviceId?: string | null): Promise<MediaStream> {
    if (!this.#mediaDevices) {
      this.#permission = "unavailable";
      throw new AudioEngineError(
        "microphone-unavailable",
        "Este dispositivo não disponibiliza acesso ao microfone.",
      );
    }
    if (isLive(this.#stream) && this.#deviceId === (deviceId ?? null)) {
      return this.#stream;
    }

    this.stop();
    this.#permission = "requesting";
    const audio: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (deviceId && deviceId !== "default") {
      audio.deviceId = { exact: deviceId };
    }

    try {
      const stream = await this.#mediaDevices.getUserMedia({ audio });
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((track) => track.stop());
        this.#permission = "unavailable";
        throw new AudioEngineError(
          "microphone-unavailable",
          "Nenhum microfone foi encontrado.",
        );
      }
      this.#stream = stream;
      this.#deviceId = deviceId ?? null;
      this.#permission = "granted";
      return stream;
    } catch (error) {
      if (error instanceof AudioEngineError) {
        throw error;
      }
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        this.#permission = "denied";
        throw new AudioEngineError(
          "permission-denied",
          "Não consegui acessar o microfone.",
          error,
        );
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        this.#permission = "unavailable";
        throw new AudioEngineError(
          "microphone-unavailable",
          "O microfone selecionado não está disponível.",
          error,
        );
      }
      this.#permission = "error";
      throw new AudioEngineError(
        "unknown",
        "Não foi possível iniciar o microfone.",
        error,
      );
    }
  }

  stop(): void {
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    this.#deviceId = null;
  }
}
