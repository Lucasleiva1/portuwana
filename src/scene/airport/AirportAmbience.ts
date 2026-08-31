import {
  Assets,
  Container,
  Sprite,
  type Texture,
  type Ticker,
} from "pixi.js";
import type { AssetAvailability } from "./assetManifest";
import { airportAssetPaths } from "./assetManifest";
import { getAmbientMotionFrame } from "./ambientMotion";
import {
  airportAmbienceConfig,
  type AmbientTravelerConfig,
} from "./airportAmbience.config";

interface AmbientTravelerRuntime {
  config: AmbientTravelerConfig;
  sprite: Sprite;
  locationIndex: number;
}

export class AirportAmbience {
  readonly view = new Container();
  readonly #ticker: Ticker;
  readonly #travelers: AmbientTravelerRuntime[] = [];
  #elapsedMs = 0;

  private constructor(ticker: Ticker) {
    this.#ticker = ticker;
  }

  static async create(
    availability: AssetAvailability,
    ticker: Ticker,
  ): Promise<AirportAmbience> {
    const ambience = new AirportAmbience(ticker);
    for (const config of airportAmbienceConfig.travelers) {
      if (availability[config.asset]) {
        await ambience.#loadTraveler(config);
      }
    }
    ambience.#ticker.add(ambience.#update);
    ambience.#updateTravelers();
    return ambience;
  }

  get loadedCount(): number {
    return this.#travelers.length;
  }

  get motionMode(): "fade-relocate" | "disabled" {
    return this.loadedCount > 0 ? "fade-relocate" : "disabled";
  }

  dispose(): void {
    this.#ticker.remove(this.#update);
    this.view.removeFromParent();
    this.view.destroy({ children: true, texture: false, textureSource: false });
  }

  async #loadTraveler(config: AmbientTravelerConfig): Promise<void> {
    try {
      const texture = await Assets.load<Texture>(airportAssetPaths[config.asset]);
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 1);
      sprite.alpha = 0;
      sprite.visible = false;
      this.view.addChild(sprite);
      this.#travelers.push({ config, sprite, locationIndex: -1 });
    } catch {
      // Ambient figures are optional; the airport remains fully usable without them.
    }
  }

  #applyPlacement(traveler: AmbientTravelerRuntime, index: number): void {
    const placement = traveler.config.placements[index];
    if (!placement) {
      return;
    }
    traveler.locationIndex = index;
    traveler.sprite.position.set(placement.x, placement.y);
    traveler.sprite.scale.set(
      placement.scale * (placement.flipX ? -1 : 1),
      placement.scale,
    );
  }

  #updateTravelers(): void {
    for (const traveler of this.#travelers) {
      const frame = getAmbientMotionFrame(
        this.#elapsedMs,
        traveler.config.phaseMs,
        traveler.config.placements.length,
        airportAmbienceConfig.cycleDurationMs,
      );
      if (frame.locationIndex !== traveler.locationIndex) {
        this.#applyPlacement(traveler, frame.locationIndex);
      }
      traveler.sprite.alpha = frame.alpha * traveler.config.maxAlpha;
      traveler.sprite.visible = traveler.sprite.alpha > 0.01;
    }
  }

  readonly #update = (ticker: Ticker): void => {
    this.#elapsedMs += ticker.deltaMS;
    this.#updateTravelers();
  };
}
