import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Application, Container } from "pixi.js";
import { logger } from "../logging/logger";
import { AirportBackground } from "./airport/AirportBackground";
import {
  resolveAirportAssets,
  type CharacterAssetMode,
} from "./airport/assetManifest";
import { AirportAgent } from "./character/AirportAgent";
import type {
  CharacterExpression,
  EyeState,
  FaceOverlayKind,
  FaceOverlayTransform,
  MouthState,
} from "./character/character.types";

const logicalViewport = { width: 1_600, height: 900 } as const;

export interface AirportSceneStatus {
  backgroundLoaded: boolean;
  characterMode: CharacterAssetMode;
  availableLayers: readonly string[];
  canBlink: boolean;
  canPreviewSpeaking: boolean;
  expressionMode: "full-frame";
  overlaysCalibrated: {
    eyes: boolean;
    mouth: boolean;
  };
}

export interface AirportSceneHandle {
  startSpeaking: () => boolean;
  stopSpeaking: () => void;
  setSpeechAmplitude: (amplitude: number) => boolean;
  previewSpeaking: () => boolean;
  previewBlink: () => boolean;
  previewExpression: (expression: CharacterExpression) => boolean;
  previewEyes: (state: EyeState) => boolean;
  setCalibrationEyes: (state: EyeState | null) => boolean;
  setCalibrationGrid: (visible: boolean) => void;
  setOverlayOpacity: (kind: FaceOverlayKind, opacity: number) => void;
  previewMouth: (state: MouthState) => boolean;
  setOverlayTransform: (
    kind: FaceOverlayKind,
    state: EyeState | MouthState,
    transform: FaceOverlayTransform,
  ) => boolean;
}

interface AirportSceneProps {
  onReady: (status: AirportSceneStatus) => void;
  onError: (error: Error) => void;
}

export const AirportScene = forwardRef<AirportSceneHandle, AirportSceneProps>(
  function AirportScene({ onReady, onError }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const agentRef = useRef<AirportAgent | null>(null);
    const speakingStopTimerRef = useRef<number | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        startSpeaking: () => agentRef.current?.rig.startSpeaking() ?? false,
        stopSpeaking: () => agentRef.current?.rig.stopSpeaking(),
        setSpeechAmplitude: (amplitude) =>
          agentRef.current?.rig.setSpeechAmplitude(amplitude) ?? false,
        previewSpeaking: () => {
          const agent = agentRef.current;
          const started = agent?.rig.startSpeaking() ?? false;
          void logger.debug("character.preview.speaking", { started });
          if (started && agent) {
            if (speakingStopTimerRef.current !== null) {
              window.clearTimeout(speakingStopTimerRef.current);
            }
            speakingStopTimerRef.current = window.setTimeout(() => {
              agent.rig.stopSpeaking();
              speakingStopTimerRef.current = null;
            }, 1_800);
          }
          return started;
        },
        previewBlink: () => {
          const blinked = agentRef.current?.rig.blink() ?? false;
          void logger.debug("character.preview.blink", { blinked });
          return blinked;
        },
        previewExpression: (expression) => {
          const changed =
            agentRef.current?.rig.setExpression(expression) ?? false;
          void logger.debug("character.preview.expression", {
            expression,
            changed,
          });
          return changed;
        },
        previewEyes: (state) => {
          const shown = agentRef.current?.rig.previewEyes(state) ?? false;
          void logger.debug("character.preview.eyes", { state, shown });
          return shown;
        },
        setCalibrationEyes: (state) =>
          agentRef.current?.rig.setCalibrationEyes(state) ?? false,
        setCalibrationGrid: (visible) =>
          agentRef.current?.rig.setCalibrationGrid(visible),
        setOverlayOpacity: (kind, opacity) =>
          agentRef.current?.rig.setOverlayOpacity(kind, opacity),
        previewMouth: (state) => {
          const shown = agentRef.current?.rig.previewMouth(state) ?? false;
          void logger.debug("character.preview.mouth", { state, shown });
          return shown;
        },
        setOverlayTransform: (kind, state, transform) => {
          const changed =
            agentRef.current?.rig.setOverlayTransform(kind, state, transform) ??
            false;
          if (changed) {
            void logger.info("asset.overlay.calibrated", {
              kind,
              state,
              ...transform,
            });
          }
          return changed;
        },
      }),
      [],
    );

    useEffect(() => {
      const host = hostRef.current;
      if (!host) {
        return;
      }

      const app = new Application();
      let disposed = false;
      let initialized = false;
      let resizeObserver: ResizeObserver | null = null;
      let background: AirportBackground | null = null;
      let agent: AirportAgent | null = null;

      const layout = (world: Container) => {
        const width = app.renderer.width;
        const height = app.renderer.height;
        const scale = Math.max(
          width / logicalViewport.width,
          height / logicalViewport.height,
        );
        world.scale.set(scale);
        world.position.set(
          (width - logicalViewport.width * scale) / 2,
          (height - logicalViewport.height * scale) / 2,
        );
        background?.layout(logicalViewport.width, logicalViewport.height);
        agent?.layout();
      };

      const start = async () => {
        try {
          await app.init({
            resizeTo: host,
            background: 0x0d151b,
            antialias: true,
            autoDensity: true,
            resolution: Math.min(window.devicePixelRatio, 2),
            preference: "webgl",
          });
          initialized = true;

          if (disposed) {
            app.destroy({ removeView: true }, { children: true });
            return;
          }

          app.canvas.className = "airport-scene__canvas";
          host.appendChild(app.canvas);

          const assets = await resolveAirportAssets();
          if (disposed) {
            return;
          }

          background = await AirportBackground.create(
            assets.availability.background,
          );
          agent = await AirportAgent.create(assets, app.ticker);
          if (disposed) {
            agent.dispose();
            background.dispose();
            return;
          }
          agentRef.current = agent;

          const world = new Container();
          world.addChild(background.view, agent.view);
          app.stage.addChild(world);
          layout(world);

          resizeObserver = new ResizeObserver(() => {
            app.resize();
            layout(world);
          });
          resizeObserver.observe(host);

          if (background.assetLoaded) {
            await logger.info("asset.background.loaded");
          } else {
            await logger.warn("asset.missing.background");
          }

          if (assets.availability.agentMaster) {
            await logger.info("asset.agentMaster.loaded", {
              role: "canonical-neutral",
            });
          }

          const loadedLayers = new Set(agent.rig.status.availableLayers);
          if (loadedLayers.has("body")) {
            await logger.info("asset.body.loaded");
          }
          const expressions = [
            "expressionNeutral",
            "expressionSmile",
            "expressionConfused",
            "expressionSerious",
            "expressionSurprised",
          ].filter((layer) => loadedLayers.has(layer));
          if (expressions.length > 0) {
            await logger.info("asset.expression.loaded", {
              count: expressions.length,
              mode: agent.rig.status.expressionMode,
            });
          }
          const eyes = ["eyesOpen", "eyesClosed"].filter((layer) =>
            loadedLayers.has(layer),
          );
          if (eyes.length > 0) {
            await logger.info("asset.eyes.loaded", { count: eyes.length });
          }
          const mouths = ["mouthClosed", "mouthMid", "mouthOpen"].filter(
            (layer) => loadedLayers.has(layer),
          );
          if (mouths.length > 0) {
            await logger.info("asset.mouth.loaded", {
              count: mouths.length,
            });
          }

          const overlayLayers = [
            "eyesOpen",
            "eyesClosed",
            "mouthClosed",
            "mouthMid",
            "mouthOpen",
          ];
          const missingOverlays = overlayLayers.filter(
            (layer) => !loadedLayers.has(layer),
          );
          if (missingOverlays.length > 0) {
            await logger.warn("asset.overlay.missing", {
              layers: missingOverlays,
            });
          } else {
            await logger.info("asset.overlay.calibrated", {
              eyes: agent.rig.status.overlaysCalibrated.eyes,
              mouth: agent.rig.status.overlaysCalibrated.mouth,
            });
          }

          if (agent.rig.status.mode === "placeholder") {
            await logger.warn("asset.missing.agentMaster");
          } else {
            await logger.info("asset.character.loaded", {
              mode: agent.rig.status.mode,
            });
            if (!assets.availability.agentMaster) {
              await logger.warn("asset.missing.agentMaster", {
                fallback: agent.rig.status.mode,
              });
            }
          }

          const rigStatus = agent.rig.status;
          const status: AirportSceneStatus = {
            backgroundLoaded: background.assetLoaded,
            characterMode: rigStatus.mode,
            availableLayers: rigStatus.availableLayers,
            canBlink: rigStatus.canBlink,
            canPreviewSpeaking: rigStatus.canPreviewSpeaking,
            expressionMode: rigStatus.expressionMode,
            overlaysCalibrated: rigStatus.overlaysCalibrated,
          };
          await logger.info("scene.airport.ready", {
            backgroundLoaded: status.backgroundLoaded,
            characterMode: status.characterMode,
            availableLayerCount: status.availableLayers.length,
          });
          onReady(status);
        } catch (error) {
          if (!disposed) {
            onError(
              error instanceof Error
                ? error
                : new Error("PixiJS airport scene failed to initialize"),
            );
          }
        }
      };

      void start();

      return () => {
        disposed = true;
        resizeObserver?.disconnect();
        if (speakingStopTimerRef.current !== null) {
          window.clearTimeout(speakingStopTimerRef.current);
          speakingStopTimerRef.current = null;
        }
        agentRef.current = null;
        agent?.dispose();
        background?.dispose();
        if (initialized) {
          app.destroy({ removeView: true }, { children: true });
        }
      };
    }, [onError, onReady]);

    return <div className="airport-scene" ref={hostRef} aria-hidden="true" />;
  },
);
