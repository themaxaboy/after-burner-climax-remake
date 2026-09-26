import { describe, it, expect } from 'vitest';
import { Color, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import { CameraFXEffect } from '../../src/render/effects/CameraFXEffect.js';
import { findDips, meanLuma } from '../../src/core/lumaProbe.js';
import { GRADES, ARCADE_GRADES, hueDir } from '../../src/render/effects/GradeEffect.js';
import { atmosphereJS, stylizeSkyJS, skyZenithHue, sunDirFromAngles, SKY_STYLE_DEFAULTS } from '../../src/world/atmosphere.js';
import { LOOKS } from '../../src/world/looks.js';
import { OCEAN_PRESETS } from '../../src/world/ocean.js';
import { DynamicResolution, PRESETS } from '../../src/core/quality.js';
import { visScaleOf, distanceScale, drawScaleOf, glowAnchors, EnemyRenderer, ENEMY_GLOW, ENEMY_LOOK } from '../../src/render/enemyRenderer.js';
import { EnemyTrails, ENEMY_TRAILS } from '../../src/render/enemyTrails.js';
import { FX_STUB } from '../../src/render/fxStub.js';
import { ENEMY_TYPES } from '../../src/sim/enemyTypes.js';
import { resolveLivery } from '../../src/models/livery.js';
import { DESIGNS } from '../../src/models/aircraftBuilder.js';

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

  it('distance compensation: ×1 up to 400 m, ×1.8 from ~1.3 km; small aircraft only', () => {
    expect(distanceScale(0)).toBe(1);
    expect(distanceScale(400)).toBe(1);
    expect(distanceScale(950)).toBeCloseTo(1.5);
    expect(distanceScale(1500)).toBe(1.8);
    expect(distanceScale(5000)).toBe(1.8);
    const f = ENEMY_TYPES.fighterA;
    expect(drawScaleOf(f, 200)).toBeCloseTo(1.8);
    expect(drawScaleOf(f, 1500)).toBeCloseTo(1.8 * 1.8);
    // on-screen width of a fighter (span 11.4 m) at 720p, fov 58: ≥ ~2× the pixels at 1.5 km
    const px = (span, d) => (span / (2 * d * Math.tan((29 * Math.PI) / 180))) * 720;
    expect(px(11.4 * drawScaleOf(f, 1500), 1500)).toBeGreaterThan(2 * px(11.4 * 1.8, 1500) * 0.85);
    expect(px(11.4 * drawScaleOf(f, 1500), 1500)).toBeGreaterThan(15); // was ~9 px
    // big aircraft (boss lock points) and ground units keep their size
    expect(drawScaleOf(ENEMY_TYPES.bomberB52, 1500)).toBeCloseTo(1.15);
    expect(drawScaleOf(ENEMY_TYPES.samSite, 1500)).toBe(1);
  });

  it('dark enemy paint with warm accents and a thin warm rim', () => {
    const lum = (hex) => new Color(hex).getHSL({}).l;
    for (const id of ['fighterA', 'stealthB', 'heloCH47', 'bomberXB', 'bomberB52']) {
      const liv = resolveLivery(DESIGNS[id], 'enemy');
      expect(lum(liv.top), `${id} top`).toBeLessThan(0.3);
      expect(lum(liv.bottom), `${id} bottom`).toBeLessThan(0.4);
      expect(liv.stripe, `${id} accent`).toBeTruthy();
      const a = new Color(liv.stripe.a).getHSL({});
      expect(a.h * 360, `${id} accent hue`).toBeLessThan(30); // red-orange
      expect(a.s).toBeGreaterThan(0.8);
    }
    expect(ENEMY_LOOK.uEnemyRim.value).toBeCloseTo(0.3);
    expect(ENEMY_LOOK.uEnemyRimColor.value.toArray()).toEqual([1, 0.5, 0.25]);
  });

  it('merges nozzles into ≤ 4 glow anchors', () => {
    const n = (x, y, z, r = 0.5) => ({ position: new Vector3(x, y, z), radius: r });
    expect(glowAnchors([n(1.2, 0, 8), n(-1.2, 0, 8)]).length).toBe(2);
    const xb = glowAnchors([0.75, -0.75, 2.25, -2.25, 3.75, -3.75].map((x) => n(x, -1, 26)));
    expect(xb.length).toBe(1); // one engine box: single-link chain within 2 m
    const b52 = glowAnchors([-16.9, -15.5, -9.8, -8.4, 8.4, 9.8, 15.5, 16.9].map((x) => n(x, 0, 3)));
    expect(b52.length).toBe(4);
    expect(glowAnchors([]).length).toBe(0);
  });
});

describe('enemy exhaust glow and nose lights', () => {
  function enemy(type, pos, extra = {}) {
    const q = new Quaternion();
    return { id: Math.floor(Math.random() * 1e6), active: true, visible: true, def: ENEMY_TYPES[type], pos: pos.clone(), prevPos: pos.clone(), quat: q, prevQuat: q.clone(), flash: 0, dying: 0, dead: false, noseLight: 0, ...extra };
  }

  it('one additive instanced mesh, in the scene from the start (precompile), sized ≥ ~2 px radius at 1.5 km', () => {
    const scene = new Scene();
    const r = new EnemyRenderer(scene, null);
    expect(scene.children).toContain(r.glow);
    expect(r.glow.instanceColor).toBeTruthy();
    r.warmup(true);
    expect(r.glow.count).toBe(1);
    r.warmup(false);
    const cam = new PerspectiveCamera(58, 16 / 9, 1, 30000);
    const list = [enemy('fighterA', new Vector3(0, 0, -1500)), enemy('fighterA', new Vector3(20, 0, -300), { noseLight: 1 }), enemy('samSite', new Vector3(0, 0, -800))];
    r.update({ list }, 1, cam, 1 / 60);
    expect(r.glowCount).toBe(3); // one exhaust each (fallback model) + one nose light; no glow on ground units
    const arr = r.glow.instanceMatrix.array;
    const radius0 = Math.hypot(arr[0], arr[1], arr[2]); // x scale of the first instance
    const pxPerM = 360 / (1500 * Math.tan((29 * Math.PI) / 180));
    expect(radius0 * pxPerM).toBeGreaterThanOrEqual(2);
    const col = r.glow.instanceColor.array;
    expect(col[0]).toBeGreaterThan(2); // HDR orange
    expect(col[0]).toBeGreaterThan(col[1] * 1.8);
    expect(col[6]).toBeGreaterThan(col[7] * 5); // red nose light
    // nothing for dying aircraft; the nose light blinks off with e.noseLight = 0
    list[0].dying = 1;
    list[1].noseLight = 0;
    r.update({ list }, 1, cam, 1 / 60);
    expect(r.glowCount).toBe(1);
    expect(ENEMY_GLOW.exhaust.r).toBeGreaterThan(ENEMY_GLOW.exhaust.g);
    r.dispose();
    expect(scene.children).not.toContain(r.glow);
  });

  it('distance compensation reaches the instance matrices', () => {
    const scene = new Scene();
    const r = new EnemyRenderer(scene, null);
    const cam = new PerspectiveCamera(58, 16 / 9, 1, 30000);
    r.update({ list: [enemy('fighterA', new Vector3(0, 0, -1500))] }, 1, cam);
    const g = r.groups.get('fighterA');
    const a = g.matrixAttr.array;
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1.8 * 1.8, 3);
    r.update({ list: [enemy('fighterA', new Vector3(0, 0, -200))] }, 1, cam);
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1.8, 3);
    r.dispose();
  });
});

describe('enemy contrails', () => {
  function fakeFx(name = 'medium', cap = 40) {
    const trails = [];
    return {
      Q: { name, trails: cap },
      trails: { active: 0 },
      made: trails,
      createTrail(o) {
        const t = { o, pts: 0, alive: true, stopped: false, push() { this.pts++; }, stop() { this.stopped = true; this.alive = false; } };
        trails.push(t);
        this.trails.active++;
        return t;
      }
    };
  }
  const cam = new PerspectiveCamera(58, 16 / 9, 1, 30000);
  let id = 1;
  const fighter = (z, x = 0) => {
    const p = new Vector3(x, 0, z);
    return { id: id++, active: true, visible: true, dead: false, dying: 0, def: ENEMY_TYPES.fighterA, pos: p, prevPos: p.clone(), quat: new Quaternion(), vel: new Vector3(0, 0, 300) };
  };

  it('no-op with the FX stub and on low quality', () => {
    const list = [fighter(-500)];
    const a = new EnemyTrails(FX_STUB);
    expect(a.enabled).toBe(false);
    a.update({ list }, cam);
    expect(a.count).toBe(0);
    const low = fakeFx('low');
    const b = new EnemyTrails(low);
    b.update({ list }, cam);
    expect(low.made.length).toBe(0);
    a.dispose();
    b.dispose();
  });

  it('thin short contrails on the ≤ 6 nearest fast aircraft; stopped when they die or leave', () => {
    const fx = fakeFx();
    const tr = new EnemyTrails(fx);
    const list = [];
    for (let i = 0; i < 10; i++) list.push(fighter(-200 - i * 100, (i % 3) * 20));
    const slow = fighter(-150);
    slow.vel.set(0, 0, 50); // helicopter-slow: no trail
    list.push(slow);
    for (let f = 0; f < 12; f++) tr.update({ list }, cam, 1);
    expect(tr.count).toBe(ENEMY_TRAILS.max);
    expect(fx.made.every((t) => t.o.kind === 'contrail' && t.o.life <= 1.5 && t.o.width < 1)).toBe(true);
    const withTrail = new Set(tr.recs.map((r) => r.e));
    expect(withTrail.has(slow)).toBe(false);
    expect(withTrail.has(list[0])).toBe(true); // nearest first
    // a dead enemy's trail is stopped (returned to the pool)
    const victim = tr.recs[0].e;
    const handle = tr.recs[0].trail;
    victim.dead = true;
    tr.update({ list }, cam, 1);
    expect(handle.stopped).toBe(true);
    expect(tr.recs.some((r) => r.e === victim)).toBe(false);
    // missiles need the pool: enemy trails give way
    fx.trails.active = fx.Q.trails - 2;
    const before = tr.count;
    tr.update({ list }, cam, 1);
    expect(tr.count).toBeLessThan(before);
    tr.clear();
    expect(tr.count).toBe(0);
    tr.dispose();
  });
});
