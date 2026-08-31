import { createActor, waitFor } from "xstate";
import { describe, expect, it } from "vitest";
import { Recorder } from "../src/audio/Recorder";
import { LocalIntentProvider } from "../src/conversation/LocalIntentProvider";
import { airportArrivalLesson } from "../src/lesson/lessons";
import { conversationMachine } from "../src/state/conversationMachine";
import {
  getConversationStateName,
  type ConversationStateName,
} from "../src/state/conversation.types";

function createTestActor(lesson: unknown = airportArrivalLesson) {
  return createActor(conversationMachine, {
    input: {
      lesson,
      intentProvider: new LocalIntentProvider(),
      initialPower: 55,
      timing: { processingMs: 1, feedbackMs: 1 },
    },
  }).start();
}

async function waitForState(
  actor: ReturnType<typeof createTestActor>,
  state: ConversationStateName,
) {
  return waitFor(actor, (snapshot) => getConversationStateName(snapshot.value) === state, {
    timeout: 1_500,
  });
}

async function startWaiting(actor: ReturnType<typeof createTestActor>) {
  actor.send({ type: "APP_READY" });
  await waitForState(actor, "npcSpeaking");
  actor.send({ type: "NPC_FINISHED" });
  await waitForState(actor, "waitingForUser");
}

describe("conversationMachine", () => {
  it("completes the seven-node lesson using only Escrever", async () => {
    const actor = createTestActor();
    const path = [
      ["Sim, preciso de ajuda.", "baggage-status"],
      ["Ainda não.", "baggage-area"],
      ["Sim.", "ask-location"],
      ["Onde fica?", "direction"],
      ["Entendi.", "direction-confirmation"],
      ["Obrigado.", "closing"],
    ] as const;

    await startWaiting(actor);

    for (const [text, expectedNodeId] of path) {
      actor.send({ type: "OPEN_WRITING" });
      expect(getConversationStateName(actor.getSnapshot().value)).toBe("writing");
      actor.send({ type: "SUBMIT_TEXT", text });
      await waitFor(
        actor,
        (snapshot) =>
          getConversationStateName(snapshot.value) === "npcSpeaking" &&
          snapshot.context.currentNodeId === expectedNodeId,
        { timeout: 1_500 },
      );
      if (expectedNodeId !== "closing") {
        actor.send({ type: "NPC_FINISHED" });
        await waitForState(actor, "waitingForUser");
      }
    }

    actor.send({ type: "NPC_FINISHED" });
    await waitForState(actor, "lessonCompleted");
    expect(actor.getSnapshot().context.currentTurn).toBe(7);
    expect(actor.getSnapshot().context.power).toBe(100);
    expect(actor.getSnapshot().context.engine?.isCompleted()).toBe(true);
    actor.stop();
  });

  it("keeps an unknown answer on the same node and supports retry", async () => {
    const actor = createTestActor();
    await startWaiting(actor);
    actor.send({ type: "OPEN_WRITING" });
    actor.send({ type: "SUBMIT_TEXT", text: "banana aeroporto" });
    await waitForState(actor, "waitingForUser");

    expect(actor.getSnapshot().context.currentNodeId).toBe("welcome");
    expect(actor.getSnapshot().context.feedback).toBe("not-understood");
    expect(actor.getSnapshot().context.power).toBe(55);
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().context.feedback).toBeNull();
    actor.stop();
  });

  it("runs real-audio states before a successful Whisper transcript", async () => {
    const actor = createTestActor();
    await startWaiting(actor);
    actor.send({ type: "REQUEST_MICROPHONE" });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe(
      "requestingMicrophone",
    );
    actor.send({ type: "MICROPHONE_GRANTED" });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe("listening");
    actor.send({ type: "SPEECH_DETECTED" });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe("recording");
    actor.send({ type: "SPEECH_ENDED" });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe(
      "processingAudio",
    );
    const audio = new Recorder().createRecording(
      new Float32Array(3_200).fill(0.1),
      16_000,
    );
    actor.send({ type: "AUDIO_CAPTURED", audio });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe("audioReady");
    actor.send({ type: "TRANSCRIPTION_STARTED" });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe("transcribing");
    actor.send({
      type: "TRANSCRIPTION_SUCCEEDED",
      result: {
        status: "success",
        text: "Pode me ajudar?",
        language: "pt",
        durationMs: 200,
        processingMs: 350,
        provider: "whisper.cpp",
        model: "base",
        realTimeFactor: 1.75,
      },
    });
    await waitFor(
      actor,
      (snapshot) =>
        getConversationStateName(snapshot.value) === "npcSpeaking" &&
        snapshot.context.currentNodeId === "baggage-status",
      { timeout: 1_500 },
    );
    actor.stop();
  });

  it("returns safely to writing after a Whisper timeout", async () => {
    const actor = createTestActor();
    await startWaiting(actor);
    const audio = new Recorder().createRecording(
      new Float32Array(3_200).fill(0.1),
      16_000,
    );
    actor.send({ type: "REQUEST_MICROPHONE" });
    actor.send({ type: "MICROPHONE_GRANTED" });
    actor.send({ type: "SPEECH_DETECTED" });
    actor.send({ type: "SPEECH_ENDED" });
    actor.send({ type: "AUDIO_CAPTURED", audio });
    actor.send({ type: "TRANSCRIPTION_STARTED" });
    actor.send({ type: "TRANSCRIPTION_TIMEOUT" });

    expect(getConversationStateName(actor.getSnapshot().value)).toBe(
      "waitingForUser",
    );
    expect(actor.getSnapshot().context.sttErrorCode).toBe("timeout");
    actor.send({ type: "OPEN_WRITING" });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe("writing");
    actor.stop();
  });

  it("keeps Escrever available after microphone permission is denied", async () => {
    const actor = createTestActor();
    await startWaiting(actor);
    actor.send({ type: "REQUEST_MICROPHONE" });
    actor.send({
      type: "MICROPHONE_DENIED",
      message: "Não consegui acessar o microfone.",
    });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe(
      "waitingForUser",
    );
    expect(actor.getSnapshot().context.microphonePermission).toBe("denied");
    actor.send({ type: "OPEN_WRITING" });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe("writing");
    actor.stop();
  });

  it("does not accept a microphone request while the NPC is speaking", async () => {
    const actor = createTestActor();
    actor.send({ type: "APP_READY" });
    await waitForState(actor, "npcSpeaking");
    actor.send({ type: "REQUEST_MICROPHONE" });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe("npcSpeaking");
    actor.stop();
  });

  it("pauses, resumes and fully restarts", async () => {
    const actor = createTestActor();
    await startWaiting(actor);
    actor.send({ type: "PAUSE" });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe("paused");
    actor.send({ type: "RESUME" });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe("waitingForUser");
    actor.send({ type: "DEV_SET_POWER", value: 90 });
    actor.send({ type: "RESTART" });
    await waitForState(actor, "npcSpeaking");
    expect(actor.getSnapshot().context.currentNodeId).toBe("welcome");
    expect(actor.getSnapshot().context.power).toBe(55);
    actor.stop();
  });

  it("moves to a controlled error state for an invalid lesson", async () => {
    const actor = createTestActor({ ...airportArrivalLesson, startNodeId: "missing" });
    actor.send({ type: "APP_READY" });
    await waitForState(actor, "error");
    expect(actor.getSnapshot().context.error).toContain("startNodeId");
    actor.stop();
  });
});
