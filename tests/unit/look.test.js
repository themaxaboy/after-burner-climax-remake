import { describe, it, expect } from 'vitest';
import { Color, PerspectiveCamera, Vector3 } from 'three';
import { CameraFXEffect } from '../../src/render/effects/CameraFXEffect.js';
import { findDips, meanLuma } from '../../src/core/lumaProbe.js';
import { GRADES, ARCADE_GRADES, hueDir } from '../../src/render/effects/GradeEffect.js';
import { atmosphereJS, stylizeSkyJS, skyZenithHue, sunDirFromAngles, SKY_STYLE_DEFAULTS } from '../../src/world/atmosphere.js';
import { LOOKS } from '../../src/world/looks.js';
import { OCEAN_PRESETS } from '../../src/world/ocean.js';
import { DynamicResolution, PRESETS } from '../../src/core/quality.js';
import { visScaleOf } from '../../src/render/enemyRenderer.js';

const hsvSat = (c) => {
  const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
  return mx > 0 ? (mx - mn) / mx : 0;
};

describe('findDips (flicker detector)', () => {
  const flat = Array.from({ length: 60 }, () => 0.5);

  it('finds nothing in a steady or slowly changing series', () => {
    expect(findDips(flat)).toEqual([]);
    const ramp = Array.from({ length: 120 }, (_, i) => 0.6 - i * 0.003); // slow darkening
    expect(findDips(ramp)).toEqual([]);
  });

  it('finds a one-frame black frame and a short dark pulse', () => {
    const s = flat.slice();
    s[10] = 0;
    s[30] = 0.35;
    s[31] = 0.4;
    const d = findDips(s);
    expect(d.length).toBe(2);
    expect(d[0].start).toBe(10);
    expect(d[0].end).toBe(11);
    expect(d[0].depth).toBeCloseTo(1, 5);
    expect(d[1].start).toBe(30);
    expect(d[1].end).toBe(32);
    expect(d[1].depth).toBeCloseTo(0.3, 5);
  });

  it('ignores drops that do not recover within the window (scene change)', () => {
    const s = flat.slice();
    for (let i = 20; i < 60; i++) s[i] = 0.3;
    expect(findDips(s)).toEqual([]);
    const late = flat.slice();
    for (let i = 20; i < 26; i++) late[i] = 0.2; // recovers after 6 frames
    expect(findDips(late, { within: 4 })).toEqual([]);
    expect(findDips(late, { within: 8 }).length).toBe(1);
  });

  it('respects the drop threshold and reads objects', () => {
    const s = flat.map((l) => ({ l }));
    s[5] = { l: 0.46 }; // -8%: under the 10% threshold
    expect(findDips(s)).toEqual([]);
    s[5] = { l: 0.4 };
    expect(findDips(s).length).toBe(1);
    s[5] = { l: NaN };
    expect(findDips(s)).toEqual([]);
  });

  it('computes mean luma of RGBA8 data', () => {
    expect(meanLuma(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]))).toBeCloseTo(0.5, 5);
  });
});

describe('grade presets', () => {
  const NAMES = ['arcadeOcean', 'arcadeEmerald', 'arcadeCanyon', 'arcadeSunset', 'arcadeGlacier', 'arcadeDunes', 'arcadeClouds', 'arcadeFortress', 'arcadeAurora', 'arcadeStrike'];

  it('has every arcade preset and keeps the old names', () => {
    for (const n of NAMES) expect(GRADES[n], n).toBeTruthy();
    for (const n of NAMES) expect(ARCADE_GRADES).toContain(n);
    for (const n of ['neutral', 'goldenHour', 'canyon', 'twilight', 'hangar']) expect(GRADES[n], n).toBeTruthy();
  });

  it('arcade presets are vivid and clean (no lift, no teal/orange crush)', () => {
    for (const n of NAMES) {
      const g = GRADES[n];
      expect(g.saturation, n).toBeGreaterThanOrEqual(1.15);
      expect(g.saturation, n).toBeLessThanOrEqual(1.4);
      expect(g.vibrance, n).toBeGreaterThan(0.2);
      expect(g.contrast, n).toBeGreaterThanOrEqual(1);
      expect(g.contrast, n).toBeLessThanOrEqual(1.1);
      expect(g.lift.every((x) => x === 0), n).toBe(true);
      expect(g.split, n).toBe(0);
      expect(g.focus.length, n).toBe(3);
      for (const k of ['gamma', 'gain']) expect(g[k].every((x) => x > 0.9 && x < 1.1), `${n}.${k}`).toBe(true);
    }
  });

  it('hue directions are unit vectors', () => {
    for (const n of NAMES) {
      const d = hueDir(GRADES[n].focus);
      expect(d.length()).toBeCloseTo(1, 5);
    }
  });
});

describe('sky stylisation (JS port)', () => {
  const dirs = [];
  for (let y = -0.4; y <= 1.0001; y += 0.1) for (let a = 0; a < 6.28; a += 0.8) dirs.push(new Vector3(Math.cos(a), y, Math.sin(a)).normalize());

  it('never produces NaN or negative radiance', () => {
    for (const look of Object.values(LOOKS)) {
      const sd = sunDirFromAngles(look.elev, look.azim);
      const p = { rayleigh: look.rayleigh, mie: look.mie, mieG: look.mieG, ozone: look.ozone ?? 1, sunIntensity: look.sunIntensity, exposure: look.exposure ?? 1, groundAlbedo: look.groundAlbedo };
      const zh = skyZenithHue(atmosphereJS(new Vector3(0, 1, 0), sd, p), [1, 1, 1], look.sky?.hue);
      for (const d of dirs) {
        const c = stylizeSkyJS(atmosphereJS(d, sd, p), d, sd, look.sky, zh);
        for (const v of [c.r, c.g, c.b]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('increases the saturation of the sky', () => {
    const sd = sunDirFromAngles(LOOKS.oceanDay.elev, LOOKS.oceanDay.azim);
    const p = { rayleigh: 1.25, mie: 0.75, ozone: 4 };
    const style = LOOKS.oceanDay.sky;
    const zh = skyZenithHue(atmosphereJS(new Vector3(0, 1, 0), sd, p), [1, 1, 1], style.hue);
    let before = 0, after = 0, n = 0;
    for (const d of dirs) {
      if (d.y < 0.05) continue;
      const phys = atmosphereJS(d, sd, p);
      const styl = stylizeSkyJS(phys.clone(), d, sd, style, zh);
      before += hsvSat(phys);
      after += hsvSat(styl);
      n++;
    }
    expect(after / n).toBeGreaterThan((before / n) * 1.15);
    // the zenith is a clear blue
    const z = stylizeSkyJS(atmosphereJS(new Vector3(0, 1, 0), sd, p), new Vector3(0, 1, 0), sd, style, zh);
    expect(z.b).toBeGreaterThan(z.g);
    expect(z.g).toBeGreaterThan(z.r);
    expect(hsvSat(z)).toBeGreaterThan(0.8);
  });

  it('has defaults for the env.sky contract fields', () => {
    for (const k of ['zenithBoost', 'saturation', 'horizonBright', 'sunDisc']) expect(typeof SKY_STYLE_DEFAULTS[k], k).toBe('number');
    expect(SKY_STYLE_DEFAULTS.sunDisc).toBeGreaterThan(0.27); // larger than the real sun
  });

  it('is the identity with neutral settings', () => {
    const sd = sunDirFromAngles(30, 0);
    const d = new Vector3(0.3, 0.5, -0.8).normalize();
    const c = atmosphereJS(d, sd, {});
    const s = stylizeSkyJS(c.clone(), d, sd, { zenithBoost: 0, saturation: 1, horizonBright: 0, skyHue: 0, horizonHue: 0, knee: 0 }, [1, 1, 1]);
    expect(s.r).toBeCloseTo(c.r, 6);
    expect(s.g).toBeCloseTo(c.g, 6);
    expect(s.b).toBeCloseTo(c.b, 6);
  });
});

describe('looks', () => {
  const NAMES = ['oceanDay', 'emerald', 'canyonRed', 'sunset', 'glacier', 'dunes', 'clouds', 'fortress', 'strike', 'aurora', 'title', 'hangar'];

  it('defines every look with valid grade / ocean presets', () => {
    for (const n of NAMES) {
      const l = LOOKS[n];
      expect(l, n).toBeTruthy();
      expect(GRADES[l.grade], `${n}.grade ${l.grade}`).toBeTruthy();
      if (l.ocean) expect(OCEAN_PRESETS[l.ocean], `${n}.ocean ${l.ocean}`).toBeTruthy();
      expect(l.toneExposure, n).toBeGreaterThanOrEqual(0.85);
      expect(l.toneExposure, n).toBeLessThanOrEqual(1.15);
      expect(l.bloom?.threshold, n).toBeGreaterThan(0);
      expect(l.sky, n).toBeTruthy();
    }
  });

  it('day looks keep the sun 22–40° up', () => {
    for (const n of ['oceanDay', 'emerald', 'canyonRed', 'glacier', 'dunes', 'strike', 'title']) {
      expect(LOOKS[n].elev, n).toBeGreaterThanOrEqual(22);
      expect(LOOKS[n].elev, n).toBeLessThanOrEqual(40);
    }
  });

  it('has the arcade ocean presets and keeps the old ones', () => {
    for (const n of ['arcadeBlue', 'sunsetGold', 'glacierRiver', 'auroraNight', 'goldSwell', 'twilight']) {
      const o = OCEAN_PRESETS[n];
      expect(o, n).toBeTruthy();
      expect(o.waves.length, n).toBe(6);
      expect(o.color.length, n).toBe(3);
    }
    // the arcade sea is a saturated blue
    const c = new Color().fromArray(OCEAN_PRESETS.arcadeBlue.color);
    expect(c.b).toBeGreaterThan(c.g * 2);
  });
});

describe('dynamic resolution (anti-flicker rules)', () => {
  const run = (dr, seconds, frameMs, workMs = 5) => {
    const changesAt = [];
    let t = 0;
    dr.onChange = () => changesAt.push(t);
    for (; t < seconds; t += frameMs / 1000) dr.push(frameMs, frameMs / 1000, workMs);
    return changesAt;
  };

  it('waits at least 4 s between changes', () => {
    const dr = new DynamicResolution(PRESETS.high, 60);
    const at = run(dr, 30, 50);
    expect(at.length).toBeGreaterThan(0);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(3.99);
    expect(dr.scale).toBeGreaterThanOrEqual(PRESETS.high.scaleMin);
  });

  it('never changes while locked and not on small overruns', () => {
    const dr = new DynamicResolution(PRESETS.high, 60);
    dr.locked = true;
    expect(run(dr, 20, 50)).toEqual([]);
    const dr2 = new DynamicResolution(PRESETS.high, 60);
    expect(run(dr2, 20, 18.5)).toEqual([]); // 1.1× the budget: inside the hysteresis band
  });

  it('only steps up after a long comfortable stretch', () => {
    const dr = new DynamicResolution(PRESETS.high, 60);
    dr.scale = dr.min;
    expect(run(dr, 7, 1000 / 60)).toEqual([]);
    expect(run(dr, 20, 1000 / 60).length).toBeGreaterThan(0);
  });
});

describe('camera FX history', () => {
  it('detects camera cuts but not fast steady flight', () => {
    const fx = new CameraFXEffect();
    const cam = new PerspectiveCamera(62, 16 / 9, 1.2, 32000);
    const prevVP = fx.uniforms.get('uPrevViewProj').value;
    const step = (dz, yaw = 0) => {
      cam.position.z -= dz;
      cam.rotation.y += yaw;
      cam.updateMatrixWorld();
      fx.updateCamera(cam, 1 / 60);
      const cut = prevVP.equals(fx._vp);
      fx.endFrame();
      return cut;
    };
    step(0);
    step(40); // accelerating from rest counts as a discontinuity once
    for (let i = 0; i < 30; i++) expect(step(40)).toBe(false); // 2400 m/s, steady
    expect(step(40, 0.02)).toBe(false); // normal turn
    expect(step(400)).toBe(true); // jump (scripted cut)
    expect(step(40)).toBe(true); // speed change back to normal is another discontinuity
    expect(step(40)).toBe(false);
    expect(step(40, (40 * Math.PI) / 180)).toBe(true); // 40° snap
    expect(fx.cuts).toBe(4);
  });
});

describe('enemy readability', () => {
  it('scales enemies by type or model defaults', () => {
    expect(visScaleOf({ model: 'fighterA' })).toBe(1.8);
    expect(visScaleOf({ model: 'stealthB' })).toBe(1.6);
    expect(visScaleOf({ model: 'heloCH47' })).toBe(1.4);
    expect(visScaleOf({ model: 'bomberB52' })).toBe(1.15);
    expect(visScaleOf({ model: 'destroyer' })).toBe(1);
    expect(visScaleOf({ model: 'fighterA', visScale: 1.3 })).toBe(1.3);
  });
});
