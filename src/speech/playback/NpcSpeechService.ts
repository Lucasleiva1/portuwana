import type { NpcLine } from "../../lesson/lesson.types";
import type { TTSProvider } from "../providers/types";
import {
  LocalVoiceProvider,
  type VoiceResult,
} from "../providers/LocalVoiceProvider";
import type { NpcVoiceConfig } from "../voice/airportAgent.voice";

export type NpcSpeechPlan =
  | {
      mode: "audio";
      source: "local";
      lineId: string;
      url: string;
      playbackRate: number;
      cacheHit: boolean;
    }
  | {
      mode: "audio";
      source: "tts";
      lineId: string;
      blob: Blob;
      playbackRate: number;
      cacheHit: boolean;
    }
  | {
      mode: "textOnly";
      lineId: string;
      reason: string;
      cacheHit: boolean;
    };

interface NpcSpeechServiceOptions {
  localVoiceProvider?: LocalVoiceProvider | undefined;
  ttsProvider?: TTSProvider | undefined;
  voice: NpcVoiceConfig;
}

function localPlan(
  lineId: string,
  result: VoiceResult,
  cacheHit = false,
): NpcSpeechPlan {
  return {
    mode: "audio",
    source: "local",
    lineId,
    url: result.url,
    playbackRate: result.playbackRate,
    cacheHit,
  };
}

function asCacheHit(plan: NpcSpeechPlan): NpcSpeechPlan {
  return { ...plan, cacheHit: true };
}

export class NpcSpeechService {
  readonly #local: LocalVoiceProvider;
  readonly #tts: TTSProvider | undefined;
  readonly #voice: NpcVoiceConfig;
  readonly #cache = new Map<string, NpcSpeechPlan>();

  constructor(options: NpcSpeechServiceOptions) {
    this.#local = options.localVoiceProvider ?? new LocalVoiceProvider();
    this.#tts = options.ttsProvider;
    this.#voice = options.voice;
  }

  async resolve(line: NpcLine, slow = false): Promise<NpcSpeechPlan> {
    const cacheKey = `${line.id}:${slow ? "slow" : "normal"}`;
    const cached = this.#cache.get(cacheKey);
    if (cached) {
      return asCacheHit(cached);
    }

    const plan = slow
      ? await this.#resolveSlow(line)
      : await this.#resolveNormal(line);
    if (plan.mode === "audio") {
      this.#cache.set(cacheKey, plan);
    }
    return plan;
  }

  clearCache(): void {
    this.#cache.clear();
  }

  async #resolveNormal(line: NpcLine): Promise<NpcSpeechPlan> {
    const local = this.#local.resolveNormal(line);
    if (local) {
      return localPlan(line.id, local);
    }
    return this.#synthesize(line, false);
  }

  async #resolveSlow(line: NpcLine): Promise<NpcSpeechPlan> {
    const preparedSlow = this.#local.resolvePreparedSlow(line);
    if (preparedSlow) {
      return localPlan(line.id, preparedSlow);
    }

    const synthesized = await this.#synthesize(line, true);
    if (synthesized.mode === "audio") {
      return synthesized;
    }

    const rateFallback = this.#local.resolveRateFallback(line);
    if (rateFallback) {
      return localPlan(line.id, rateFallback);
    }
    return synthesized;
  }

  async #synthesize(line: NpcLine, slow: boolean): Promise<NpcSpeechPlan> {
    if (!this.#tts) {
      return {
        mode: "textOnly",
        lineId: line.id,
        reason: "TTS provider is not configured",
        cacheHit: false,
      };
    }
    const availability = this.#tts.getStatus();
    if (availability.status !== "ready") {
      return {
        mode: "textOnly",
        lineId: line.id,
        reason: availability.reason,
        cacheHit: false,
      };
    }

    const baseRate = this.#voice.rate ?? 1;
    const rate = slow ? Math.max(0.7, baseRate * 0.82) : baseRate;
    const result = await this.#tts.synthesize({
      text: line.text,
      locale: this.#voice.locale,
      ...(this.#voice.voiceId ? { voiceId: this.#voice.voiceId } : {}),
      rate,
    });
    if (result.status !== "success") {
      return {
        mode: "textOnly",
        lineId: line.id,
        reason: result.status === "error" ? result.message : result.reason,
        cacheHit: false,
      };
    }
    return {
      mode: "audio",
      source: "tts",
      lineId: line.id,
      blob: new Blob([result.audio], { type: result.mimeType }),
      playbackRate: 1,
      cacheHit: false,
    };
  }
}
