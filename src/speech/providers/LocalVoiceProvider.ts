import type { DialogueNode } from "../../lesson/lesson.types";

export interface VoiceResult {
  source: "local";
  url: string;
  playbackRate: number;
}

export class LocalVoiceProvider {
  resolve(node: DialogueNode, slow: boolean): VoiceResult | null {
    if (slow && node.slowAudioAsset) {
      return { source: "local", url: node.slowAudioAsset, playbackRate: 1 };
    }
    if (!node.audioAsset) {
      return null;
    }
    return {
      source: "local",
      url: node.audioAsset,
      playbackRate: slow ? 0.82 : 1,
    };
  }
}
