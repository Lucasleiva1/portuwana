import {
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  type Texture,
  type Ticker,
} from "pixi.js";
import {
  airportAssetPaths,
  type AirportAssetKey,
  type CharacterAssetMode,
} from "../airport/assetManifest";
import type {
  CharacterExpression,
  CharacterOverlayTransforms,
  CharacterRigConfig,
  CharacterRigSource,
  CharacterRigStatus,
  EyeState,
  FaceOverlayKind,
  FaceOverlayTransform,
  MouthState,
} from "./character.types";

const expressionLayers = {
  neutral: "expressionNeutral",
  smile: "expressionSmile",
  confused: "expressionConfused",
  surprised: "expressionSurprised",
  serious: "expressionSerious",
} as const satisfies Record<CharacterExpression, AirportAssetKey>;

const eyeLayers = {
  open: "eyesOpen",
  closed: "eyesClosed",
} as const satisfies Record<EyeState, AirportAssetKey>;

const mouthLayers = {
  closed: "mouthClosed",
  mid: "mouthMid",
  open: "mouthOpen",
} as const satisfies Record<MouthState, AirportAssetKey>;

export function expressionAssetKey(
  expression: CharacterExpression,
): AirportAssetKey {
  return expressionLayers[expression];
}

function copyTransform(transform: FaceOverlayTransform): FaceOverlayTransform {
  return { ...transform };
}

function validTransform(transform: FaceOverlayTransform): boolean {
  return (
    Number.isFinite(transform.x) &&
    Number.isFinite(transform.y) &&
    Number.isFinite(transform.scale) &&
    transform.scale > 0 &&
    Number.isFinite(transform.rotation)
  );
}

export class CharacterRig {
  readonly view = new Container();
  readonly #calibrationGrid = new Container();
  readonly #motionRoot = new Container();
  readonly #sprites = new Map<AirportAssetKey, Sprite>();
  readonly #availableLayers = new Set<AirportAssetKey>();
  readonly #ticker: Ticker;
  readonly #config: CharacterRigConfig;
  readonly #source: CharacterRigSource;
  readonly #overlayTransforms: CharacterOverlayTransforms;
  readonly #overlayCalibration: { eyes: boolean; mouth: boolean };
  #mode: CharacterAssetMode = "placeholder";
  #idleRunning = false;
  #speaking = false;
  #speechAmplitude = 0;
  #lastAmplitudeAt = Number.NEGATIVE_INFINITY;
  #idleElapsed = 0;
  #speakingElapsed = 0;
  #blinkTimer: number | null = null;
  #eyeVisibilityTimer: number | null = null;
  #mouthPreviewTimer: number | null = null;
  #calibrationMode = false;

  private constructor(
    source: CharacterRigSource,
    config: CharacterRigConfig,
    ticker: Ticker,
  ) {
    this.#source = source;
    this.#config = config;
    this.#ticker = ticker;
    this.#overlayTransforms = {
      eyes: {
        open: copyTransform(config.eyesTransform.open),
        closed: copyTransform(config.eyesTransform.closed),
      },
      mouth: {
        closed: copyTransform(config.mouthTransform.closed),
        mid: copyTransform(config.mouthTransform.mid),
        open: copyTransform(config.mouthTransform.open),
      },
    };
    this.#overlayCalibration = { ...config.overlayCalibration };
    this.#motionRoot.sortableChildren = true;
    this.#createCalibrationGrid();
    this.view.addChild(this.#calibrationGrid, this.#motionRoot);
  }

  static async create(
    source: CharacterRigSource,
    config: CharacterRigConfig,
    ticker: Ticker,
  ): Promise<CharacterRig> {
    const rig = new CharacterRig(source, config, ticker);
    await rig.#load();
    rig.startIdle();
    return rig;
  }

  get status(): CharacterRigStatus {
    return {
      mode: this.#mode,
      availableLayers: [...this.#availableLayers],
      canBlink:
        this.#overlayCalibration.eyes && this.#sprites.has("eyesClosed"),
      canPreviewSpeaking:
        this.#overlayCalibration.mouth &&
        this.#sprites.has("mouthClosed") &&
        this.#sprites.has("mouthMid") &&
        this.#sprites.has("mouthOpen"),
      expressionMode: this.#config.expressionMode,
      overlaysCalibrated: { ...this.#overlayCalibration },
    };
  }

  get overlayTransforms(): CharacterOverlayTransforms {
    return {
      eyes: {
        open: copyTransform(this.#overlayTransforms.eyes.open),
        closed: copyTransform(this.#overlayTransforms.eyes.closed),
      },
      mouth: {
        closed: copyTransform(this.#overlayTransforms.mouth.closed),
        mid: copyTransform(this.#overlayTransforms.mouth.mid),
        open: copyTransform(this.#overlayTransforms.mouth.open),
      },
    };
  }

  setExpression(expression: CharacterExpression): boolean {
    for (const layer of Object.values(expressionLayers)) {
      const sprite = this.#sprites.get(layer);
      if (sprite) {
        sprite.visible = false;
      }
    }

    const canonical = this.#sprites.get("agentMaster");
    const selected =
      expression === "neutral"
        ? (canonical ?? this.#sprites.get(expressionLayers.neutral))
        : this.#sprites.get(expressionLayers[expression]);
    const fallback = canonical ?? this.#sprites.get(expressionLayers.neutral);
    const sprite = selected ?? fallback;
    const body = this.#sprites.get("body");
    if (body) {
      body.visible = !sprite;
    }
    if (sprite) {
      sprite.visible = true;
      return Boolean(selected);
    }
    return false;
  }

  setOverlayTransform(
    kind: FaceOverlayKind,
    state: EyeState | MouthState,
    transform: FaceOverlayTransform,
  ): boolean {
    if (!validTransform(transform)) {
      return false;
    }
    let layer: AirportAssetKey;
    if (kind === "eyes") {
      if (state !== "open" && state !== "closed") {
        return false;
      }
      this.#overlayTransforms.eyes[state] = copyTransform(transform);
      layer = eyeLayers[state];
    } else {
      if (state !== "closed" && state !== "mid" && state !== "open") {
        return false;
      }
      this.#overlayTransforms.mouth[state] = copyTransform(transform);
      layer = mouthLayers[state];
    }
    return this.#applyOverlayTransform(layer);
  }

  previewEyes(state: EyeState): boolean {
    if (state === "open") {
      this.#clearEyeVisibilityTimer();
      this.#hideEyes();
      return true;
    }
    const sprite = this.#sprites.get(eyeLayers[state]);
    if (!sprite) {
      return false;
    }
    this.#clearEyeVisibilityTimer();
    this.#hideEyes();
    sprite.visible = true;
    this.#eyeVisibilityTimer = window.setTimeout(() => {
      this.#hideEyes();
      this.#eyeVisibilityTimer = null;
    }, 1_500);
    return true;
  }

  setCalibrationEyes(state: EyeState | null): boolean {
    this.#clearEyeVisibilityTimer();
    this.#hideEyes();
    if (state === null || state === "open") {
      return true;
    }
    const sprite = this.#sprites.get(eyeLayers.closed);
    if (!sprite) {
      return false;
    }
    sprite.visible = true;
    return true;
  }

  setCalibrationGrid(visible: boolean): void {
    this.#calibrationMode = visible;
    this.#calibrationGrid.visible = visible;
    if (visible) {
      this.#motionRoot.position.set(0, 0);
      this.#motionRoot.scale.set(1, 1);
      this.#motionRoot.rotation = 0;
    }
  }

  setOverlayOpacity(kind: FaceOverlayKind, opacity: number): void {
    const alpha = Math.max(0, Math.min(1, opacity));
    const layers = kind === "eyes" ? Object.values(eyeLayers) : Object.values(mouthLayers);
    layers.forEach((layer) => {
      const sprite = this.#sprites.get(layer);
      if (sprite) {
        sprite.alpha = alpha;
      }
    });
  }

  previewMouth(state: MouthState): boolean {
    const shown = this.setMouth(state);
    if (!shown) {
      return false;
    }
    if (this.#mouthPreviewTimer !== null) {
      window.clearTimeout(this.#mouthPreviewTimer);
    }
    this.#mouthPreviewTimer = window.setTimeout(() => {
      if (!this.#speaking) {
        this.#hideMouth();
      }
      this.#mouthPreviewTimer = null;
    }, 1_500);
    return true;
  }

  setMouth(state: MouthState): boolean {
    this.#hideMouth();
    const selected = this.#sprites.get(mouthLayers[state]);
    if (selected) {
      selected.visible = true;
      return true;
    }
    return false;
  }

  blink(): boolean {
    if (!this.#overlayCalibration.eyes) {
      return false;
    }
    const closed = this.#sprites.get("eyesClosed");
    if (!closed) {
      return false;
    }

    this.#clearEyeVisibilityTimer();
    this.#hideEyes();
    closed.visible = true;
    this.#eyeVisibilityTimer = window.setTimeout(() => {
      closed.visible = false;
      this.#eyeVisibilityTimer = null;
    }, 115);
    return true;
  }

  startIdle(): void {
    if (this.#idleRunning) {
      return;
    }
    this.#idleRunning = true;
    this.#ticker.add(this.#update);
    this.#scheduleBlink();
  }

  startSpeaking(): boolean {
    if (
      !this.#overlayCalibration.mouth ||
      !this.#sprites.has("mouthClosed") ||
      !this.#sprites.has("mouthMid") ||
      !this.#sprites.has("mouthOpen")
    ) {
      return false;
    }
    if (this.#mouthPreviewTimer !== null) {
      window.clearTimeout(this.#mouthPreviewTimer);
      this.#mouthPreviewTimer = null;
    }
    this.#speaking = true;
    this.#speakingElapsed = 0;
    this.#speechAmplitude = 0;
    this.#lastAmplitudeAt = Number.NEGATIVE_INFINITY;
    this.setMouth("closed");
    return true;
  }

  stopSpeaking(): void {
    this.#speaking = false;
    this.#speakingElapsed = 0;
    this.#speechAmplitude = 0;
    this.#lastAmplitudeAt = Number.NEGATIVE_INFINITY;
    this.#hideMouth();
  }

  setSpeechAmplitude(amplitude: number): boolean {
    if (!this.#speaking) {
      return false;
    }
    const normalized = Math.max(0, Math.min(1, amplitude));
    this.#speechAmplitude = this.#speechAmplitude * 0.58 + normalized * 0.42;
    this.#lastAmplitudeAt = performance.now();
    return this.setMouth(
      this.#speechAmplitude < 0.12
        ? "closed"
        : this.#speechAmplitude < 0.38
          ? "mid"
          : "open",
    );
  }

  dispose(): void {
    this.#ticker.remove(this.#update);
    this.#idleRunning = false;
    if (this.#blinkTimer !== null) {
      window.clearTimeout(this.#blinkTimer);
    }
    this.#clearEyeVisibilityTimer();
    if (this.#mouthPreviewTimer !== null) {
      window.clearTimeout(this.#mouthPreviewTimer);
    }
    this.view.removeFromParent();
    this.view.destroy({ children: true, texture: false, textureSource: false });
  }

  async #load(): Promise<void> {
    if (this.#source.preferredMode === "layered") {
      const body = await this.#loadSprite("body");
      if (body) {
        this.#mode = "layered";
        await this.#loadOptionalLayers();
        this.setExpression("neutral");
        this.#hideEyes();
        this.#hideMouth();
        return;
      }
    }

    if (this.#source.availability.agentMaster) {
      const master = await this.#loadSprite("agentMaster");
      if (master) {
        this.#mode = "master";
        return;
      }
    }

    this.#mode = "placeholder";
    this.#createPlaceholder();
  }

  async #loadOptionalLayers(): Promise<void> {
    const layers: readonly AirportAssetKey[] = [
      "agentMaster",
      "expressionNeutral",
      "expressionSmile",
      "expressionConfused",
      "expressionSurprised",
      "expressionSerious",
      "eyesOpen",
      "eyesClosed",
      "mouthClosed",
      "mouthMid",
      "mouthOpen",
    ];

    for (const layer of layers) {
      if (this.#source.availability[layer]) {
        await this.#loadSprite(layer);
      }
    }
    this.#motionRoot.sortChildren();
  }

  async #loadSprite(layer: AirportAssetKey): Promise<Sprite | null> {
    try {
      const texture = await Assets.load<Texture>(airportAssetPaths[layer]);
      const sprite = new Sprite(texture);
      sprite.anchor.set(this.#config.anchor.x, this.#config.anchor.y);
      sprite.scale.set(this.#config.baseScale);
      sprite.position.set(0, 0);
      sprite.zIndex = this.#zIndexFor(layer);
      sprite.visible = layer === "body" || layer === "agentMaster";
      this.#motionRoot.addChild(sprite);
      this.#sprites.set(layer, sprite);
      this.#availableLayers.add(layer);
      this.#applyOverlayTransform(layer);
      return sprite;
    } catch {
      return null;
    }
  }

  #applyOverlayTransform(layer: AirportAssetKey): boolean {
    const sprite = this.#sprites.get(layer);
    if (!sprite) {
      return false;
    }
    let transform: FaceOverlayTransform | null = null;
    if (layer === "eyesOpen") {
      transform = this.#overlayTransforms.eyes.open;
    } else if (layer === "eyesClosed") {
      transform = this.#overlayTransforms.eyes.closed;
    } else if (layer === "mouthClosed") {
      transform = this.#overlayTransforms.mouth.closed;
    } else if (layer === "mouthMid") {
      transform = this.#overlayTransforms.mouth.mid;
    } else if (layer === "mouthOpen") {
      transform = this.#overlayTransforms.mouth.open;
    }
    if (!transform) {
      return false;
    }
    sprite.position.set(transform.x, transform.y);
    sprite.scale.set(this.#config.baseScale * transform.scale);
    sprite.rotation = transform.rotation;
    return true;
  }

  #zIndexFor(layer: AirportAssetKey): number {
    if (layer === "eyesOpen" || layer === "eyesClosed") {
      return 20;
    }
    if (
      layer === "mouthClosed" ||
      layer === "mouthMid" ||
      layer === "mouthOpen"
    ) {
      return 30;
    }
    if (
      layer === "expressionNeutral" ||
      layer === "expressionSmile" ||
      layer === "expressionConfused" ||
      layer === "expressionSurprised" ||
      layer === "expressionSerious"
    ) {
      return 10;
    }
    return 0;
  }

  #hideEyes(): void {
    Object.values(eyeLayers).forEach((layer) => {
      const sprite = this.#sprites.get(layer);
      if (sprite) {
        sprite.visible = false;
      }
    });
  }

  #hideMouth(): void {
    Object.values(mouthLayers).forEach((layer) => {
      const sprite = this.#sprites.get(layer);
      if (sprite) {
        sprite.visible = false;
      }
    });
  }

  #clearEyeVisibilityTimer(): void {
    if (this.#eyeVisibilityTimer !== null) {
      window.clearTimeout(this.#eyeVisibilityTimer);
      this.#eyeVisibilityTimer = null;
    }
  }

  #createPlaceholder(): void {
    const silhouette = new Graphics()
      .circle(0, -545, 92)
      .fill({ color: 0x1b2b34, alpha: 0.96 })
      .stroke({ color: 0x55cec6, width: 2, alpha: 0.7 })
      .moveTo(-52, -455)
      .bezierCurveTo(-170, -410, -195, -210, -205, 0)
      .lineTo(205, 0)
      .bezierCurveTo(195, -210, 170, -410, 52, -455)
      .closePath()
      .fill({ color: 0x142129, alpha: 0.98 })
      .stroke({ color: 0x39b8b2, width: 2, alpha: 0.72 });

    const label = new Text({
      text: "AGENT\nASSET MISSING",
      style: {
        align: "center",
        fill: 0x55cec6,
        fontFamily: "Segoe UI, sans-serif",
        fontSize: 14,
        fontWeight: "600",
        letterSpacing: 1.7,
      },
    });
    label.anchor.set(0.5);
    label.position.set(0, -220);
    this.#motionRoot.addChild(silhouette, label);
  }

  #createCalibrationGrid(): void {
    const sourceWidth = 1_086;
    const sourceHeight = 1_448;
    const scale = this.#config.baseScale;
    const left = -sourceWidth * this.#config.anchor.x * scale;
    const top = -sourceHeight * this.#config.anchor.y * scale;
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    const minorStep = 50;
    const majorStep = 100;
    const graphics = new Graphics();

    for (let sourceY = 0; sourceY < sourceHeight; sourceY += majorStep) {
      for (let sourceX = 0; sourceX < sourceWidth; sourceX += majorStep) {
        graphics
          .rect(
            left + sourceX * scale,
            top + sourceY * scale,
            majorStep * scale,
            majorStep * scale,
          )
          .fill({
            color: (sourceX / majorStep + sourceY / majorStep) % 2 === 0
              ? 0x0d151b
              : 0x142129,
            alpha: 0.22,
          });
      }
    }

    for (let sourceX = 0; sourceX <= sourceWidth; sourceX += minorStep) {
      const major = sourceX % majorStep === 0;
      graphics
        .moveTo(left + sourceX * scale, top)
        .lineTo(left + sourceX * scale, top + height)
        .stroke({
          color: major ? 0x55cec6 : 0x9baab3,
          width: major ? 1 : 0.5,
          alpha: major ? 0.46 : 0.18,
        });
    }
    for (let sourceY = 0; sourceY <= sourceHeight; sourceY += minorStep) {
      const major = sourceY % majorStep === 0;
      graphics
        .moveTo(left, top + sourceY * scale)
        .lineTo(left + width, top + sourceY * scale)
        .stroke({
          color: major ? 0x55cec6 : 0x9baab3,
          width: major ? 1 : 0.5,
          alpha: major ? 0.46 : 0.18,
        });
    }
    graphics
      .rect(left, top, width, height)
      .stroke({ color: 0xf2b84b, width: 2, alpha: 0.82 });
    graphics
      .moveTo(0, top)
      .lineTo(0, top + height)
      .stroke({ color: 0xe56f6f, width: 1.5, alpha: 0.9 });

    this.#calibrationGrid.addChild(graphics);
    for (let sourceX = 0; sourceX <= 1_000; sourceX += 200) {
      const label = new Text({
        text: `x ${sourceX}`,
        style: {
          fill: 0x55cec6,
          fontFamily: "Consolas, monospace",
          fontSize: 9,
        },
      });
      label.position.set(left + sourceX * scale + 3, top + 3);
      this.#calibrationGrid.addChild(label);
    }
    for (let sourceY = 0; sourceY <= 1_400; sourceY += 200) {
      const label = new Text({
        text: `y ${sourceY}`,
        style: {
          fill: 0xf2b84b,
          fontFamily: "Consolas, monospace",
          fontSize: 9,
        },
      });
      label.position.set(left + 3, top + sourceY * scale + 3);
      this.#calibrationGrid.addChild(label);
    }
    this.#calibrationGrid.visible = false;
  }

  #scheduleBlink(): void {
    if (!this.status.canBlink || !this.#idleRunning) {
      return;
    }
    const delay = 2_800 + Math.round(Math.random() * 2_400);
    this.#blinkTimer = window.setTimeout(() => {
      this.blink();
      this.#scheduleBlink();
    }, delay);
  }

  readonly #update = (ticker: Ticker): void => {
    if (this.#calibrationMode) {
      return;
    }
    this.#idleElapsed += ticker.deltaMS;
    const idlePhase = this.#idleElapsed / 2_700;
    this.#motionRoot.scale.y = 1 + Math.sin(idlePhase) * 0.0035;
    this.#motionRoot.position.y = Math.sin(idlePhase) * 1.2;
    this.#motionRoot.rotation = Math.sin(idlePhase * 0.62) * 0.0014;

    if (!this.#speaking) {
      return;
    }

    this.#speakingElapsed += ticker.deltaMS;
    if (performance.now() - this.#lastAmplitudeAt < 240) {
      return;
    }
    const sequence: readonly MouthState[] = [
      "closed",
      "mid",
      "open",
      "mid",
      "closed",
    ];
    const index = Math.floor(this.#speakingElapsed / 125) % sequence.length;
    this.setMouth(sequence[index] ?? "closed");
  };
}
