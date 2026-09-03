import { describe, expect, it } from "vitest";
import { LessonEngine } from "../src/lesson/LessonEngine";
import { airportArrivalLesson } from "../src/lesson/lessons";

describe("LessonEngine", () => {
  it("loads the structured lesson and starts at its declared node", () => {
    const engine = new LessonEngine(airportArrivalLesson);

    expect(engine.start().id).toBe("welcome");
    expect(engine.getCurrentLine().id).toBe("welcome-neutral");
    expect(engine.getCurrentTurn()).toBe(1);
    expect(engine.getTotalTurns()).toBe(7);
  });

  it("resolves main transitions and calculates rewards", () => {
    const engine = new LessonEngine(airportArrivalLesson);
    const resolution = engine.resolveIntent("need_help");

    expect(resolution.status).toBe("advanced");
    expect(resolution.toNodeId).toBe("baggage-status");
    expect(resolution.reward).toBe(8);
    expect(engine.getCurrentNode().id).toBe("baggage-status");
  });

  it("does not advance or reward an unknown intent", () => {
    const engine = new LessonEngine(airportArrivalLesson);
    const resolution = engine.resolveIntent("order_coffee");

    expect(resolution.status).toBe("unknown");
    expect(resolution.toNodeId).toBe("welcome");
    expect(resolution.reward).toBe(0);
    expect(engine.getCurrentNode().id).toBe("welcome");
  });

  it("keeps a retry intent on the same node", () => {
    const engine = new LessonEngine(airportArrivalLesson);
    const resolution = engine.resolveIntent("greeting");

    expect(resolution.status).toBe("retry");
    expect(resolution.reward).toBe(0);
    expect(engine.getCurrentNode().id).toBe("welcome");
    expect(engine.getCurrentLine().id).toBe("welcome-warm");
  });

  it("rotates compatible response variants deterministically", () => {
    const engine = new LessonEngine(airportArrivalLesson);
    engine.resolveIntent("greeting");
    expect(engine.getCurrentLine().id).toBe("welcome-warm");
    engine.resolveIntent("greeting");
    expect(engine.getCurrentLine().id).toBe("welcome-neutral");
  });

  it("rotates natural recovery lines without moving the objective", () => {
    const engine = new LessonEngine(airportArrivalLesson);
    expect(engine.selectRecoveryLine("off_topic").id).toBe(
      "recovery-off-topic-1",
    );
    expect(engine.selectRecoveryLine("off_topic").id).toBe(
      "recovery-off-topic-2",
    );
    expect(engine.getCurrentNode().id).toBe("welcome");
  });

  it("applies the progressive help tier to scoring", () => {
    const engine = new LessonEngine(airportArrivalLesson);
    engine.recordHelp("hint");
    const resolution = engine.resolveIntent("need_help");

    expect(resolution.helpUsage.highestLevel).toBe(2);
    expect(resolution.reward).toBe(6);
    expect(engine.getHelpUsage().highestLevel).toBe(0);
  });

  it("restarts all mutable lesson state", () => {
    const engine = new LessonEngine(airportArrivalLesson);
    engine.recordHelp("translation");
    engine.resolveIntent("need_help");
    engine.restart();

    expect(engine.getCurrentNode().id).toBe("welcome");
    expect(engine.getCurrentTurn()).toBe(1);
    expect(engine.getHelpUsage().highestLevel).toBe(0);
    expect(engine.isCompleted()).toBe(false);
  });

  it("only completes from the terminal node", () => {
    const engine = new LessonEngine(airportArrivalLesson);
    expect(() => engine.complete()).toThrow();
    engine.jumpToNode("closing");
    engine.complete();
    expect(engine.isCompleted()).toBe(true);
  });

  it("refuses to start without a lesson", () => {
    expect(() => new LessonEngine().start()).toThrow("No lesson is loaded");
  });
});
