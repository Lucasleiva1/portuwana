export type AudioSessionMode =
  | "idle"
  | "npcSpeaking"
  | "listening"
  | "recording"
  | "processing";

export class AudioSessionCoordinator {
  #mode: AudioSessionMode = "idle";

  get mode(): AudioSessionMode {
    return this.#mode;
  }

  beginNpcPlayback(): boolean {
    if (this.#mode === "listening" || this.#mode === "recording") {
      return false;
    }
    this.#mode = "npcSpeaking";
    return true;
  }

  beginListening(): boolean {
    if (this.#mode === "npcSpeaking") {
      return false;
    }
    this.#mode = "listening";
    return true;
  }

  markRecording(): boolean {
    if (this.#mode !== "listening") {
      return false;
    }
    this.#mode = "recording";
    return true;
  }

  markProcessing(): void {
    this.#mode = "processing";
  }

  finish(): void {
    this.#mode = "idle";
  }
}
