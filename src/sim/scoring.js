import { SCORE } from './enemyTypes.js';

/** Combo bonus earned when the combo counter reaches `n` (0 if none). */
export function comboBonusAt(n) {
  if (n <= 0) return 0;
  if (n < SCORE.comboHighStart) return n % SCORE.comboStep === 0 ? SCORE.comboBonus : 0;
  return (n - SCORE.comboHighStart) % SCORE.comboHighStep === 0 ? SCORE.comboHighBonus : 0;
}

/**
 * Arcade scoring: kill points, combo chain with bonus steps, speed-based
 * flight score, Emergency Order bonuses, down rate and rank stars.
 */
export class Scoring {
  constructor() {
    this.stars = 0;
    this.resetStage();
    this.total = 0;
  }

  resetStage() {
    this.stage = 0;
    this.kills = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.comboTimer = 0;
    this.flightMeters = 0;
    this.flight = 0;
    this.eoBonus = 0;
    this.time = 0;
    this.shotsHit = 0;
    this.lastBonus = 0;
    this.events = []; // popups {text, value, t}
  }

  update(dt, throttle, metres) {
    this.time += dt;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (throttle >= 0) {
      this.flightMeters += metres;
      const per = throttle > 0 ? SCORE.flightPerKmFast : SCORE.flightPerKmNeutral;
      const pts = (metres / 1000) * per;
      this.flight += pts;
      this.add(pts);
    }
  }

  add(v) {
    this.stage += v;
    this.total += v;
  }

  kill(enemy) {
    this.kills++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboTimer = SCORE.comboWindow;
    const base = enemy.def.score;
    this.add(base);
    const bonus = comboBonusAt(this.combo);
    if (bonus) {
      this.add(bonus);
      this.lastBonus = bonus;
    }
    return { base, bonus };
  }

  /** Taking damage breaks the chain. */
  hurt() {
    this.combo = 0;
    this.comboTimer = 0;
  }

  eo(bonus) {
    this.eoBonus += bonus;
    this.add(bonus);
  }

  /** Down rate as percentage of countable enemies destroyed. */
  static downRate(killed, spawned) {
    return spawned > 0 ? Math.min(100, (killed / spawned) * 100) : 0;
  }

  /** Stage clear: ≥50% down rate earns a star (max 5, "shining" at 5 + ≥90%). */
  stageClear(killed, spawned) {
    const rate = Scoring.downRate(killed, spawned);
    let earned = 0;
    if (rate >= 50 && this.stars < 5) {
      this.stars++;
      earned = 1;
    }
    this.shining = this.stars >= 5 && rate >= 90;
    return { rate, earned };
  }

  loseStar() {
    this.stars = Math.max(0, this.stars - 1);
  }

  static rankLetter(rate) {
    if (rate >= 95) return 'S';
    if (rate >= 85) return 'A';
    if (rate >= 70) return 'B';
    if (rate >= 50) return 'C';
    return 'D';
  }
}
