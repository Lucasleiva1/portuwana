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
  type AssetAvailability,
} from "./assetManifest";
import { getBackgroundMotionFrame } from "./backgroundMotion";

export class AirportBackground {
  readonly view = new Container();
  readonly #fallback = new Graphics();
  readonly #label = new Text({
    text: "BACKGROUND ASSET MISSING",
    style: {
      fill: 0x55cec6,
      fontFamily: "Segoe UI, sans-serif",
      fontSize: 15,
      fontWeight: "600",
      letterSpacing: 2.2,
    },
  });
  readonly #subLabel = new Text({
    text: "PUBLIC / ASSETS / AIRPORT / BACKGROUND.WEBP",
    style: {
      fill: 0x9baab3,
      fontFamily: "Segoe UI, sans-serif",
      fontSize: 10,
      letterSpacing: 1.2,
    },
  });
  readonly #ticker: Ticker;
  readonly #sprites: Sprite[] = [];
  #assetLoaded = false;
  #elapsedMs = 0;

  private constructor(ticker: Ticker) {
    this.#ticker = ticker;
    this.#label.anchor.set(0.5);
    this.#subLabel.anchor.set(0.5);
    this.view.addChild(this.#fallback, this.#label, this.#subLabel);
  }

  static async create(
    availability: AssetAvailability,
    ticker: Ticker,
  ): Promise<AirportBackground> {
    const background = new AirportBackground(ticker);
    if (availability.background) {
      try {
        const texture = await Assets.load<Texture>(airportAssetPaths.background);
        background.#addStateSprite(texture);
        background.#fallback.visible = false;
        background.#label.visible = false;
        background.#subLabel.visible = false;
        background.#assetLoaded = true;
      } catch {
        background.#assetLoaded = false;
      }
    }

    if (background.#assetLoaded) {
      const optionalStates: readonly AirportAssetKey[] = [
        "backgroundStateB",
        "backgroundStateC",
        "backgroundStateD",
        "backgroundStateE",
        "backgroundStateF",
      ];
      for (const key of optionalStates) {
        if (!availability[key]) {
          continue;
        }
        try {
          const texture = await Assets.load<Texture>(airportAssetPaths[key]);
          background.#addStateSprite(texture);
        } catch {
          // Optional motion states fail closed to the canonical background.
        }
      }
    }

    if (background.#sprites.length > 1) {
      background.#ticker.add(background.#update);
    }
    background.#updateSprites();
    return background;
  }

  get assetLoaded(): boolean {
    return this.#assetLoaded;
  }

  get stateCount(): number {
    return this.#sprites.length;
  }

  get motionMode(): "state-dissolve" | "static" {
    return this.stateCount > 1 ? "state-dissolve" : "static";
  }

  layout(width: number, height: number): void {
    this.#fallback
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: 0x0d151b })
      .circle(width * 0.72, height * 0.28, height * 0.42)
      .fill({ color: 0x1b3a40, alpha: 0.52 })
      .rect(0, height * 0.62, width, height * 0.38)
      .fill({ color: 0x101c23, alpha: 0.92 })
      .moveTo(width * 0.08, height * 0.19)
      .lineTo(width * 0.92, height * 0.19)
      .lineTo(width * 0.92, height * 0.68)
      .lineTo(width * 0.08, height * 0.68)
      .closePath()
      .stroke({ color: 0x55cec6, width: 1.2, alpha: 0.22 });

    for (let index = 1; index < 6; index += 1) {
      const x = width * (0.08 + index * 0.14);
      this.#fallback
        .moveTo(x, height * 0.19)
        .lineTo(x, height * 0.68)
        .stroke({ color: 0x9baab3, width: 1, alpha: 0.08 });
    }

    this.#label.position.set(width * 0.42, height * 0.42);
    this.#subLabel.position.set(width * 0.42, height * 0.47);

    for (const sprite of this.#sprites) {
      const scale = Math.max(
        width / sprite.texture.width,
        height / sprite.texture.height,
      );
      sprite.scale.set(scale);
      sprite.position.set(
        (width - sprite.texture.width * scale) / 2,
        (height - sprite.texture.height * scale) / 2,
      );
    }
  }

  dispose(): void {
    this.#ticker.remove(this.#update);
    this.view.removeFromParent();
    this.view.destroy({ children: true, texture: false, textureSource: false });
  }

  #addStateSprite(texture: Texture): void {
    const sprite = new Sprite(texture);
    sprite.alpha = this.#sprites.length === 0 ? 1 : 0;
    this.view.addChildAt(sprite, this.#sprites.length);
    this.#sprites.push(sprite);
  }

  #updateSprites(): void {
    const frame = getBackgroundMotionFrame(
      this.#elapsedMs,
      this.#sprites.length,
    );
    this.#sprites.forEach((sprite, index) => {
      sprite.alpha = frame.alphas[index] ?? 0;
    });
  }

  readonly #update = (ticker: Ticker): void => {
    this.#elapsedMs += ticker.deltaMS;
    this.#updateSprites();
  };
}
