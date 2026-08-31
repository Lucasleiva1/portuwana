export class LevelMeter {
  readonly #minimumIntervalMs: number;
  #lastUpdateAt = Number.NEGATIVE_INFINITY;
  #smoothedLevel = 0;

  constructor(updatesPerSecond = 15) {
    this.#minimumIntervalMs = 1_000 / Math.max(1, updatesPerSecond);
  }

  measure(frame: Float32Array, now = performance.now()): number | null {
    if (now - this.#lastUpdateAt < this.#minimumIntervalMs) {
      return null;
    }
    this.#lastUpdateAt = now;
    if (frame.length === 0) {
      this.#smoothedLevel *= 0.72;
      return this.#smoothedLevel;
    }

    let squaredSum = 0;
    frame.forEach((sample) => {
      squaredSum += sample * sample;
    });
    const rms = Math.sqrt(squaredSum / frame.length);
    const normalized = Math.min(1, rms * 4.5);
    this.#smoothedLevel = this.#smoothedLevel * 0.68 + normalized * 0.32;
    return this.#smoothedLevel;
  }

  reset(): void {
    this.#lastUpdateAt = Number.NEGATIVE_INFINITY;
    this.#smoothedLevel = 0;
  }
}
