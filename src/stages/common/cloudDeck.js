import { Vector3 } from 'three';
import { CloudDeck } from '../../world/cloudDeck.js';

const _v = new Vector3();

/**
 * Sea of clouds under the rail (env.deck = {y, cover, sun}) with a whiteout
 * while the camera crosses the deck.
 */
export class CloudDeckPart {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.game = stage.game;
    this.opts = opts;
    this.whiteout = 0;
    this.deckWhite = 0;
  }

  async init() {
    const g = this.game;
    const env = this.stage.def.env;
    const d = { y: 1050, cover: 0.74, sun: 0.9, ...(env.deck || {}), ...this.opts };
    this.deck = new CloudDeck({ y: d.y, cover: d.cover });
    const sky = g.world.sky;
    const sunI = (sky.params.sunIntensity * sky.params.exposure) / Math.PI;
    const top = sky.radiance(_v.set(0, 1, 0));
    this.deck.setLighting({ sunI: sunI * (d.sun ?? 0.9), ambient: top.multiplyScalar(1.3) });
    g.world.scene.add(this.deck.mesh);
  }

  update() {
    // whiteout while crossing the cloud deck
    const camY = this.game.rig.camera.position.y;
    const dy = Math.abs(camY - this.deck.y);
    this.deckWhite = dy < 90 ? (1 - dy / 90) * 0.9 : 0;
  }

  render(alpha, realDt) {
    this.deck.update(realDt, this.game.rig.camera);
    this.whiteout = this.deckWhite;
  }

  dispose() {
    this.game.world.scene.remove(this.deck.mesh);
    this.deck.dispose();
  }
}

export const cloudDeck = (opts) => (stage) => new CloudDeckPart(stage, opts);
