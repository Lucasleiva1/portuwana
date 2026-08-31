import type { RecordedAudio } from "../audio/audio.types";

export class MockSTTProvider {
  #response: string;

  constructor(initialResponse = "Sim, preciso de ajuda.") {
    this.#response = initialResponse;
  }

  setResponse(response: string): void {
    this.#response = response.trim();
  }

  async transcribe(audio?: RecordedAudio): Promise<string> {
    if (audio && (audio.pcm.length === 0 || audio.durationMs <= 0)) {
      throw new Error("MockSTTProvider received an empty recording");
    }
    return this.#response;
  }
}
