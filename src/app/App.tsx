import { isTauri } from "@tauri-apps/api/core";
import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioEngine } from "../audio/AudioEngine";
import type { AudioInputDevice, RecordedAudio } from "../audio/audio.types";
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
import { TranscriptPreview } from "../components/dialogue/TranscriptPreview";
import { ContextualFeedback } from "../components/feedback/ContextualFeedback";
import { HelpPopover, type HelpAction } from "../components/help/HelpPopover";
import { LessonComplete } from "../components/lesson/LessonComplete";
import { PauseMenu } from "../components/menu/PauseMenu";
import { PortuguesePower } from "../components/progress/PortuguesePower";
import { SceneProgress } from "../components/progress/SceneProgress";
import {
  type TechnicalStatus,
  type TechnicalStatusItem,
} from "../components/TechnicalStatusPanel";
import { LocalIntentProvider } from "../conversation/LocalIntentProvider";
import { helpLevelByKind } from "../lesson/help";
import type { HelpKind, LessonResolution } from "../lesson/lesson.types";
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
import { airportAgentVoice } from "../speech/voice/airportAgent.voice";
import type { WhisperModel } from "../speech/whisper/whisper.config";
import { WhisperModelManager, type WhisperRuntimeStatus } from "../speech/whisper/WhisperModelManager";
import { WhisperProvider } from "../speech/whisper/WhisperProvider";
import { conversationMachine } from "../state/conversationMachine";
import { getConversationStateName } from "../state/conversation.types";
import { initializeDatabase } from "../storage/database";
import "./styles.css";

interface ReadinessState {
  tauri: TechnicalStatus;
  pixi: TechnicalStatus;
  audio: TechnicalStatus;
  whisper: TechnicalStatus;
  sqlite: TechnicalStatus;
}

const localIntentProvider = new LocalIntentProvider();

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

export default function App() {
  const [snapshot, send] = useMachine(conversationMachine, {
    input: {
      lesson: airportArrivalLesson,
      intentProvider: localIntentProvider,
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
  const [audioDevices, setAudioDevices] = useState<readonly AudioInputDevice[]>([]);
  const [whisperStatus, setWhisperStatus] =
    useState<WhisperRuntimeStatus | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);
  const [showProcessingTime, setShowProcessingTime] = useState(true);
  const [overlayTransforms, setOverlayTransforms] =
    useState<CharacterOverlayTransforms>(initialOverlayTransforms);
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const startedRef = useRef(false);
  const appReadySentRef = useRef(false);
  const readyLoggedRef = useRef(false);
  const startedLessonRef = useRef<string | null>(null);
  const loggedNodeRef = useRef<string | null>(null);
  const loggedResolutionRef = useRef<LessonResolution | null>(null);
  const completionLoggedRef = useRef(false);
  const sceneRef = useRef<AirportSceneHandle>(null);
  const whisperModelManagerRef = useRef<WhisperModelManager | null>(null);
  const whisperProviderRef = useRef<WhisperProvider | null>(null);
  const transcriptionAudioRef = useRef<RecordedAudio | null>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
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
    whisperProviderRef.current = new WhisperProvider({
      modelManager: whisperModelManagerRef.current,
    });
  }
  const context = snapshot.context;
  const machineState = getConversationStateName(snapshot.value);
  const currentNode = context.currentNode ?? airportArrivalLesson.nodes[0];
  const lesson = context.lesson ?? airportArrivalLesson;
  const writeOpen = machineState === "writing";
  const pauseOpen = machineState === "paused";
  const lessonCompleted = machineState === "lessonCompleted";
  const displayedLine =
    context.slowMode && currentNode.slowText
      ? currentNode.slowText
      : currentNode.text;

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

  const refreshWhisperStatus = useCallback(async () => {
    const manager = whisperModelManagerRef.current;
    const provider = whisperProviderRef.current;
    if (!manager || !provider) {
      return;
    }
    try {
      const status = await manager.getStatus();
      const availability = await provider.refreshStatus();
      setWhisperStatus(status);
      setReadiness((current) => ({
        ...current,
        whisper: availability.status === "ready" ? "ready" : "pending",
      }));
    } catch (error) {
      setReadiness((current) => ({ ...current, whisper: "error" }));
      void logger.error("stt.whisper.statusFailed", {
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
        if (state === "listening") {
          send({ type: "MICROPHONE_GRANTED" });
        }
      },
      onLevel: setAudioLevel,
      onSpeechStart: () => send({ type: "SPEECH_DETECTED" }),
      onSpeechEnd: () => send({ type: "SPEECH_ENDED" }),
      onAudioCaptured: (recordedAudio) =>
        send({ type: "AUDIO_CAPTURED", audio: recordedAudio }),
      onNoSpeech: (reason) => {
        if (reason !== "misfire") {
          send({ type: "NO_SPEECH", reason });
        }
      },
      onError: (error) => {
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
  }, [send]);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    void logger.info("app.start", { phase: "1.5" });

    void initializeDatabase()
      .then((result) => {
        setReadiness((current) => ({
          ...current,
          sqlite: result.status === "ready" ? "ready" : "pending",
        }));
      })
      .catch((error: unknown) => {
        setReadiness((current) => ({ ...current, sqlite: "error" }));
        const message = error instanceof Error ? error.message : "unknown error";
        void logger.error("database.error", { message });
        send({ type: "FAIL", error: message });
      });
  }, [send]);

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
    sceneRef.current?.previewExpression(currentNode.expression ?? "neutral");

    const finishWithText = (reason: string) => {
      if (cancelled) {
        return;
      }
      void logger.warn("speech.voice.unavailable", {
        nodeId: currentNode.id,
        reason,
      });
      sceneRef.current?.startSpeaking();
      fallbackTimer = schedule(() => {
        sceneRef.current?.stopSpeaking();
        send({ type: "NPC_AUDIO_END" });
      }, 1_250);
    };

    void npcSpeechRef.current.resolve(currentNode, context.slowMode).then(
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
                  source: plan.source,
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
          send({ type: "TRANSCRIPTION_SUCCEEDED", result });
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
  }, [context.currentNodeId, context.lastRecordedAudio, machineState, send]);

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
    const resolution = context.lastResolution;
    if (!resolution || loggedResolutionRef.current === resolution) {
      return;
    }
    loggedResolutionRef.current = resolution;
    if (resolution.status === "unknown") {
      void logger.warn("lesson.intent.unknown", { nodeId: resolution.fromNodeId });
    } else {
      void logger.info("lesson.intent.resolved", {
        nodeId: resolution.fromNodeId,
        intent: resolution.intent,
        status: resolution.status,
      });
    }
    if (resolution.reward > 0) {
      void logger.info("lesson.power.changed", {
        reward: resolution.reward,
        value: context.power,
      });
    }
  }, [context.lastResolution, context.power]);

  useEffect(() => {
    if (context.feedback === "not-understood") {
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
    send({ type: "REQUEST_MICROPHONE" });
    void audioEngineRef.current?.startListening().catch(() => {
      // AudioEngine reports a typed non-fatal error through callbacks.
    });
  }, [machineState, send]);

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
        send({ type: "REPLAY_NPC", slow: kind === "slower" });
      }
    },
    [context.currentNodeId, send],
  );

  const toggleHelp = useCallback(() => {
    send({ type: context.helpOpen ? "CLOSE_HELP" : "OPEN_HELP" });
  }, [context.helpOpen, send]);

  const restartLesson = useCallback(() => {
    clearTimers();
    void whisperProviderRef.current?.cancel();
    void audioEngineRef.current?.pauseAll();
    setCompletionDismissed(false);
    completionLoggedRef.current = false;
    startedLessonRef.current = null;
    loggedNodeRef.current = null;
    loggedResolutionRef.current = null;
    send({ type: "RESTART" });
    void logger.info("lesson.restarted", { lessonId: context.lessonId });
  }, [clearTimers, context.lessonId, send]);

  const statusItems = useMemo<readonly TechnicalStatusItem[]>(
    () => [
      { label: "Tauri", status: readiness.tauri },
      { label: "PixiJS", status: readiness.pixi },
      { label: "XState", status: "ready" },
      { label: "LessonEngine", status: context.engine ? "ready" : "checking" },
      { label: "Intent local", status: "ready" },
      { label: "Audio", status: readiness.audio },
      { label: "Whisper", status: readiness.whisper },
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
            if (pauseOpen) {
              send({ type: "RESUME" });
            }
            void logger.info("ui.exit.mock");
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
            speaker={currentNode.speaker}
            line={displayedLine}
            translation={currentNode.translation}
            showTranslation={context.showTranslation}
            onReplay={() => handleHelpAction("replay")}
          />
          <ContextualFeedback
            state={context.feedback}
            onRetry={() => send({ type: "RETRY" })}
            onWrite={openWriting}
            onHelp={() => send({ type: "OPEN_HELP" })}
          />
        </div>

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

      {shouldRenderSceneDevControls(import.meta.env.DEV) && (
        <SceneDevControls
          sceneStatus={sceneStatus}
          statusItems={statusItems}
          machineState={machineState}
          currentNodeId={context.currentNodeId}
          nodes={lesson.nodes}
          whisperModel={
            whisperProviderRef.current?.config.model ?? "base"
          }
          whisperStatus={whisperStatus}
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
