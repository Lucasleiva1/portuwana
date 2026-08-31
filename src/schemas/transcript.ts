import { z } from "zod";

export const transcriptResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    text: z.string().trim().min(1),
    language: z.literal("pt"),
    durationMs: z.number().nonnegative(),
    processingMs: z.number().nonnegative(),
    provider: z.literal("whisper.cpp"),
    model: z.enum(["base", "small"]),
    realTimeFactor: z.number().nonnegative(),
  }),
  z.object({
    status: z.literal("notConfigured"),
    code: z.enum(["binary-missing", "model-missing", "not-tauri"]),
    reason: z.string().trim().min(1),
  }),
  z.object({
    status: z.literal("error"),
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
  }),
]);

export type TranscriptResult = z.infer<typeof transcriptResultSchema>;
export type SuccessfulTranscriptResult = Extract<
  TranscriptResult,
  { status: "success" }
>;
