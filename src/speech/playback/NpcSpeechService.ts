import type { DialogueNode } from "../../lesson/lesson.types";
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
      url: string;
      playbackRate: number;
    }
  | {
      mode: "audio";
      source: "tts";
      blob: Blob;
      playbackRate: number;
    }
  | {
      mode: "textOnly";
      reason: string;
    };

interface NpcSpeechServiceOptions {
  localVoiceProvider?: LocalVoiceProvider | undefined;
  ttsProvider?: TTSProvider | undefined;
  voice: NpcVoiceConfig;
}

function localPlan(result: VoiceResult): NpcSpeechPlan {
  return {
    mode: "audio",
    source: "local",
    url: result.url,
    playbackRate: result.playbackRate,
  };
}

export class NpcSpeechService {
  readonly #local: LocalVoiceProvider;
  readonly #tts: TTSProvider | undefined;
  readonly #voice: NpcVoiceConfig;

  constructor(options: NpcSpeechServiceOptions) {
    this.#local = options.localVoiceProvider ?? new LocalVoiceProvider();
    this.#tts = options.ttsProvider;
    this.#voice = options.voice;
  }

  async resolve(node: DialogueNode, slow = false): Promise<NpcSpeechPlan> {
    const local = this.#local.resolve(node, slow);
    if (local) {
      return localPlan(local);
    }

    if (!this.#tts) {
      return { mode: "textOnly", reason: "TTS provider is not configured" };
    }
    const availability = this.#tts.getStatus();
    if (availability.status !== "ready") {
      return { mode: "textOnly", reason: availability.reason };
    }

    const baseRate = this.#voice.rate ?? 1;
    const rate = slow ? Math.max(0.7, baseRate * 0.82) : baseRate;
    const result = await this.#tts.synthesize({
      text: node.text,
      locale: this.#voice.locale,
      ...(this.#voice.voiceId ? { voiceId: this.#voice.voiceId } : {}),
      rate,
    });
    if (result.status !== "success") {
      return {
        mode: "textOnly",
        reason:
          result.status === "error"
            ? result.message
            : result.reason,
      };
    }
    return {
      mode: "audio",
      source: "tts",
      blob: new Blob([result.audio], { type: result.mimeType }),
      playbackRate: 1,
    };
  }
}
