import { Container, type Ticker } from "pixi.js";
import type { ResolvedAirportAssets } from "../airport/assetManifest";
import { airportAgentConfig } from "./airportAgent.config";
import { CharacterRig } from "./CharacterRig";

export class AirportAgent {
  readonly view = new Container();
  readonly rig: CharacterRig;

  private constructor(rig: CharacterRig) {
    this.rig = rig;
    this.view.addChild(rig.view);
    this.layout();
  }

  static async create(
    assets: ResolvedAirportAssets,
    ticker: Ticker,
  ): Promise<AirportAgent> {
    const rig = await CharacterRig.create(
      {
        availability: assets.availability,
        preferredMode: assets.characterMode,
      },
      airportAgentConfig,
      ticker,
    );
    return new AirportAgent(rig);
  }

  layout(): void {
    this.view.position.set(
      airportAgentConfig.position.x,
      airportAgentConfig.position.y,
    );
  }

  dispose(): void {
    this.view.removeFromParent();
    this.rig.dispose();
    this.view.destroy({ children: false });
  }
}
