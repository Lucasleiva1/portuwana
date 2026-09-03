import { z } from "zod";

export const intentInputSchema = z
  .object({
    text: z.string().trim().min(1).max(280),
    locale: z.literal("pt-BR"),
    allowedIntents: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const intentResultSchema = z
  .object({
    intent: z.string().trim().min(1),
    status: z.enum([
      "understood",
      "partial_match",
      "ambiguous",
      "off_topic",
      "unclear",
    ]),
    understood: z.boolean(),
    confidence: z.number().min(0).max(1),
    alternatives: z.array(z.string().trim().min(1)),
  })
  .strict();
