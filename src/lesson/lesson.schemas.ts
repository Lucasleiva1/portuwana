import { z } from "zod";
import type { Lesson } from "./lesson.types";

export const vocabularyItemSchema = z
  .object({
    term: z.string().trim().min(1),
    meaning: z.string().trim().min(1),
  })
  .strict();

export const npcLineSchema = z
  .object({
    id: z.string().trim().min(1),
    speaker: z.string().trim().min(1),
    text: z.string().trim().min(1),
    audioAsset: z.string().trim().min(1).optional(),
    slowAudioAsset: z.string().trim().min(1).optional(),
    translation: z.string().trim().min(1).optional(),
    slowText: z.string().trim().min(1).optional(),
    expression: z
      .enum(["neutral", "smile", "confused", "surprised", "serious"])
      .optional(),
    emotion: z.enum(["neutral", "warm", "reassuring", "focused"]).optional(),
    durationMs: z.number().int().positive().optional(),
  })
  .strict();

export const dialogueNodeSchema = z
  .object({
    id: z.string().trim().min(1),
    lineIds: z.array(z.string().trim().min(1)).min(1),
    hint: z.string().trim().min(1).optional(),
    exampleAnswers: z.array(z.string().trim().min(1)).min(1).optional(),
    acceptedIntents: z.array(z.string().trim().min(1)),
    transitions: z.record(z.string().trim().min(1), z.string().trim().min(1)),
    fallbackNodeId: z.string().trim().min(1).optional(),
    powerReward: z.number().int().min(0).max(100).optional(),
    mode: z.enum(["guided-conversation", "guided-practice"]).optional(),
    targetPhrase: z.string().trim().min(1).optional(),
    terminal: z.boolean().optional(),
  })
  .strict();

export const lessonSchema = z
  .object({
    version: z.literal(2),
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    locale: z.literal("pt-BR"),
    level: z.literal("A1"),
    scene: z.literal("airport-arrival"),
    defaultMode: z.enum(["guided-conversation", "guided-practice"]),
    startNodeId: z.string().trim().min(1),
    achievements: z.array(z.string().trim().min(1)).min(1),
    vocabulary: z.array(vocabularyItemSchema).min(1),
    lines: z.array(npcLineSchema).min(1),
    recoveryLineIds: z
      .object({
        unclear: z.array(z.string().trim().min(1)).min(1),
        partial_match: z.array(z.string().trim().min(1)).min(1),
        ambiguous: z.array(z.string().trim().min(1)).min(1),
        off_topic: z.array(z.string().trim().min(1)).min(1),
        silence: z.array(z.string().trim().min(1)).min(1),
      })
      .strict(),
    nodes: z.array(dialogueNodeSchema).min(1),
  })
  .strict()
  .superRefine((lesson, context) => {
    const nodeIds = new Set<string>();
    const lineIds = new Set<string>();

    lesson.lines.forEach((line, index) => {
      if (lineIds.has(line.id)) {
        context.addIssue({
          code: "custom",
          message: "NPC line ids must be unique",
          path: ["lines", index, "id"],
        });
      }
      lineIds.add(line.id);
    });

    lesson.nodes.forEach((node, index) => {
      node.lineIds.forEach((lineId, lineIndex) => {
        if (!lineIds.has(lineId)) {
          context.addIssue({
            code: "custom",
            message: `Dialogue line ${lineId} does not exist`,
            path: ["nodes", index, "lineIds", lineIndex],
          });
        }
      });

      if ((node.mode ?? lesson.defaultMode) === "guided-practice" && !node.targetPhrase) {
        context.addIssue({
          code: "custom",
          message: "Guided practice nodes must define a targetPhrase",
          path: ["nodes", index, "targetPhrase"],
        });
      }

      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: "custom",
          message: "Dialogue node ids must be unique",
          path: ["nodes", index, "id"],
        });
      }
      nodeIds.add(node.id);
    });

    if (!nodeIds.has(lesson.startNodeId)) {
      context.addIssue({
        code: "custom",
        message: "startNodeId must reference an existing dialogue node",
        path: ["startNodeId"],
      });
    }

    lesson.nodes.forEach((node, index) => {
      if (!node.terminal && node.acceptedIntents.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Non-terminal nodes must accept at least one intent",
          path: ["nodes", index, "acceptedIntents"],
        });
      }

      node.acceptedIntents.forEach((intent) => {
        if (!node.transitions[intent]) {
          context.addIssue({
            code: "custom",
            message: `Accepted intent ${intent} must define a transition`,
            path: ["nodes", index, "transitions", intent],
          });
        }
      });

      Object.entries(node.transitions).forEach(([intent, targetId]) => {
        if (!node.acceptedIntents.includes(intent)) {
          context.addIssue({
            code: "custom",
            message: `Transition intent ${intent} must be accepted by the node`,
            path: ["nodes", index, "transitions", intent],
          });
        }
        if (!nodeIds.has(targetId)) {
          context.addIssue({
            code: "custom",
            message: `Transition target ${targetId} does not exist`,
            path: ["nodes", index, "transitions", intent],
          });
        }
      });

      if (node.fallbackNodeId && !nodeIds.has(node.fallbackNodeId)) {
        context.addIssue({
          code: "custom",
          message: "fallbackNodeId must reference an existing dialogue node",
          path: ["nodes", index, "fallbackNodeId"],
        });
      }
    });

    Object.entries(lesson.recoveryLineIds).forEach(([kind, recoveryIds]) => {
      recoveryIds.forEach((lineId, index) => {
        if (!lineIds.has(lineId)) {
          context.addIssue({
            code: "custom",
            message: `Recovery line ${lineId} does not exist`,
            path: ["recoveryLineIds", kind, index],
          });
        }
      });
    });

    if (!lesson.nodes.some((node) => node.terminal)) {
      context.addIssue({
        code: "custom",
        message: "A lesson must contain a terminal node",
        path: ["nodes"],
      });
    }
  });

export function parseLesson(input: unknown): Lesson {
  return lessonSchema.parse(input) as Lesson;
}
