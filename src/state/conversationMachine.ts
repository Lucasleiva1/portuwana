import { assign, fromPromise, setup } from "xstate";
import type { IntentInput, IntentResult } from "../conversation/IntentProvider";
import { createEmptyHelpUsage, nextAvailableHelpLevel } from "../lesson/help";
import { LessonEngine } from "../lesson/LessonEngine";
import type { DialogueNode, Lesson } from "../lesson/lesson.types";
import { applyPowerReward, clampPower } from "../lesson/scoring";
import type {
  ConversationContext,
  ConversationEvent,
  ConversationMachineInput,
} from "./conversation.types";

interface LoadedLesson {
  engine: LessonEngine;
  lesson: Lesson;
  node: DialogueNode;
}

interface IntentAnalysisInput {
  provider: ConversationMachineInput["intentProvider"];
  request: IntentInput;
  forceUnknown: boolean;
}

const loadLesson = fromPromise<LoadedLesson, { lesson: unknown }>(
  async ({ input }) => {
    const engine = new LessonEngine(input.lesson);
    return {
      engine,
      lesson: engine.getLesson(),
      node: engine.start(),
    };
  },
);

const analyzeIntent = fromPromise<IntentResult, IntentAnalysisInput>(
  async ({ input }) => {
    if (input.forceUnknown) {
      return { intent: "unknown", understood: false, confidence: 0 };
    }
    return input.provider.analyze(input.request);
  },
);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected conversation error";
}

function requireEngine(context: ConversationContext): LessonEngine {
  if (!context.engine) {
    throw new Error("LessonEngine is not loaded");
  }
  return context.engine;
}

export const conversationMachine = setup({
  types: {
    context: {} as ConversationContext,
    events: {} as ConversationEvent,
    input: {} as ConversationMachineInput,
  },
  actors: {
    loadLesson,
    analyzeIntent,
  },
  guards: {
    currentNodeIsTerminal: ({ context }) => context.currentNode?.terminal === true,
    resolutionMovesToNode: ({ context }) =>
      context.lastResolution !== null &&
      context.lastResolution.toNodeId !== context.lastResolution.fromNodeId,
  },
  delays: {
    processingResponseDelay: ({ context }) => context.processingDelayMs,
    feedbackDisplayDelay: ({ context }) => context.feedbackDelayMs,
  },
  actions: {
    captureFailure: assign(({ event }) => ({
      error: event.type === "FAIL" ? (event.error ?? "Conversation failed") : "Conversation failed",
    })),
    openWriting: assign({
      helpOpen: false,
      feedback: null,
      lastRecordedAudio: null,
      sttErrorCode: null,
    }),
    submitWrittenText: assign(({ event }) => ({
      lastUserText: event.type === "SUBMIT_TEXT" ? event.text.trim() : null,
      lastTranscript: null,
      helpOpen: false,
      helpMessage: null,
      feedback: null,
    })),
    beginMicrophoneRequest: assign({
      microphonePermission: "requesting",
      audioError: null,
      sttErrorCode: null,
      lastRecordedAudio: null,
      lastTranscript: null,
      helpOpen: false,
      helpMessage: null,
      feedback: null,
    }),
    grantMicrophone: assign({
      microphonePermission: "granted",
      audioError: null,
      sttErrorCode: null,
    }),
    denyMicrophone: assign(({ event }) => ({
      microphonePermission: "denied" as const,
      audioError:
        event.type === "MICROPHONE_DENIED"
          ? (event.message ?? "Não consegui acessar o microfone.")
          : "Não consegui acessar o microfone.",
    })),
    captureAudioError: assign(({ event }) => ({
      audioError:
        event.type === "AUDIO_ERROR" || event.type === "NPC_AUDIO_ERROR"
          ? event.message
          : "O áudio não está disponível.",
      lastRecordedAudio: null,
      sttErrorCode: null,
    })),
    captureNoSpeech: assign(({ event }) => ({
      audioError:
        event.type === "NO_SPEECH" && event.reason === "recording-timeout"
          ? "A gravação demorou demais. Tente novamente."
          : "Não ouvi nada. Tente novamente.",
      lastRecordedAudio: null,
      sttErrorCode: null,
    })),
    captureRecordedAudio: assign(({ event }) => ({
      lastRecordedAudio: event.type === "AUDIO_CAPTURED" ? event.audio : null,
      audioError: null,
      sttErrorCode: null,
    })),
    captureTranscription: assign(({ event }) => ({
      lastUserText:
        event.type === "TRANSCRIPTION_SUCCEEDED"
          ? event.result.text.trim()
          : null,
      lastTranscript:
        event.type === "TRANSCRIPTION_SUCCEEDED" ? event.result : null,
      lastRecordedAudio: null,
      audioError: null,
      sttErrorCode: null,
    })),
    captureTranscriptionFailure: assign(({ event }) => ({
      audioError:
        event.type === "TRANSCRIPTION_FAILED"
          ? event.message
          : "Não consegui processar sua fala. Tente novamente ou escreva sua resposta.",
      sttErrorCode:
        event.type === "TRANSCRIPTION_FAILED" ? event.code : "stt-failed",
      lastRecordedAudio: null,
    })),
    captureTranscriptionTimeout: assign(({ event }) => ({
      audioError:
        event.type === "TRANSCRIPTION_TIMEOUT"
          ? (event.message ??
            "A transcrição demorou demais. Tente novamente ou escreva sua resposta.")
          : "A transcrição demorou demais.",
      sttErrorCode: "timeout",
      lastRecordedAudio: null,
    })),
    captureTranscriptionCancellation: assign({
      audioError: null,
      sttErrorCode: "cancelled",
      lastRecordedAudio: null,
    }),
    dismissAudioError: assign({ audioError: null }),
    syncCurrentNode: assign(({ context }) => {
      const engine = requireEngine(context);
      const node = engine.getCurrentNode();
      return {
        currentNode: node,
        currentNodeId: node.id,
        currentTurn: engine.getCurrentTurn(),
        helpUsage: engine.getHelpUsage(),
        availableHelpLevel: 1 as const,
        helpOpen: false,
        helpMessage: null,
        showTranslation: false,
        slowMode: false,
        feedback: null,
        lastTranscript: null,
      };
    }),
    clearFeedback: assign({ feedback: null }),
    openHelp: assign({ helpOpen: true }),
    closeHelp: assign({ helpOpen: false, helpMessage: null }),
    useHelp: assign(({ context, event }) => {
      if (event.type !== "USE_HELP") {
        return {};
      }
      const engine = requireEngine(context);
      const help = engine.getHelp(event.kind);
      const usage = engine.recordHelp(event.kind);
      return {
        helpUsage: usage,
        availableHelpLevel: nextAvailableHelpLevel(
          context.availableHelpLevel,
          event.kind,
        ),
        helpMessage: help.text,
        showTranslation:
          context.showTranslation || event.kind === "translation",
        slowMode: event.kind === "slower",
      };
    }),
    configureReplay: assign(({ event }) => ({
      helpOpen: false,
      feedback: null,
      slowMode: event.type === "REPLAY_NPC" ? event.slow : false,
    })),
    completeLesson: ({ context }) => {
      requireEngine(context).complete();
    },
    prepareCompletion: assign({
      feedback: null,
      helpOpen: false,
      helpMessage: null,
      showTranslation: false,
      slowMode: false,
    }),
    resetLessonContext: assign(({ context }) => ({
      engine: null,
      lesson: null,
      lessonId: null,
      currentNode: null,
      currentNodeId: null,
      currentTurn: 0,
      totalTurns: 0,
      lastUserText: null,
      lastIntent: null,
      lastIntentResult: null,
      lastResolution: null,
      helpUsage: createEmptyHelpUsage(),
      availableHelpLevel: 1 as const,
      helpOpen: false,
      helpMessage: null,
      showTranslation: false,
      slowMode: false,
      feedback: null,
      power: context.initialPower,
      forceUnknownIntent: false,
      microphonePermission: context.microphonePermission,
      audioError: null,
      sttErrorCode: null,
      lastRecordedAudio: null,
      lastTranscript: null,
      error: null,
    })),
    devJumpToNode: assign(({ context, event }) => {
      if (event.type !== "DEV_JUMP_TO_NODE") {
        return {};
      }
      const engine = requireEngine(context);
      const node = engine.jumpToNode(event.nodeId);
      return {
        currentNode: node,
        currentNodeId: node.id,
        currentTurn: engine.getCurrentTurn(),
        lastResolution: null,
        feedback: null,
        helpUsage: engine.getHelpUsage(),
        availableHelpLevel: 1 as const,
        helpOpen: false,
        helpMessage: null,
        showTranslation: false,
        slowMode: false,
        lastTranscript: null,
      };
    }),
    devForceUnknown: assign(({ event }) => ({
      forceUnknownIntent: event.type === "DEV_FORCE_UNKNOWN" && event.enabled,
    })),
    devSetPower: assign(({ event }) => ({
      power: event.type === "DEV_SET_POWER" ? clampPower(event.value) : 0,
    })),
  },
}).createMachine({
  id: "portuwanaConversation",
  initial: "booting",
  context: ({ input }) => ({
    lessonSource: input.lesson,
    intentProvider: input.intentProvider,
    initialPower: clampPower(input.initialPower ?? 55),
    processingDelayMs: Math.max(0, input.timing?.processingMs ?? 450),
    feedbackDelayMs: Math.max(0, input.timing?.feedbackMs ?? 850),
    engine: null,
    lesson: null,
    lessonId: null,
    currentNode: null,
    currentNodeId: null,
    currentTurn: 0,
    totalTurns: 0,
    lastUserText: null,
    lastIntent: null,
    lastIntentResult: null,
    lastResolution: null,
    helpUsage: createEmptyHelpUsage(),
    availableHelpLevel: 1,
    helpOpen: false,
    helpMessage: null,
    showTranslation: false,
    slowMode: false,
    feedback: null,
    power: clampPower(input.initialPower ?? 55),
    forceUnknownIntent: false,
    microphonePermission: "unknown",
    audioError: null,
    sttErrorCode: null,
    lastRecordedAudio: null,
    lastTranscript: null,
    error: null,
  }),
  on: {
    RESTART: {
      target: ".loadingLesson",
      actions: "resetLessonContext",
    },
    FAIL: {
      target: ".error",
      actions: "captureFailure",
    },
    DEV_JUMP_TO_NODE: {
      target: ".active.npcSpeaking",
      actions: "devJumpToNode",
    },
    DEV_FORCE_UNKNOWN: { actions: "devForceUnknown" },
    DEV_SET_POWER: { actions: "devSetPower" },
  },
  states: {
    booting: {
      on: { APP_READY: "loadingLesson" },
    },
    loadingLesson: {
      invoke: {
        id: "loadLesson",
        src: "loadLesson",
        input: ({ context }) => ({ lesson: context.lessonSource }),
        onDone: {
          target: "active",
          actions: assign(({ event }) => {
            const { engine, lesson, node } = event.output;
            return {
              engine,
              lesson,
              lessonId: lesson.id,
              currentNode: node,
              currentNodeId: node.id,
              currentTurn: engine.getCurrentTurn(),
              totalTurns: engine.getTotalTurns(),
              helpUsage: engine.getHelpUsage(),
              availableHelpLevel: 1 as const,
              error: null,
            };
          }),
        },
        onError: {
          target: "error",
          actions: assign(({ event }) => ({
            error: errorMessage(event.error),
          })),
        },
      },
    },
    active: {
      id: "activeConversation",
      initial: "npcSpeaking",
      on: {
        PAUSE: "#portuwanaConversation.paused",
        OPEN_HELP: { actions: "openHelp" },
        CLOSE_HELP: { actions: "closeHelp" },
        USE_HELP: { actions: "useHelp" },
        DISMISS_AUDIO_ERROR: { actions: "dismissAudioError" },
        REPLAY_NPC: {
          target: ".npcSpeaking",
          actions: "configureReplay",
        },
      },
      states: {
        history: { type: "history" },
        npcSpeaking: {
          on: {
            NPC_AUDIO_START: {},
            NPC_AUDIO_ERROR: {
              actions: "captureAudioError",
            },
            NPC_AUDIO_END: [
              {
                guard: "currentNodeIsTerminal",
                target: "#portuwanaConversation.lessonCompleted",
                actions: ["completeLesson", "prepareCompletion"],
              },
              { target: "waitingForUser" },
            ],
            NPC_FINISHED: [
              {
                guard: "currentNodeIsTerminal",
                target: "#portuwanaConversation.lessonCompleted",
                actions: ["completeLesson", "prepareCompletion"],
              },
              { target: "waitingForUser" },
            ],
          },
        },
        waitingForUser: {
          on: {
            REQUEST_MICROPHONE: {
              target: "requestingMicrophone",
              actions: "beginMicrophoneRequest",
            },
            START_SPEAKING: {
              target: "requestingMicrophone",
              actions: "beginMicrophoneRequest",
            },
            OPEN_WRITING: { target: "writing", actions: "openWriting" },
            RETRY: { actions: "clearFeedback" },
          },
        },
        requestingMicrophone: {
          on: {
            MICROPHONE_GRANTED: {
              target: "listening",
              actions: "grantMicrophone",
            },
            START_LISTENING: {
              target: "listening",
              actions: "grantMicrophone",
            },
            MICROPHONE_DENIED: {
              target: "waitingForUser",
              actions: "denyMicrophone",
            },
            AUDIO_ERROR: {
              target: "waitingForUser",
              actions: "captureAudioError",
            },
            CANCEL_RECORDING: "waitingForUser",
          },
        },
        listening: {
          on: {
            SPEECH_DETECTED: "recording",
            NO_SPEECH: {
              target: "waitingForUser",
              actions: "captureNoSpeech",
            },
            AUDIO_ERROR: {
              target: "waitingForUser",
              actions: "captureAudioError",
            },
            CANCEL_RECORDING: "waitingForUser",
          },
        },
        recording: {
          on: {
            SPEECH_ENDED: "processingAudio",
            NO_SPEECH: {
              target: "waitingForUser",
              actions: "captureNoSpeech",
            },
            AUDIO_ERROR: {
              target: "waitingForUser",
              actions: "captureAudioError",
            },
            CANCEL_RECORDING: "waitingForUser",
          },
        },
        processingAudio: {
          on: {
            AUDIO_CAPTURED: {
              target: "audioReady",
              actions: "captureRecordedAudio",
            },
            AUDIO_ERROR: {
              target: "waitingForUser",
              actions: "captureAudioError",
            },
          },
        },
        audioReady: {
          on: {
            TRANSCRIPTION_STARTED: "transcribing",
            AUDIO_ERROR: {
              target: "waitingForUser",
              actions: "captureAudioError",
            },
          },
        },
        writing: {
          on: {
            SUBMIT_TEXT: {
              target: "analyzingIntent",
              actions: "submitWrittenText",
            },
            CANCEL_WRITING: "waitingForUser",
          },
        },
        processingResponse: {
          after: { processingResponseDelay: "analyzingIntent" },
        },
        analyzingIntent: {
          invoke: {
            id: "analyzeIntent",
            src: "analyzeIntent",
            input: ({ context }) => {
              const engine = requireEngine(context);
              const text = context.lastUserText;
              if (!text) {
                throw new Error("No response is available for intent analysis");
              }
              return {
                provider: context.intentProvider,
                request: {
                  text,
                  locale: engine.getLesson().locale,
                  allowedIntents: engine.getCurrentNode().acceptedIntents,
                },
                forceUnknown: context.forceUnknownIntent,
              };
            },
            onDone: {
              target: "showingFeedback",
              actions: assign(({ context, event }) => {
                const engine = requireEngine(context);
                const intentResult = event.output;
                const resolution = engine.resolveIntent(
                  intentResult.understood ? intentResult.intent : "unknown",
                );
                return {
                  lastIntent: intentResult.intent,
                  lastIntentResult: intentResult,
                  lastResolution: resolution,
                  feedback:
                    resolution.status === "advanced"
                      ? ("understood" as const)
                      : ("not-understood" as const),
                  power: applyPowerReward(context.power, resolution.reward),
                  forceUnknownIntent: false,
                };
              }),
            },
            onError: {
              target: "#portuwanaConversation.error",
              actions: assign(({ event }) => ({
                error: errorMessage(event.error),
              })),
            },
          },
        },
        showingFeedback: {
          after: {
            feedbackDisplayDelay: [
              {
                guard: "resolutionMovesToNode",
                target: "transitioningNode",
              },
              { target: "waitingForUser" },
            ],
          },
          on: {
            RETRY: { target: "waitingForUser", actions: "clearFeedback" },
            OPEN_WRITING: { target: "writing", actions: "openWriting" },
          },
        },
        transitioningNode: {
          entry: "syncCurrentNode",
          always: "npcSpeaking",
        },
        transcribing: {
          on: {
            TRANSCRIPTION_SUCCEEDED: {
              target: "analyzingIntent",
              actions: "captureTranscription",
            },
            TRANSCRIPTION_FAILED: {
              target: "waitingForUser",
              actions: "captureTranscriptionFailure",
            },
            TRANSCRIPTION_TIMEOUT: {
              target: "waitingForUser",
              actions: "captureTranscriptionTimeout",
            },
            TRANSCRIPTION_CANCELLED: {
              target: "waitingForUser",
              actions: "captureTranscriptionCancellation",
            },
            OPEN_WRITING: {
              target: "writing",
              actions: "openWriting",
            },
            AUDIO_ERROR: {
              target: "waitingForUser",
              actions: "captureAudioError",
            },
          },
        },
        pronunciationAssessment: {
          on: { PRONUNCIATION_READY: "waitingForUser" },
        },
      },
    },
    paused: {
      on: { RESUME: "active.history" },
    },
    lessonCompleted: {
      on: { COMPLETE: { actions: "prepareCompletion" } },
    },
    error: {
      on: { RETRY: "loadingLesson" },
    },
  },
});

export type { ConversationEvent } from "./conversation.types";
