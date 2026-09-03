import { z } from "zod";

export const transcriptResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    text: z.string().trim().min(1),
    language: z.enum(["pt", "es"]),
    durationMs: z.number().nonnegative(),
    processingMs: z.number().nonnegative(),
    provider: z.enum(["faster-whisper", "whisper.cpp"]),
    model: z.enum(["base", "small"]),
    realTimeFactor: z.number().nonnegative(),
    inferenceMs: z.number().nonnegative().optional(),
    backend: z.enum(["cuda", "cpu"]).optional(),
    computeType: z.string().trim().min(1).optional(),
    runtimeLoadMs: z.number().nonnegative().optional(),
    gpuName: z.string().trim().min(1).nullable().optional(),
    driverVersion: z.string().trim().min(1).nullable().optional(),
    vramTotalMiB: z.number().nonnegative().nullable().optional(),
    vramUsedMiB: z.number().nonnegative().nullable().optional(),
    fallbackReason: z.string().trim().min(1).nullable().optional(),
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
