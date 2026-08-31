export interface NpcVoiceConfig {
  locale: "pt-BR";
  provider?: string | undefined;
  voiceId?: string | undefined;
  rate?: number | undefined;
  pitch?: number | undefined;
}

export const airportAgentVoice = Object.freeze({
  locale: "pt-BR",
  rate: 1,
  pitch: 0,
}) satisfies NpcVoiceConfig;
