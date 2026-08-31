import { describe, expect, it } from "vitest";
import { lessonSchema } from "../src/lesson/lesson.schemas";
import { airportArrivalLesson } from "../src/lesson/lessons";
import {
  pronunciationResultSchema,
  transcriptResultSchema,
} from "../src/schemas";

describe("Zod schemas", () => {
  it("accepts the complete airport lesson", () => {
    expect(lessonSchema.parse(airportArrivalLesson).id).toBe("airport-arrival-01");
  });

  it("rejects a missing start node", () => {
    expect(
      lessonSchema.safeParse({ ...airportArrivalLesson, startNodeId: "missing" }).success,
    ).toBe(false);
  });

  it("rejects a transition to a missing node", () => {
    const first = airportArrivalLesson.nodes[0];
    const invalid = {
      ...airportArrivalLesson,
      nodes: [
        {
          ...first,
          transitions: { ...first.transitions, need_help: "missing" },
        },
        ...airportArrivalLesson.nodes.slice(1),
      ],
    };
    expect(lessonSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts a controlled notConfigured transcript", () => {
    expect(
      transcriptResultSchema.parse({
        status: "notConfigured",
        code: "model-missing",
        reason: "Whisper is pending",
      }).status,
    ).toBe("notConfigured");
  });

  it("rejects pronunciation scores over 100", () => {
    expect(
      pronunciationResultSchema.safeParse({
        status: "success",
        overallScore: 101,
        fluencyScore: 80,
        accuracyScore: 80,
        words: [],
      }).success,
    ).toBe(false);
  });
});
