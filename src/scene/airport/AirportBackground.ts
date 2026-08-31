import { Assets, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { airportAssetPaths } from "./assetManifest";

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
  #sprite: Sprite | null = null;
  #assetLoaded = false;

  private constructor() {
    this.#label.anchor.set(0.5);
    this.#subLabel.anchor.set(0.5);
    this.view.addChild(this.#fallback, this.#label, this.#subLabel);
  }

  static async create(assetAvailable: boolean): Promise<AirportBackground> {
    const background = new AirportBackground();
    if (assetAvailable) {
      try {
        const texture = await Assets.load<Texture>(airportAssetPaths.background);
        background.#sprite = new Sprite(texture);
        background.view.addChildAt(background.#sprite, 0);
        background.#fallback.visible = false;
        background.#label.visible = false;
        background.#subLabel.visible = false;
        background.#assetLoaded = true;
      } catch {
        background.#assetLoaded = false;
      }
    }
    return background;
  }

  get assetLoaded(): boolean {
    return this.#assetLoaded;
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

    if (this.#sprite) {
      const scale = Math.max(
        width / this.#sprite.texture.width,
        height / this.#sprite.texture.height,
      );
      this.#sprite.scale.set(scale);
      this.#sprite.position.set(
        (width - this.#sprite.texture.width * scale) / 2,
        (height - this.#sprite.texture.height * scale) / 2,
      );
    }
  }

  dispose(): void {
    this.view.removeFromParent();
    this.view.destroy({ children: true, texture: false, textureSource: false });
  }
}
