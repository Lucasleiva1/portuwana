import { createActor, waitFor } from "xstate";
import { describe, expect, it } from "vitest";
import { Recorder } from "../src/audio/Recorder";
import { LocalIntentProvider } from "../src/conversation/LocalIntentProvider";
import { LocalGuidedConversationProvider } from "../src/conversation/ConversationProvider";
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
      conversationProvider: new LocalGuidedConversationProvider(
        new LocalIntentProvider(),
      ),
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
      ["Você consegue me orientar, por favor?", "baggage-status"],
      ["Ainda estou esperando minha mala.", "baggage-area"],
      ["É isso mesmo.", "ask-location"],
      ["Como faço para chegar?", "direction"],
      ["Já entendi, obrigada.", "direction-confirmation"],
      ["Agradeço muito pela ajuda.", "closing"],
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
    await waitForState(actor, "npcSpeaking");
    expect(actor.getSnapshot().context.lastIntentResult?.status).toBe("unclear");
    expect(actor.getSnapshot().context.currentLine?.id).toBe("recovery-unclear-1");
    actor.send({ type: "NPC_FINISHED" });
    await waitForState(actor, "waitingForUser");

    expect(actor.getSnapshot().context.currentNodeId).toBe("welcome");
    expect(actor.getSnapshot().context.feedback).toBe("unclear");
    expect(actor.getSnapshot().context.power).toBe(55);
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().context.feedback).toBeNull();
    actor.stop();
  });

  it("redirects off-topic answers naturally and varies the recovery", async () => {
    const actor = createTestActor();
    await startWaiting(actor);

    for (const expectedLine of [
      "recovery-off-topic-1",
      "recovery-off-topic-2",
    ]) {
      actor.send({ type: "OPEN_WRITING" });
      actor.send({
        type: "SUBMIT_TEXT",
        text: "Quero assistir futebol com meus amigos.",
      });
      await waitForState(actor, "npcSpeaking");
      expect(actor.getSnapshot().context.currentNodeId).toBe("welcome");
      expect(actor.getSnapshot().context.currentLine?.id).toBe(expectedLine);
      expect(actor.getSnapshot().context.feedback).toBe("off_topic");
      actor.send({ type: "NPC_FINISHED" });
      await waitForState(actor, "waitingForUser");
    }
    actor.stop();
  });

  it("handles spoken replay and slow requests without changing the objective", async () => {
    const actor = createTestActor();
    await startWaiting(actor);
    const originalLine = actor.getSnapshot().context.currentLine?.id;

    actor.send({ type: "OPEN_WRITING" });
    actor.send({ type: "SUBMIT_TEXT", text: "Pode repetir?" });
    await waitForState(actor, "npcSpeaking");
    expect(actor.getSnapshot().context.currentLine?.id).toBe(originalLine);
    expect(actor.getSnapshot().context.slowMode).toBe(false);
    actor.send({ type: "NPC_FINISHED" });
    await waitForState(actor, "waitingForUser");

    actor.send({ type: "OPEN_WRITING" });
    actor.send({ type: "SUBMIT_TEXT", text: "Pode falar mais devagar?" });
    await waitForState(actor, "npcSpeaking");
    expect(actor.getSnapshot().context.currentLine?.id).toBe(originalLine);
    expect(actor.getSnapshot().context.slowMode).toBe(true);
    actor.stop();
  });

  it("responds to silence with a non-blocking recovery line", async () => {
    const actor = createTestActor();
    await startWaiting(actor);
    actor.send({ type: "REQUEST_MICROPHONE" });
    actor.send({ type: "MICROPHONE_GRANTED" });
    actor.send({ type: "NO_SPEECH", reason: "wait-timeout" });
    await waitForState(actor, "npcSpeaking");

    expect(actor.getSnapshot().context.currentNodeId).toBe("welcome");
    expect(actor.getSnapshot().context.currentLine?.id).toBe("recovery-silence-1");
    expect(actor.getSnapshot().context.power).toBe(55);
    actor.stop();
  });

  it("continues the conversation while pronunciation completes later", async () => {
    const actor = createTestActor();
    await startWaiting(actor);
    actor.send({
      type: "PRONUNCIATION_REQUESTED",
      requestId: "pronunciation-1",
    });
    actor.send({ type: "OPEN_WRITING" });
    actor.send({ type: "SUBMIT_TEXT", text: "Pode me ajudar?" });
    await waitFor(
      actor,
      (snapshot) =>
        getConversationStateName(snapshot.value) === "npcSpeaking" &&
        snapshot.context.currentNodeId === "baggage-status",
      { timeout: 1_500 },
    );

    actor.send({
      type: "PRONUNCIATION_COMPLETED",
      requestId: "pronunciation-1",
      result: {
        status: "success",
        overallScore: 38,
        fluencyScore: 42,
        accuracyScore: 35,
        words: [{ word: "ajudar", accuracy: 35 }],
      },
    });
    expect(getConversationStateName(actor.getSnapshot().value)).toBe("npcSpeaking");
    expect(actor.getSnapshot().context.power).toBe(63);
    expect(actor.getSnapshot().context.powerDimensions.pronunciation).toBe(55);
    expect(actor.getSnapshot().context.pronunciationFeedback?.recommendation).toContain(
      "ajudar",
    );
    actor.stop();
  });

  it("never subtracts power when the pronunciation provider fails", async () => {
    const actor = createTestActor();
    await startWaiting(actor);
    const power = actor.getSnapshot().context.power;
    actor.send({
      type: "PRONUNCIATION_REQUESTED",
      requestId: "pronunciation-error",
    });
    actor.send({
      type: "PRONUNCIATION_FAILED",
      requestId: "pronunciation-error",
      message: "Provider unavailable",
    });
    expect(actor.getSnapshot().context.power).toBe(power);
    expect(actor.getSnapshot().context.pronunciationStatus).toBe("error");
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
