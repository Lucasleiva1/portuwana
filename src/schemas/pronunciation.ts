import { z } from "zod";

const wordAssessmentSchema = z.object({
  word: z.string().trim().min(1),
  accuracy: z.number().min(0).max(100),
});

export const pronunciationResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    overallScore: z.number().min(0).max(100),
    fluencyScore: z.number().min(0).max(100),
    accuracyScore: z.number().min(0).max(100),
    words: z.array(wordAssessmentSchema),
  }),
  z.object({
    status: z.literal("notConfigured"),
    reason: z.string().trim().min(1),
  }),
  z.object({
    status: z.literal("error"),
    message: z.string().trim().min(1),
  }),
]);

export type PronunciationResult = z.infer<
  typeof pronunciationResultSchema
>;
