import { z } from "zod";

export const fasterWhisperModelSchema = z.enum(["base", "small"]);
export const fasterWhisperLanguageSchema = z.enum(["pt", "es", "auto"]);

export const fasterWhisperConfigSchema = z.object({
  model: fasterWhisperModelSchema,
  language: fasterWhisperLanguageSchema,
  translate: z.literal(false),
  timeoutMs: z.number().int().min(1_000).max(120_000),
  initialPrompt: z.string().max(800),
  contextScope: z.string().trim().min(1).max(80),
});

export type FasterWhisperModel = z.infer<typeof fasterWhisperModelSchema>;
export type FasterWhisperLanguage = z.infer<typeof fasterWhisperLanguageSchema>;
export type FasterWhisperConfig = z.infer<typeof fasterWhisperConfigSchema>;

export const airportRecognitionPrompt = [
  "aeroporto",
  "desembarque",
  "retirada de bagagem",
  "bagagem",
  "ajuda",
  "direita",
  "esquerda",
  "obrigado",
  "ainda não",
].join(", ");

export const defaultFasterWhisperConfig: FasterWhisperConfig = Object.freeze({
  model: "small",
  language: "pt",
  translate: false,
  timeoutMs: 45_000,
  initialPrompt: airportRecognitionPrompt,
  contextScope: "airport-arrival",
});
