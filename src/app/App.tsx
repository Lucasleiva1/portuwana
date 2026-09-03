import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioEngine } from "../audio/AudioEngine";
import type {
  AudioCaptureState,
  AudioInputDevice,
  RecordedAudio,
} from "../audio/audio.types";
import { AudioError } from "../components/audio/AudioError";
import { MicrophonePermission } from "../components/audio/MicrophonePermission";
import { MicrophoneSelector } from "../components/audio/MicrophoneSelector";
import { BrandMark } from "../components/BrandMark";
import { ConversationControls } from "../components/controls/ConversationControls";
import {
  SceneDevControls,
  shouldRenderSceneDevControls,
} from "../components/development/SceneDevControls";
import { DialoguePanel } from "../components/dialogue/DialoguePanel";
import {
  DictionaryAssistant,
  type ContextualDictionaryRequest,
  type DictionaryVoiceState,
} from "../components/dictionary/DictionaryAssistant";
import type { DictionaryDirection } from "../dictionary/dictionary.types";
import { TranscriptPreview } from "../components/dialogue/TranscriptPreview";
import { ContextualFeedback } from "../components/feedback/ContextualFeedback";
import { HelpPopover, type HelpAction } from "../components/help/HelpPopover";
import { LessonComplete } from "../components/lesson/LessonComplete";
import { PauseMenu } from "../components/menu/PauseMenu";
import { PortuguesePower } from "../components/progress/PortuguesePower";
import { PronunciationHint } from "../components/pronunciation/PronunciationHint";
import { SceneProgress } from "../components/progress/SceneProgress";
import {
  type TechnicalStatus,
  type TechnicalStatusItem,
} from "../components/TechnicalStatusPanel";
import { LocalGuidedConversationProvider } from "../conversation/ConversationProvider";
import { helpLevelByKind } from "../lesson/help";
import type {
  DialogueNode,
  HelpKind,
  LessonResolution,
  NpcLine,
} from "../lesson/lesson.types";
import { airportArrivalLesson } from "../lesson/lessons";
import { logger } from "../logging/logger";
import {
  AirportScene,
  type AirportSceneHandle,
  type AirportSceneStatus,
} from "../scene/AirportScene";
import { airportAgentConfig } from "../scene/character/airportAgent.config";
import type {
  CharacterExpression,
  CharacterOverlayTransforms,
  EyeState,
  FaceOverlayKind,
  FaceOverlayTransform,
  MouthState,
} from "../scene/character/character.types";
import { NpcSpeechService } from "../speech/playback/NpcSpeechService";
import { AzurePronunciationProvider } from "../speech/azure/AzurePronunciationProvider";
import { airportAgentVoice } from "../speech/voice/airportAgent.voice";
import type {
  FasterWhisperLanguage as WhisperLanguage,
  FasterWhisperModel as WhisperModel,
} from "../speech/faster-whisper/fasterWhisper.config";
import {
  FasterWhisperModelManager as WhisperModelManager,
  type FasterWhisperRuntimeStatus as WhisperRuntimeStatus,
} from "../speech/faster-whisper/FasterWhisperModelManager";
import { FasterWhisperProvider } from "../speech/faster-whisper/FasterWhisperProvider";
import { PortuwanaSTTProvider } from "../speech/faster-whisper/PortuwanaSTTProvider";
import { conversationMachine } from "../state/conversationMachine";
import { getConversationStateName } from "../state/conversation.types";
import { initializeDatabase } from "../storage/database";
import {
  LocalPersistence,
  type LocalSettings,
} from "../storage/LocalPersistence";
import "./styles.css";

interface ReadinessState {
  tauri: TechnicalStatus;
  pixi: TechnicalStatus;
  audio: TechnicalStatus;
  whisper: TechnicalStatus;
  sqlite: TechnicalStatus;
}

interface DictionaryVoiceRequest {
  language: WhisperLanguage;
  onStateChange: (state: DictionaryVoiceState) => void;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

type DictionaryVoiceCompletion =
  | { status: "success"; text: string }
  | { status: "error"; reason: string };

const localConversationProvider = new LocalGuidedConversationProvider();

function initialOverlayTransforms(): CharacterOverlayTransforms {
  return {
    eyes: {
      open: { ...airportAgentConfig.eyesTransform.open },
      closed: { ...airportAgentConfig.eyesTransform.closed },
    },
    mouth: {
      closed: { ...airportAgentConfig.mouthTransform.closed },
      mid: { ...airportAgentConfig.mouthTransform.mid },
      open: { ...airportAgentConfig.mouthTransform.open },
    },
  };
}

function persistSafely(
  event: string,
  operation: Promise<unknown> | undefined,
): void {
  if (!operation) {
    return;
  }
  void operation.catch((error: unknown) => {
    void logger.error(event, {
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export default function App() {
  const [snapshot, send] = useMachine(conversationMachine, {
    input: {
      lesson: airportArrivalLesson,
      conversationProvider: localConversationProvider,
      initialPower: 55,
    },
  });
  const [readiness, setReadiness] = useState<ReadinessState>({
    tauri: isTauri() ? "ready" : "pending",
    pixi: "checking",
    audio: "checking",
    whisper: "checking",
    sqlite: "checking",
  });
  const [sceneStatus, setSceneStatus] = useState<AirportSceneStatus | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioCaptureState, setAudioCaptureState] =
    useState<AudioCaptureState>("idle");
  const [audioDevices, setAudioDevices] = useState<readonly AudioInputDevice[]>([]);
  const [whisperStatus, setWhisperStatus] =
    useState<WhisperRuntimeStatus | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);
  const [showProcessingTime, setShowProcessingTime] = useState(true);
  const [overlayTransforms, setOverlayTransforms] =
    useState<CharacterOverlayTransforms>(initialOverlayTransforms);
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const [contextualDictionaryRequest, setContextualDictionaryRequest] =
    useState<ContextualDictionaryRequest | null>(null);
  const [dictionaryCharacter, setDictionaryCharacter] =
    useState<LocalSettings["dictionaryAssistant"]>("female");
  const [dictionarySourcePath, setDictionarySourcePath] = useState<string | null>(null);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const startedRef = useRef(false);
  const appReadySentRef = useRef(false);
  const readyLoggedRef = useRef(false);
  const startedLessonRef = useRef<string | null>(null);
  const loggedNodeRef = useRef<string | null>(null);
  const loggedResolutionRef = useRef<LessonResolution | null>(null);
  const loggedInterpretationRef = useRef<unknown>(null);
  const completionLoggedRef = useRef(false);
  const localPersistenceRef = useRef<LocalPersistence | null>(null);
  const persistedLessonRef = useRef<string | null>(null);
  const persistedInterpretationRef = useRef<unknown>(null);
  const persistedCompletionRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const sessionReadyRef = useRef<Promise<string | null>>(Promise.resolve(null));
  const sceneRef = useRef<AirportSceneHandle>(null);
  const whisperModelManagerRef = useRef<WhisperModelManager | null>(null);
  const whisperProviderRef = useRef<PortuwanaSTTProvider | null>(null);
  const transcriptionAudioRef = useRef<RecordedAudio | null>(null);
  const pronunciationProviderRef = useRef(new AzurePronunciationProvider());
  const pronunciationRequestCounterRef = useRef(0);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const audioCaptureTargetRef = useRef<"lesson" | "dictionary">("lesson");
  const dictionaryVoiceRequestRef = useRef<DictionaryVoiceRequest | null>(null);
  const audioDestroyTimerRef = useRef<number | null>(null);
  const npcSpeechRef = useRef(
    new NpcSpeechService({ voice: airportAgentVoice }),
  );
  const timersRef = useRef(new Set<number>());
  if (!audioEngineRef.current) {
    audioEngineRef.current = new AudioEngine();
  }
  if (!whisperModelManagerRef.current) {
    whisperModelManagerRef.current = new WhisperModelManager();
  }
  if (!whisperProviderRef.current) {
    whisperProviderRef.current = new PortuwanaSTTProvider({
      primary: new FasterWhisperProvider({
        modelManager: whisperModelManagerRef.current,
      }),
    });
  }
  const context = snapshot.context;
  const machineState = getConversationStateName(snapshot.value);
  const currentNode: DialogueNode =
    context.currentNode ?? airportArrivalLesson.nodes[0];
  const currentLine: NpcLine =
    context.currentLine ?? airportArrivalLesson.lines[0];
  const lesson = context.lesson ?? airportArrivalLesson;
  const writeOpen = machineState === "writing";
  const pauseOpen = machineState === "paused";
  const lessonCompleted = machineState === "lessonCompleted";
  const displayedLine =
    context.slowMode && currentLine.slowText
      ? currentLine.slowText
      : currentLine.text;

  const schedule = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      callback();
    }, delay);
    timersRef.current.add(timer);
    return timer;
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  const finishDictionaryVoiceRequest = useCallback(
    (completion: DictionaryVoiceCompletion) => {
      const request = dictionaryVoiceRequestRef.current;
      if (!request) {
        return;
      }
      dictionaryVoiceRequestRef.current = null;
      audioCaptureTargetRef.current = "lesson";
      if (completion.status === "success") {
        request.resolve(completion.text);
      } else {
        request.reject(new Error(completion.reason));
      }
    },
    [],
  );

  const refreshWhisperStatus = useCallback(async () => {
    const manager = whisperModelManagerRef.current;
    const provider = whisperProviderRef.current;
    if (!manager || !provider) {
      return;
    }
    try {
      const availability = await provider.refreshStatus();
      const status = await manager.getStatus();
      setWhisperStatus(status);
      setReadiness((current) => ({
        ...current,
        whisper: availability.status === "ready" ? "ready" : "pending",
      }));
    } catch (error) {
      setReadiness((current) => ({ ...current, whisper: "error" }));
      void logger.error("stt.fasterWhisper.statusFailed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    void refreshWhisperStatus();
    return () => {
      void whisperProviderRef.current?.cancel();
    };
  }, [refreshWhisperStatus]);

  useEffect(() => {
    const audio = audioEngineRef.current;
    if (!audio) {
      return;
    }
    if (audioDestroyTimerRef.current !== null) {
      window.clearTimeout(audioDestroyTimerRef.current);
      audioDestroyTimerRef.current = null;
    }
    audio.setCallbacks({
      onDevicesChanged: setAudioDevices,
      onCaptureStateChanged: (state) => {
        setAudioCaptureState(state);
        if (audioCaptureTargetRef.current === "dictionary") {
          const request = dictionaryVoiceRequestRef.current;
          if (state === "recording") {
            request?.onStateChange("recording");
          } else if (state === "processing") {
            request?.onStateChange("transcribing");
          } else if (state === "requesting" || state === "listening") {
            request?.onStateChange("listening");
          }
          return;
        }
        if (state === "listening") {
          send({ type: "MICROPHONE_GRANTED" });
        }
      },
      onLevel: setAudioLevel,
      onSpeechStart: () => {
        if (audioCaptureTargetRef.current === "dictionary") {
          dictionaryVoiceRequestRef.current?.onStateChange("recording");
          return;
        }
        send({ type: "SPEECH_DETECTED" });
      },
      onSpeechEnd: () => {
        if (audioCaptureTargetRef.current === "dictionary") {
          dictionaryVoiceRequestRef.current?.onStateChange("transcribing");
          return;
        }
        send({ type: "SPEECH_ENDED" });
      },
      onAudioCaptured: (recordedAudio) => {
        if (audioCaptureTargetRef.current === "dictionary") {
          const request = dictionaryVoiceRequestRef.current;
          const provider = whisperProviderRef.current;
          if (!request || !provider) {
            finishDictionaryVoiceRequest({
              status: "error",
              reason: "voice-provider-unavailable",
            });
            return;
          }
          request.onStateChange("transcribing");
          void provider
            .transcribe(recordedAudio, { language: request.language })
            .then((result) => {
              if (result.status === "success") {
                finishDictionaryVoiceRequest({
                  status: "success",
                  text: result.text,
                });
              } else {
                finishDictionaryVoiceRequest({
                  status: "error",
                  reason:
                    result.status === "notConfigured"
                      ? result.reason
                      : result.message,
                });
              }
            })
            .catch((error: unknown) => {
              finishDictionaryVoiceRequest({
                status: "error",
                reason: error instanceof Error ? error.message : "voice-failed",
              });
            });
          return;
        }
        send({ type: "AUDIO_CAPTURED", audio: recordedAudio });
      },
      onNoSpeech: (reason) => {
        if (audioCaptureTargetRef.current === "dictionary") {
          if (reason !== "misfire") {
            finishDictionaryVoiceRequest({ status: "error", reason: "no-speech" });
          }
          return;
        }
        if (reason !== "misfire") {
          send({ type: "NO_SPEECH", reason });
        }
      },
      onError: (error) => {
        if (audioCaptureTargetRef.current === "dictionary") {
          finishDictionaryVoiceRequest({
            status: "error",
            reason: error.message,
          });
          return;
        }
        if (error.code === "permission-denied") {
          send({ type: "MICROPHONE_DENIED", message: error.message });
        } else {
          send({ type: "AUDIO_ERROR", message: error.message });
        }
      },
    });
    void audio
      .initialize()
      .then(() => {
        setReadiness((current) => ({ ...current, audio: "ready" }));
      })
      .catch((error: unknown) => {
        setReadiness((current) => ({ ...current, audio: "error" }));
        void logger.error("audio.initialization.failed", {
          message: error instanceof Error ? error.message : "unknown",
        });
      });

    return () => {
      audio.setCallbacks({});
      audioDestroyTimerRef.current = window.setTimeout(() => {
        void audio.destroy();
        audioDestroyTimerRef.current = null;
      }, 0);
    };
  }, [finishDictionaryVoiceRequest, send]);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    void logger.info("app.start", { phase: "1.5" });

    void initializeDatabase()
      .then(async (result) => {
        setReadiness((current) => ({
          ...current,
          sqlite: result.status === "ready" ? "ready" : "pending",
        }));
        if (result.status === "ready") {
          const persistence = new LocalPersistence(result.database);
          localPersistenceRef.current = persistence;
          const settings = await persistence.initialize();
          setShowTranscript(settings.subtitles);
          setDictionaryCharacter(settings.dictionaryAssistant);
          setDictionarySourcePath(settings.dictionarySourcePath);
          setPersistenceReady(true);
        }
      })
      .catch((error: unknown) => {
        setReadiness((current) => ({ ...current, sqlite: "error" }));
        const message = error instanceof Error ? error.message : String(error);
        void logger.error("database.error", { message });
        send({ type: "FAIL", error: message });
      });
  }, [send]);

  useEffect(() => {
    if (!persistenceReady) {
      return;
    }
    persistSafely(
      "settings.subtitles.saveFailed",
      localPersistenceRef.current?.setSetting("subtitles", showTranscript),
    );
  }, [persistenceReady, showTranscript]);

  useEffect(() => {
    if (
      !appReadySentRef.current &&
      readiness.pixi === "ready" &&
      readiness.sqlite !== "checking" &&
      readiness.sqlite !== "error"
    ) {
      appReadySentRef.current = true;
      send({ type: "APP_READY" });
    }
  }, [readiness.pixi, readiness.sqlite, send]);

  useEffect(() => {
    if (machineState !== "npcSpeaking") {
      return;
    }
    const audio = audioEngineRef.current;
    let cancelled = false;
    let fallbackTimer: number | null = null;
    sceneRef.current?.previewExpression(currentLine.expression ?? "neutral");

    const finishWithText = (reason: string) => {
      if (cancelled) {
        return;
      }
      void logger.warn("speech.voice.unavailable", {
        nodeId: currentNode.id,
        lineId: currentLine.id,
        reason,
      });
      void logger.warn("speech.voice.fallback", {
        nodeId: currentNode.id,
        lineId: currentLine.id,
        fallback: "text",
      });
      sceneRef.current?.startSpeaking();
      fallbackTimer = schedule(() => {
        sceneRef.current?.stopSpeaking();
        send({ type: "NPC_AUDIO_END" });
      }, 1_250);
    };

    void npcSpeechRef.current.resolve(currentLine, context.slowMode).then(
      async (plan) => {
        if (cancelled) {
          return;
        }
        if (plan.mode === "textOnly" || !audio) {
          finishWithText(
            plan.mode === "textOnly" ? plan.reason : "AudioEngine unavailable",
          );
          return;
        }
        try {
          await audio.playback.play({
            source: plan.source === "local" ? plan.url : plan.blob,
            playbackRate: plan.playbackRate,
            callbacks: {
              onStarted: () => {
                sceneRef.current?.startSpeaking();
                send({ type: "NPC_AUDIO_START" });
                void logger.info("speech.npc.started", {
                  nodeId: currentNode.id,
                  lineId: plan.lineId,
                  source: plan.source,
                  cacheHit: plan.cacheHit,
                  slow: context.slowMode,
                });
              },
              onAmplitude: (amplitude) =>
                sceneRef.current?.setSpeechAmplitude(amplitude),
            },
          });
          if (!cancelled) {
            sceneRef.current?.stopSpeaking();
            void logger.info("speech.npc.completed", {
              nodeId: currentNode.id,
              lineId: plan.lineId,
              source: plan.source,
            });
            send({ type: "NPC_AUDIO_END" });
          }
        } catch (error) {
          if (cancelled) {
            return;
          }
          const message = error instanceof Error ? error.message : "Playback failed";
          if (plan.source === "local") {
            void logger.warn("speech.npc.assetMissing", {
              nodeId: currentNode.id,
              lineId: currentLine.id,
              asset: plan.url,
            });
          }
          send({ type: "NPC_AUDIO_ERROR", message });
          finishWithText(message);
        }
      },
    );

    return () => {
      cancelled = true;
      audio?.playback.stop();
      sceneRef.current?.stopSpeaking();
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
        timersRef.current.delete(fallbackTimer);
      }
    };
  }, [
    context.slowMode,
    currentLine,
    currentNode,
    machineState,
    schedule,
    send,
  ]);

  useEffect(() => {
    if (
      !readyLoggedRef.current &&
      readiness.tauri === "ready" &&
      readiness.pixi === "ready" &&
      readiness.audio === "ready" &&
      readiness.sqlite === "ready"
    ) {
      readyLoggedRef.current = true;
      void logger.info("app.ready", { phase: "1.5" });
    }
  }, [readiness]);

  useEffect(() => {
    if (machineState !== "audioReady" || !context.lastRecordedAudio) {
      return;
    }
    const recordedAudio = context.lastRecordedAudio;
    const provider = whisperProviderRef.current;
    if (!provider || transcriptionAudioRef.current === recordedAudio) {
      return;
    }
    transcriptionAudioRef.current = recordedAudio;
    send({ type: "TRANSCRIPTION_STARTED" });
    void logger.info("lesson.response.submitted", {
      source: "microphone-whisper",
      nodeId: context.currentNodeId,
      durationMs: Math.round(recordedAudio.durationMs),
    });
    void provider
      .transcribe(recordedAudio)
      .then((result) => {
        if (result.status === "success") {
          pronunciationRequestCounterRef.current += 1;
          const requestId = `pronunciation-${pronunciationRequestCounterRef.current}`;
          const pronunciationProvider = pronunciationProviderRef.current;
          send({ type: "PRONUNCIATION_REQUESTED", requestId });
          send({ type: "TRANSCRIPTION_SUCCEEDED", result });
          void logger.info("pronunciation.requested", {
            requestId,
            nodeId: currentNode.id,
            provider: pronunciationProvider.id,
            mode: context.conversationMode,
          });
          void pronunciationProvider
            .assess({
              audio: {
                samples: recordedAudio.pcm,
                sampleRate: recordedAudio.sampleRate,
                channels: 1,
              },
              transcript: result.text,
              locale: "pt-BR",
              mode: context.conversationMode,
              ...(currentNode.targetPhrase
                ? { targetText: currentNode.targetPhrase }
                : {}),
            })
            .then((pronunciationResult) => {
              if (pronunciationResult.status === "success") {
                send({
                  type: "PRONUNCIATION_COMPLETED",
                  requestId,
                  result: pronunciationResult,
                });
                void logger.info("pronunciation.completed", {
                  requestId,
                  nodeId: currentNode.id,
                  provider: pronunciationProvider.id,
                  level:
                    pronunciationResult.overallScore >= 90
                      ? "clear"
                      : pronunciationResult.overallScore >= 75
                        ? "good"
                        : pronunciationResult.overallScore >= 55
                          ? "understandable"
                          : "practice",
                });
                return;
              }
              if (pronunciationResult.status === "notConfigured") {
                send({
                  type: "PRONUNCIATION_UNAVAILABLE",
                  requestId,
                  result: pronunciationResult,
                });
                void logger.warn("pronunciation.unavailable", {
                  requestId,
                  nodeId: currentNode.id,
                  provider: pronunciationProvider.id,
                  reason: pronunciationResult.reason,
                });
                return;
              }
              send({
                type: "PRONUNCIATION_FAILED",
                requestId,
                message: pronunciationResult.message,
              });
              void logger.error("pronunciation.error", {
                requestId,
                nodeId: currentNode.id,
                provider: pronunciationProvider.id,
                message: pronunciationResult.message,
              });
            })
            .catch((error: unknown) => {
              const message =
                error instanceof Error
                  ? error.message
                  : "A avaliação de pronúncia falhou.";
              send({ type: "PRONUNCIATION_FAILED", requestId, message });
              void logger.error("pronunciation.error", {
                requestId,
                nodeId: currentNode.id,
                provider: pronunciationProvider.id,
                message,
              });
            });
          return;
        }
        if (result.status === "notConfigured") {
          send({
            type: "TRANSCRIPTION_FAILED",
            code: result.code,
            message: result.reason,
          });
          return;
        }
        if (result.code === "timeout") {
          send({ type: "TRANSCRIPTION_TIMEOUT", message: result.message });
        } else if (result.code === "cancelled") {
          send({ type: "TRANSCRIPTION_CANCELLED" });
        } else {
          send({
            type: "TRANSCRIPTION_FAILED",
            code: result.code,
            message: result.message,
          });
        }
      })
      .catch((error: unknown) => {
        send({
          type: "TRANSCRIPTION_FAILED",
          code: "provider-failed",
          message:
            error instanceof Error
              ? error.message
              : "Não foi possível transcrever o áudio.",
        });
      });
  }, [
    context.conversationMode,
    context.currentNodeId,
    context.lastRecordedAudio,
    currentNode,
    machineState,
    send,
  ]);

  useEffect(() => {
    if (!context.lessonId || !context.currentNodeId) {
      return;
    }
    if (startedLessonRef.current !== context.lessonId) {
      startedLessonRef.current = context.lessonId;
      void logger.info("lesson.started", { lessonId: context.lessonId });
    }
    if (loggedNodeRef.current !== context.currentNodeId) {
      loggedNodeRef.current = context.currentNodeId;
      void logger.info("lesson.node.entered", {
        lessonId: context.lessonId,
        nodeId: context.currentNodeId,
        turn: context.currentTurn,
      });
    }
  }, [context.currentNodeId, context.currentTurn, context.lessonId]);

  useEffect(() => {
    if (
      !persistenceReady ||
      !context.lessonId ||
      persistedLessonRef.current === context.lessonId
    ) {
      return;
    }
    persistedLessonRef.current = context.lessonId;
    const persistence = localPersistenceRef.current;
    if (!persistence) {
      return;
    }
    sessionReadyRef.current = persistence
      .beginLessonSession(context.lessonId)
      .then((sessionId) => {
        sessionIdRef.current = sessionId;
        return sessionId;
      })
      .catch((error: unknown) => {
        void logger.error("session.startFailed", {
          message: error instanceof Error ? error.message : "unknown",
        });
        return null;
      });
  }, [context.lessonId, persistenceReady]);

  useEffect(() => {
    const interpretation = context.lastIntentResult;
    const resolution = context.lastResolution;
    if (!interpretation || loggedInterpretationRef.current === interpretation) {
      return;
    }
    loggedInterpretationRef.current = interpretation;
    loggedResolutionRef.current = resolution;
    const nodeId = resolution?.fromNodeId ?? context.currentNodeId;
    if (interpretation.status === "ambiguous") {
      void logger.warn("lesson.intent.ambiguous", {
        nodeId,
        alternatives: interpretation.alternatives,
      });
    } else if (interpretation.status === "off_topic") {
      void logger.warn("lesson.intent.offTopic", { nodeId });
    } else if (interpretation.status === "understood") {
      void logger.info("lesson.intent.recognized", {
        nodeId,
        intent: interpretation.intent,
        confidence: interpretation.confidence,
      });
    } else {
      void logger.warn("lesson.conversation.recovery", {
        nodeId,
        kind: interpretation.status,
      });
    }
    if (resolution && resolution.reward > 0) {
      void logger.info("lesson.power.changed", {
        reward: resolution.reward,
        value: context.power,
      });
    }
  }, [
    context.currentNodeId,
    context.lastIntentResult,
    context.lastResolution,
    context.power,
  ]);

  useEffect(() => {
    const interpretation = context.lastIntentResult;
    const persistence = localPersistenceRef.current;
    if (
      !persistence ||
      !interpretation ||
      persistedInterpretationRef.current === interpretation ||
      !context.lessonId
    ) {
      return;
    }
    persistedInterpretationRef.current = interpretation;
    const helpUsed = Object.values(context.helpUsage).some((value) => value === true);
    const intent = interpretation.status === "understood" ? interpretation.intent : interpretation.status;
    const lessonId = context.lessonId;
    const sessionPromise = sessionReadyRef.current;
    persistSafely(
      "progress.turnSaveFailed",
      (async () => {
        const sessionId = sessionIdRef.current ?? await sessionPromise;
        if (!sessionId) {
          throw new Error("No hay una sesión persistente activa.");
        }
        await Promise.all([
          persistence.recordTurn(sessionId, intent, helpUsed),
          persistence.saveLessonProgress({
            lessonId,
            score: context.power,
            power: context.power,
            dimensions: context.powerDimensions,
            completed: false,
          }),
        ]);
      })(),
    );
  }, [
    context.helpUsage,
    context.lastIntentResult,
    context.lessonId,
    context.power,
    context.powerDimensions,
  ]);

  useEffect(() => {
    if (context.feedback && context.feedback !== "understood") {
      sceneRef.current?.previewExpression("confused");
    } else if (context.feedback === "understood") {
      sceneRef.current?.previewExpression("neutral");
    }
  }, [context.feedback]);

  useEffect(() => {
    if (lessonCompleted && !completionLoggedRef.current) {
      completionLoggedRef.current = true;
      sceneRef.current?.previewExpression("smile");
      void logger.info("lesson.completed", {
        lessonId: context.lessonId,
        power: context.power,
      });
    }
  }, [context.lessonId, context.power, lessonCompleted]);

  useEffect(() => {
    const persistence = localPersistenceRef.current;
    if (
      !lessonCompleted ||
      persistedCompletionRef.current ||
      !persistence ||
      !context.lessonId
    ) {
      return;
    }
    persistedCompletionRef.current = true;
    const lessonId = context.lessonId;
    const sessionPromise = sessionReadyRef.current;
    persistSafely(
      "progress.completionSaveFailed",
      (async () => {
        const sessionId = sessionIdRef.current ?? await sessionPromise;
        if (!sessionId) {
          throw new Error("No hay una sesión persistente activa.");
        }
        await Promise.all([
          persistence.saveLessonProgress({
            lessonId,
            score: context.power,
            power: context.power,
            dimensions: context.powerDimensions,
            completed: true,
          }),
          persistence.finishLessonSession({
            sessionId,
            status: "completed",
            finalScore: context.power,
            pronunciation: context.pronunciationResult?.status === "success"
              ? context.pronunciationResult.overallScore
              : null,
          }),
        ]);
      })(),
    );
  }, [
    context.lessonId,
    context.power,
    context.powerDimensions,
    context.pronunciationResult,
    lessonCompleted,
  ]);

  const handleSceneReady = useCallback((status: AirportSceneStatus) => {
    setSceneStatus(status);
    setReadiness((current) => ({ ...current, pixi: "ready" }));
  }, []);

  const handleSceneError = useCallback(
    (error: Error) => {
      setReadiness((current) => ({ ...current, pixi: "error" }));
      send({ type: "FAIL", error: error.message });
      void logger.error("scene.error", { message: error.message });
    },
    [send],
  );

  const handleOverlayTransform = useCallback(
    (
      kind: FaceOverlayKind,
      state: EyeState | MouthState,
      transform: FaceOverlayTransform,
    ) => {
      setOverlayTransforms((current) => {
        const next: CharacterOverlayTransforms = {
          eyes: {
            open: { ...current.eyes.open },
            closed: { ...current.eyes.closed },
          },
          mouth: {
            closed: { ...current.mouth.closed },
            mid: { ...current.mouth.mid },
            open: { ...current.mouth.open },
          },
        };
        if (kind === "eyes" && (state === "open" || state === "closed")) {
          next.eyes[state] = transform;
        } else if (
          kind === "mouth" &&
          (state === "closed" || state === "mid" || state === "open")
        ) {
          next.mouth[state] = transform;
        }
        return next;
      });
      sceneRef.current?.setOverlayTransform(kind, state, transform);
    },
    [],
  );

  const handleSpeak = useCallback(() => {
    if (machineState !== "waitingForUser") {
      return;
    }
    audioCaptureTargetRef.current = "lesson";
    send({ type: "REQUEST_MICROPHONE" });
    void audioEngineRef.current?.startListening().catch(() => {
      // AudioEngine reports a typed non-fatal error through callbacks.
    });
  }, [machineState, send]);

  const handleDictionaryVoiceInput = useCallback(
    (
      direction: DictionaryDirection,
      onStateChange: (state: DictionaryVoiceState) => void,
    ) => {
      const audio = audioEngineRef.current;
      if (!audio || audio.captureState !== "idle" || dictionaryVoiceRequestRef.current) {
        return Promise.reject(new Error("audio-busy"));
      }
      const language: WhisperLanguage =
        direction === "es-pt" ? "es" : direction === "pt-es" ? "pt" : "auto";
      return new Promise<string>((resolve, reject) => {
        dictionaryVoiceRequestRef.current = {
          language,
          onStateChange,
          resolve,
          reject,
        };
        audioCaptureTargetRef.current = "dictionary";
        onStateChange("listening");
        void audio.startListening().catch((error: unknown) => {
          finishDictionaryVoiceRequest({
            status: "error",
            reason: error instanceof Error ? error.message : "voice-failed",
          });
        });
      });
    },
    [finishDictionaryVoiceRequest],
  );

  const cancelDictionaryVoiceInput = useCallback(() => {
    if (!dictionaryVoiceRequestRef.current) {
      return;
    }
    void whisperProviderRef.current?.cancel();
    void audioEngineRef.current?.cancelCapture();
    finishDictionaryVoiceRequest({ status: "error", reason: "voice-cancelled" });
  }, [finishDictionaryVoiceRequest]);

  const cancelRecording = useCallback(() => {
    if (machineState === "transcribing") {
      void whisperProviderRef.current?.cancel();
      send({ type: "TRANSCRIPTION_CANCELLED" });
      return;
    }
    void audioEngineRef.current?.cancelCapture();
    send({ type: "CANCEL_RECORDING" });
  }, [machineState, send]);

  const openWriting = useCallback(() => {
    if (machineState === "transcribing") {
      void whisperProviderRef.current?.cancel();
    }
    send({ type: "OPEN_WRITING" });
  }, [machineState, send]);

  const changeWhisperModel = useCallback(
    (model: WhisperModel) => {
      whisperProviderRef.current?.setConfig({ model });
      setReadiness((current) => ({ ...current, whisper: "checking" }));
      void refreshWhisperStatus();
    },
    [refreshWhisperStatus],
  );

  const selectMicrophone = useCallback((deviceId: string) => {
    void audioEngineRef.current?.selectDevice(deviceId).catch((error: unknown) => {
      void logger.error("audio.device.changeFailed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    });
    persistSafely(
      "settings.inputDevice.saveFailed",
      localPersistenceRef.current?.setSetting("inputDeviceId", deviceId),
    );
  }, []);

  const handleWrittenResponse = useCallback(
    (text: string) => {
      if (machineState !== "writing") {
        return;
      }
      void logger.info("lesson.response.submitted", {
        source: "writing",
        nodeId: context.currentNodeId,
      });
      send({ type: "SUBMIT_TEXT", text });
    },
    [context.currentNodeId, machineState, send],
  );

  const handleHelpAction = useCallback(
    (action: HelpAction) => {
      const kind = action as HelpKind;
      send({ type: "USE_HELP", kind });
      void logger.info("lesson.help.used", {
        nodeId: context.currentNodeId,
        kind,
        level: helpLevelByKind[kind],
      });
      if (kind === "replay" || kind === "slower") {
        void logger.info("speech.voice.replay", {
          nodeId: context.currentNodeId,
          lineId: currentLine.id,
          slow: kind === "slower",
        });
        send({ type: "REPLAY_NPC", slow: kind === "slower" });
      }
    },
    [context.currentNodeId, currentLine.id, send],
  );

  const toggleHelp = useCallback(() => {
    send({ type: context.helpOpen ? "CLOSE_HELP" : "OPEN_HELP" });
  }, [context.helpOpen, send]);

  const restartLesson = useCallback(() => {
    clearTimers();
    void whisperProviderRef.current?.cancel();
    void whisperProviderRef.current?.resetContext("airport-arrival");
    void audioEngineRef.current?.pauseAll();
    setCompletionDismissed(false);
    completionLoggedRef.current = false;
    persistedCompletionRef.current = false;
    persistedInterpretationRef.current = null;
    const previousSessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    startedLessonRef.current = null;
    loggedNodeRef.current = null;
    loggedResolutionRef.current = null;
    loggedInterpretationRef.current = null;
    send({ type: "RESTART" });
    const persistence = localPersistenceRef.current;
    const lessonId = context.lessonId;
    sessionReadyRef.current = (async () => {
      if (!persistence || !lessonId) {
        return null;
      }
      if (previousSessionId) {
        try {
          await persistence.finishLessonSession({
            sessionId: previousSessionId,
            status: "abandoned",
            finalScore: context.power,
            pronunciation: null,
          });
        } catch (error) {
          void logger.error("session.restartFinishFailed", {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      try {
        const sessionId = await persistence.beginLessonSession(lessonId);
        sessionIdRef.current = sessionId;
        return sessionId;
      } catch (error) {
        void logger.error("session.restartStartFailed", {
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    })();
    void logger.info("lesson.restarted", { lessonId: context.lessonId });
  }, [clearTimers, context.lessonId, context.power, send]);

  const exitApplication = useCallback(async () => {
    try {
      await sessionReadyRef.current;
      await localPersistenceRef.current?.flush();
    } catch (error) {
      await logger.error("ui.exit.persistenceFailed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    void logger.info("ui.exit.requested");
    if (isTauri()) {
      await getCurrentWindow().close().catch((error: unknown) => {
        void logger.error("ui.exit.failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }
    void logger.warn("ui.exit.unavailable", { reason: "not-running-in-tauri" });
  }, []);

  const statusItems = useMemo<readonly TechnicalStatusItem[]>(
    () => [
      { label: "Tauri", status: readiness.tauri },
      { label: "PixiJS", status: readiness.pixi },
      { label: "XState", status: "ready" },
      { label: "LessonEngine", status: context.engine ? "ready" : "checking" },
      { label: "Conversa guiada", status: "ready" },
      { label: "Audio", status: readiness.audio },
      { label: "Faster-Whisper", status: readiness.whisper },
      { label: "SQLite", status: readiness.sqlite },
    ],
    [context.engine, readiness],
  );

  return (
    <main className="app-shell">
      <AirportScene
        ref={sceneRef}
        onReady={handleSceneReady}
        onError={handleSceneError}
      />
      <div className="scene-vignette" aria-hidden="true" />

      <header className="top-hud">
        <BrandMark />
        <SceneProgress
          title={lesson.title}
          current={context.currentTurn || 1}
          total={context.totalTurns || lesson.nodes.length}
        />
        <PortuguesePower value={context.power} />
        <PauseMenu
          open={pauseOpen}
          onToggle={() => {
            if (pauseOpen) {
              send({ type: "RESUME" });
              return;
            }
            if (machineState === "transcribing") {
              void whisperProviderRef.current?.cancel();
              send({ type: "TRANSCRIPTION_CANCELLED" });
            }
            void audioEngineRef.current?.pauseAll();
            send({ type: "PAUSE" });
          }}
          onRestart={restartLesson}
          onExit={() => {
            void exitApplication();
          }}
        />
      </header>

      <section className="conversation-layer" aria-label="Conversa no aeroporto">
        <div className="conversation-layer__dialogue">
          <TranscriptPreview
            transcript={context.lastTranscript}
            visible={showTranscript}
            showProcessingTime={import.meta.env.DEV && showProcessingTime}
          />
          <DialoguePanel
            speaker={currentLine.speaker}
            line={displayedLine}
            translation={currentLine.translation}
            showTranslation={context.showTranslation}
            onReplay={() => handleHelpAction("replay")}
            onLookupWord={(term) => {
              setContextualDictionaryRequest((current) => ({
                id: (current?.id ?? 0) + 1,
                term,
              }));
              void logger.info("dictionary.contextual.opened", {
                term,
                nodeId: context.currentNodeId,
              });
            }}
          />
          <ContextualFeedback
            state={context.feedback}
            onRetry={() => send({ type: "RETRY" })}
            onWrite={openWriting}
            onHelp={() => send({ type: "OPEN_HELP" })}
          />
        </div>

        <PronunciationHint
          feedback={context.pronunciationFeedback}
          onClose={() => send({ type: "DISMISS_PRONUNCIATION" })}
        />

        {context.helpMessage && (
          <div className="context-tip" role="status">
            {context.helpMessage}
            <button
              type="button"
              onClick={() => send({ type: "CLOSE_HELP" })}
              aria-label="Fechar pista"
            >
              ×
            </button>
          </div>
        )}

        <div className="audio-utility">
          <MicrophoneSelector
            devices={audioDevices}
            selectedDeviceId={
              audioEngineRef.current?.devices.selectedDeviceId ?? null
            }
            onChange={selectMicrophone}
          />
          <MicrophonePermission
            state={context.microphonePermission}
            onRetry={handleSpeak}
          />
          <AudioError
            message={context.audioError}
            onDismiss={() => send({ type: "DISMISS_AUDIO_ERROR" })}
          />
        </div>

        <ConversationControls
          machineState={machineState}
          writeOpen={writeOpen}
          helpOpen={context.helpOpen}
          audioLevel={audioLevel}
          onSpeak={handleSpeak}
          onCancelRecording={cancelRecording}
          onOpenWrite={openWriting}
          onCloseWrite={() => send({ type: "CANCEL_WRITING" })}
          onSubmitWrite={handleWrittenResponse}
          onToggleHelp={toggleHelp}
        />
      </section>

      <HelpPopover
        open={context.helpOpen}
        availableLevel={context.availableHelpLevel}
        onClose={() => send({ type: "CLOSE_HELP" })}
        onAction={handleHelpAction}
      />

      {lessonCompleted && !completionDismissed && (
        <LessonComplete
          title={lesson.title}
          power={context.power}
          achievements={lesson.achievements}
          vocabulary={lesson.vocabulary}
          onRepeat={restartLesson}
          onClose={() => setCompletionDismissed(true)}
        />
      )}

      {lessonCompleted && completionDismissed && (
        <button
          type="button"
          className="lesson-complete-badge"
          onClick={() => setCompletionDismissed(false)}
        >
          Concluído · ver resumo
        </button>
      )}

      {machineState === "error" && (
        <section className="lesson-error" role="alert">
          <span>Não foi possível carregar a lição.</span>
          <p>{context.error ?? "Erro desconhecido"}</p>
          <button type="button" onClick={() => send({ type: "RETRY" })}>
            Tentar novamente
          </button>
        </section>
      )}

      {sceneStatus &&
        (!sceneStatus.backgroundLoaded ||
          sceneStatus.characterMode === "placeholder") && (
          <div className="asset-mode-indicator" aria-hidden="true">
            VISUAL PLACEHOLDER · ASSETS AUTO-DETECT
          </div>
        )}

      <DictionaryAssistant
        contextualRequest={contextualDictionaryRequest}
        initialCharacter={dictionaryCharacter}
        initialSourcePath={dictionarySourcePath}
        onCharacterChange={(next) => {
          setDictionaryCharacter(next);
          persistSafely(
            "settings.dictionaryAssistant.saveFailed",
            localPersistenceRef.current?.setSetting("dictionaryAssistant", next),
          );
        }}
        onSourcePathChange={(path) => {
          setDictionarySourcePath(path);
          persistSafely(
            "settings.dictionarySourcePath.saveFailed",
            localPersistenceRef.current?.setSetting("dictionarySourcePath", path),
          );
        }}
        onVoiceInput={handleDictionaryVoiceInput}
        onCancelVoiceInput={cancelDictionaryVoiceInput}
      />

      {shouldRenderSceneDevControls(import.meta.env.DEV) && (
        <SceneDevControls
          sceneStatus={sceneStatus}
          statusItems={statusItems}
          machineState={machineState}
          currentNodeId={context.currentNodeId}
          nodes={lesson.nodes}
          whisperModel={
            whisperProviderRef.current?.config.model ?? "small"
          }
          whisperStatus={whisperStatus}
          audioCaptureState={audioCaptureState}
          audioLevel={audioLevel}
          microphoneName={
            audioDevices.find(
              (device) =>
                device.deviceId ===
                audioEngineRef.current?.devices.selectedDeviceId,
            )?.label ??
            audioDevices.find((device) => device.isDefault)?.label ??
            "Dispositivo predeterminado"
          }
          lastTranscript={context.lastTranscript}
          showTranscript={showTranscript}
          showProcessingTime={showProcessingTime}
          overlayTransforms={overlayTransforms}
          forceUnknown={context.forceUnknownIntent}
          power={context.power}
          onSpeaking={() => sceneRef.current?.previewSpeaking()}
          onBlink={() => sceneRef.current?.previewBlink()}
          onPreviewEyes={(state) => sceneRef.current?.previewEyes(state)}
          onCalibrationEyes={(state) =>
            sceneRef.current?.setCalibrationEyes(state)
          }
          onCalibrationGrid={(visible) =>
            sceneRef.current?.setCalibrationGrid(visible)
          }
          onOverlayOpacity={(kind, opacity) =>
            sceneRef.current?.setOverlayOpacity(kind, opacity)
          }
          onPreviewMouth={(state) => sceneRef.current?.previewMouth(state)}
          onOverlayTransform={handleOverlayTransform}
          onExpression={(expression: CharacterExpression) =>
            sceneRef.current?.previewExpression(expression)
          }
          onJumpToNode={(nodeId) => send({ type: "DEV_JUMP_TO_NODE", nodeId })}
          onWhisperModel={changeWhisperModel}
          onShowTranscript={setShowTranscript}
          onShowProcessingTime={setShowProcessingTime}
          onForceUnknown={(enabled) =>
            send({ type: "DEV_FORCE_UNKNOWN", enabled })
          }
          onRestart={restartLesson}
          onSetPower={(value) => send({ type: "DEV_SET_POWER", value })}
        />
      )}
    </main>
  );
}
