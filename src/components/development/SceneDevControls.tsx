import { useState } from "react";
import type { AudioCaptureState } from "../../audio/audio.types";
import type { AirportSceneStatus } from "../../scene/AirportScene";
import type {
  CharacterExpression,
  CharacterOverlayTransforms,
  EyeState,
  FaceOverlayKind,
  FaceOverlayTransform,
  MouthState,
} from "../../scene/character/character.types";
import type { DialogueNode } from "../../lesson/lesson.types";
import type { SuccessfulTranscriptResult } from "../../schemas/transcript";
import type { FasterWhisperModel as WhisperModel } from "../../speech/faster-whisper/fasterWhisper.config";
import type { FasterWhisperRuntimeStatus as WhisperRuntimeStatus } from "../../speech/faster-whisper/FasterWhisperModelManager";
import {
  TechnicalStatusPanel,
  type TechnicalStatusItem,
} from "../TechnicalStatusPanel";

interface SceneDevControlsProps {
  sceneStatus: AirportSceneStatus | null;
  statusItems: readonly TechnicalStatusItem[];
  machineState: string;
  currentNodeId: string | null;
  nodes: readonly DialogueNode[];
  whisperModel: WhisperModel;
  whisperStatus: WhisperRuntimeStatus | null;
  audioCaptureState: AudioCaptureState;
  audioLevel: number;
  microphoneName: string;
  lastTranscript: SuccessfulTranscriptResult | null;
  showTranscript: boolean;
  showProcessingTime: boolean;
  overlayTransforms: CharacterOverlayTransforms;
  forceUnknown: boolean;
  power: number;
  onSpeaking: () => void;
  onBlink: () => void;
  onExpression: (expression: CharacterExpression) => void;
  onPreviewEyes: (state: EyeState) => void;
  onCalibrationEyes: (state: EyeState | null) => void;
  onCalibrationGrid: (visible: boolean) => void;
  onOverlayOpacity: (kind: FaceOverlayKind, opacity: number) => void;
  onPreviewMouth: (state: MouthState) => void;
  onOverlayTransform: (
    kind: FaceOverlayKind,
    state: EyeState | MouthState,
    transform: FaceOverlayTransform,
  ) => void;
  onJumpToNode: (nodeId: string) => void;
  onWhisperModel: (model: WhisperModel) => void;
  onShowTranscript: (visible: boolean) => void;
  onShowProcessingTime: (visible: boolean) => void;
  onForceUnknown: (enabled: boolean) => void;
  onRestart: () => void;
  onSetPower: (value: number) => void;
}

export function shouldRenderSceneDevControls(isDev: boolean): boolean {
  return isDev;
}

interface TransformInputsProps {
  transform: FaceOverlayTransform;
  onChange: (transform: FaceOverlayTransform) => void;
}

function TransformInputs({ transform, onChange }: TransformInputsProps) {
  const update = (
    field: keyof FaceOverlayTransform,
    value: number,
  ) => {
    if (Number.isFinite(value)) {
      onChange({ ...transform, [field]: value });
    }
  };

  return (
    <div className="overlay-calibrator__values">
      {(["x", "y", "scale", "rotation"] as const).map((field) => (
        <label key={field}>
          {field}
          <input
            type="number"
            value={transform[field]}
            step={field === "x" || field === "y" ? 1 : 0.01}
            onChange={(event) => update(field, event.currentTarget.valueAsNumber)}
          />
        </label>
      ))}
    </div>
  );
}

export function SceneDevControls({
  sceneStatus,
  statusItems,
  machineState,
  currentNodeId,
  nodes,
  whisperModel,
  whisperStatus,
  audioCaptureState,
  audioLevel,
  microphoneName,
  lastTranscript,
  showTranscript,
  showProcessingTime,
  overlayTransforms,
  forceUnknown,
  power,
  onSpeaking,
  onBlink,
  onExpression,
  onPreviewEyes,
  onCalibrationEyes,
  onCalibrationGrid,
  onOverlayOpacity,
  onPreviewMouth,
  onOverlayTransform,
  onJumpToNode,
  onWhisperModel,
  onShowTranscript,
  onShowProcessingTime,
  onForceUnknown,
  onRestart,
  onSetPower,
}: SceneDevControlsProps) {
  const [mouthState, setMouthState] = useState<MouthState>("closed");
  const [gridVisible, setGridVisible] = useState(false);
  const [eyeOverlayOpacity, setEyeOverlayOpacity] = useState(1);
  const [mouthOverlayOpacity, setMouthOverlayOpacity] = useState(1);

  return (
    <details className="scene-dev-controls">
      <summary>DEV · SCENE</summary>
      <div className="scene-dev-controls__body">
        <TechnicalStatusPanel
          items={statusItems}
          machineState={machineState}
          phase="FASE 1 · PARTE 8"
        />
        <div className="scene-dev-controls__actions">
          <label>
            Lesson node
            <select
              value={currentNodeId ?? ""}
              onChange={(event) => onJumpToNode(event.currentTarget.value)}
            >
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            STT model
            <select
              value={whisperModel}
              onChange={(event) =>
                onWhisperModel(event.currentTarget.value as WhisperModel)
              }
            >
              <option value="base">
                base{whisperStatus?.model === "base" && whisperStatus.modelInstalled ? " · installed" : " · fallback"}
              </option>
              <option value="small">
                small{whisperStatus?.model === "small" && whisperStatus.modelInstalled ? " · installed" : " · missing"}
              </option>
            </select>
          </label>
          <div className="scene-dev-controls__meta">
            <span>Language: pt</span>
            <span>Micrófono: {microphoneName}</span>
            <span>Captura: {audioCaptureState} · mono 16 kHz</span>
            <span>Nivel RMS: {Math.round(audioLevel * 100)}%</span>
            <span>VAD: Silero v5 · silencio 600 ms · pre-roll 250 ms</span>
            <span>
              Faster-Whisper {whisperStatus?.fasterWhisperVersion ?? "checking"}
            </span>
            <span>CTranslate2 {whisperStatus?.ctranslate2Version ?? "checking"}</span>
            <span>
              Backend: {whisperStatus?.backend ?? "checking"} · {whisperStatus?.computeType ?? "—"}
            </span>
            <span>GPU: {whisperStatus?.gpuName ?? "no detectada"}</span>
            <span>Driver: {whisperStatus?.driverVersion ?? "—"}</span>
            <span>
              VRAM: {whisperStatus?.vramUsedMiB ?? "—"} / {whisperStatus?.vramTotalMiB ?? "—"} MiB
            </span>
            <span>Modelo cargado: {whisperStatus?.loadMs ?? "—"} ms</span>
            <span>Audio: {lastTranscript ? `${Math.round(lastTranscript.durationMs)} ms` : "—"}</span>
            <span>
              Inferencia: {lastTranscript?.inferenceMs != null ? `${Math.round(lastTranscript.inferenceMs)} ms` : "—"}
            </span>
            <span>
              Fin de voz → texto: {lastTranscript ? `${Math.round(lastTranscript.processingMs)} ms` : "—"}
            </span>
            <span>
              RTF: {lastTranscript ? lastTranscript.realTimeFactor.toFixed(2) : "—"}
            </span>
            {whisperStatus?.fallbackReason && (
              <span>Fallback: {whisperStatus.fallbackReason}</span>
            )}
          </div>
          <section className="overlay-calibrator">
            <div className="overlay-calibrator__heading">
              <strong>Eye calibration lab</strong>
              <span>source canvas · 1086 × 1448</span>
            </div>
            <p className="overlay-calibrator__note">
              Coordenadas del lienzo original: origen arriba a la izquierda,
              centro del rig x=543, base y=1448.
            </p>
            <div className="overlay-calibrator__tools">
              <label className="scene-dev-controls__checkbox">
                <input
                  type="checkbox"
                  checked={gridVisible}
                  onChange={(event) => {
                    const visible = event.currentTarget.checked;
                    setGridVisible(visible);
                    onCalibrationGrid(visible);
                  }}
                />
                Grilla + ejes
              </label>
              <label className="overlay-calibrator__opacity">
                Opacidad capa · {Math.round(eyeOverlayOpacity * 100)}%
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={eyeOverlayOpacity}
                  onChange={(event) => {
                    const opacity = event.currentTarget.valueAsNumber;
                    setEyeOverlayOpacity(opacity);
                    onOverlayOpacity("eyes", opacity);
                  }}
                />
              </label>
            </div>
            <div className="overlay-calibrator__group">
              <div className="overlay-calibrator__state">
                <strong>eyes-closed-v2.png</strong>
                <span>base abierta = agent-master-v2.png</span>
              </div>
              <TransformInputs
                transform={overlayTransforms.eyes.closed}
                onChange={(transform) =>
                  onOverlayTransform("eyes", "closed", transform)
                }
              />
              <div className="overlay-calibrator__previews">
                <button
                  type="button"
                  onClick={() => onCalibrationEyes("open")}
                >
                  Base abierta
                </button>
                <button
                  type="button"
                  disabled={!sceneStatus?.availableLayers.includes("eyesClosed")}
                  onClick={() => onCalibrationEyes("closed")}
                >
                  Fijar cerrados
                </button>
                <button
                  type="button"
                  disabled={!sceneStatus?.canBlink}
                  onClick={() => onPreviewEyes("closed")}
                >
                  Vista 1,5 s
                </button>
                <button
                  type="button"
                  disabled={!sceneStatus?.canBlink}
                  onClick={onBlink}
                >
                  Parpadeo 115 ms
                </button>
              </div>
            </div>
            {sceneStatus?.overlaysCalibrated.mouth && <div className="overlay-calibrator__group">
              <div className="overlay-calibrator__state">
                <strong>mouth-mid-v2.png · mouth-open-v2.png</strong>
                <span>base cerrada = agent-master-v2.png</span>
              </div>
              <label className="overlay-calibrator__opacity">
                Opacidad boca · {Math.round(mouthOverlayOpacity * 100)}%
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={mouthOverlayOpacity}
                  onChange={(event) => {
                    const opacity = event.currentTarget.valueAsNumber;
                    setMouthOverlayOpacity(opacity);
                    onOverlayOpacity("mouth", opacity);
                  }}
                />
              </label>
              <label>
                Mouth state
                <select
                  value={mouthState}
                  onChange={(event) =>
                    setMouthState(event.currentTarget.value as MouthState)
                  }
                >
                  <option value="closed">closed</option>
                  <option value="mid">mid</option>
                  <option value="open">open</option>
                </select>
              </label>
              {mouthState !== "closed" && <TransformInputs
                  transform={overlayTransforms.mouth[mouthState]}
                  onChange={(transform) =>
                    onOverlayTransform("mouth", mouthState, transform)
                  }
                />}
              <div className="overlay-calibrator__previews">
                {(["closed", "mid", "open"] as const).map((state) => (
                  <button
                    key={state}
                    type="button"
                    disabled={
                      state !== "closed" &&
                      !sceneStatus?.availableLayers.includes(
                        state === "mid"
                            ? "mouthMid"
                            : "mouthOpen",
                      )
                    }
                    onClick={() => onPreviewMouth(state)}
                  >
                    {state}
                  </button>
                ))}
              </div>
            </div>}
            <pre>{JSON.stringify(overlayTransforms, null, 2)}</pre>
          </section>
          <label className="scene-dev-controls__checkbox">
            <input
              type="checkbox"
              checked={showTranscript}
              onChange={(event) => onShowTranscript(event.currentTarget.checked)}
            />
            Show transcript
          </label>
          <label className="scene-dev-controls__checkbox">
            <input
              type="checkbox"
              checked={showProcessingTime}
              onChange={(event) =>
                onShowProcessingTime(event.currentTarget.checked)
              }
            />
            Show processing time
          </label>
          <label className="scene-dev-controls__checkbox">
            <input
              type="checkbox"
              checked={forceUnknown}
              onChange={(event) => onForceUnknown(event.currentTarget.checked)}
            />
            Force unknown intent once
          </label>
          <label>
            Portuguese Power · {power}%
            <input
              type="range"
              min="0"
              max="100"
              value={power}
              onChange={(event) => onSetPower(event.currentTarget.valueAsNumber)}
            />
          </label>
          <button type="button" onClick={onRestart}>
            Restart lesson
          </button>
          <button
            type="button"
            disabled={!sceneStatus?.canPreviewSpeaking}
            onClick={onSpeaking}
          >
            Preview speaking
          </button>
          <button
            type="button"
            disabled={!sceneStatus?.canBlink}
            onClick={onBlink}
          >
            Preview blink
          </button>
          <label>
            Preview expression
            <select
              defaultValue="neutral"
              disabled={sceneStatus?.characterMode !== "layered"}
              onChange={(event) =>
                onExpression(event.currentTarget.value as CharacterExpression)
              }
            >
              <option value="neutral">Neutral</option>
              <option value="smile">Smile</option>
              <option value="confused">Confused</option>
              <option value="surprised">Surprised</option>
              <option value="serious">Serious</option>
            </select>
          </label>
        </div>
      </div>
    </details>
  );
}
