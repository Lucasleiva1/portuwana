import { z } from "zod";

export const whisperModelSchema = z.enum(["base", "small"]);

export const whisperConfigSchema = z.object({
  model: whisperModelSchema,
  language: z.literal("pt"),
  translate: z.literal(false),
  timeoutMs: z.number().int().min(1_000).max(120_000),
  threads: z.number().int().min(1).max(64).optional(),
});

export type WhisperModel = z.infer<typeof whisperModelSchema>;
export type WhisperConfig = z.infer<typeof whisperConfigSchema>;

export const defaultWhisperConfig: WhisperConfig = Object.freeze({
  model: "base",
  language: "pt",
  translate: false,
  timeoutMs: 45_000,
  threads: 4,
});
