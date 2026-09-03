import type { NpcLine } from "../../lesson/lesson.types";

export interface VoiceResult {
  source: "local";
  url: string;
  playbackRate: number;
}

export class LocalVoiceProvider {
  resolvePreparedSlow(line: NpcLine): VoiceResult | null {
    if (!line.slowAudioAsset) {
      return null;
    }
    return { source: "local", url: line.slowAudioAsset, playbackRate: 1 };
  }

  resolveNormal(line: NpcLine): VoiceResult | null {
    if (!line.audioAsset) {
      return null;
    }
    return {
      source: "local",
      url: line.audioAsset,
      playbackRate: 1,
    };
  }

  resolveRateFallback(line: NpcLine): VoiceResult | null {
    const normal = this.resolveNormal(line);
    return normal ? { ...normal, playbackRate: 0.82 } : null;
  }
}
