import { describe, it, expect } from 'vitest';
import { hudUnit, hudLayout, comboTier, armorColor, edgePoint, MARK, enemyHalfExtent, silhouettePx, lockBoxSize, markerGeometry } from '../../src/ui/hud/layout.js';
import { calloutVariant } from '../../src/ui/hud/callouts.js';
import { routeNodeStates, routeEdges, routeSuccessors, bonusProgress } from '../../src/ui/routeMap.js';
import en from '../../src/ui/strings/en.js';
import th from '../../src/ui/strings/th.js';

describe('HUD layout', () => {
  it('scales with the screen and boosts short (phone) screens', () => {
    expect(hudUnit(1280, 720, 1)).toBeCloseTo(1);
    expect(hudUnit(2560, 1440, 2)).toBeCloseTo(2);
    // 844×390 CSS at dpr 2: base unit is height-bound, plus a readability boost
    const base = Math.min(1688 / 1280, 780 / 720);
    expect(hudUnit(1688, 780, 2)).toBeGreaterThan(base * 1.2);
    expect(hudUnit(1688, 780, 2)).toBeLessThanOrEqual(base * 1.3);
  });

  it('keeps the touch layout clear of the pause button and fire buttons', () => {
    const k = 2, W = 844 * k, H = 390 * k;
    const L = hudLayout(W, H, k, true);
    // pause button: right 14 px + 42 px wide (CSS) → stage block ends left of it
    expect(L.stage.x).toBeLessThanOrEqual(W - 56 * k);
    // armor gauge moves to the top-right, above the flare/missile buttons (bottom ~55 %)
    expect(L.armor.compact).toBe(true);
    expect(L.armor.y + L.armor.r).toBeLessThan(H * 0.47);
    expect(L.armor.x + L.armor.r).toBeLessThan(W - 58 * k);
    const D = hudLayout(W, H, k, false);
    expect(D.armor.y).toBeGreaterThan(H * 0.6);
  });

  it('projects enemy silhouettes from their render size and distance', () => {
    const fighter = { radius: 10.9, def: { size: 9.1, visScale: 1.8 } };
    expect(enemyHalfExtent(fighter)).toBeCloseTo(9.1 * 1.8 * MARK.fill);
    expect(enemyHalfExtent({ radius: 22, def: { visScale: 1 } })).toBeCloseTo(22 * MARK.fill); // ground units: collision radius
    expect(enemyHalfExtent(fighter, 1.5)).toBeCloseTo(9.1 * 1.8 * MARK.fill * 1.5);
    // 58° fov, 720 px: a 16.4 m half-extent at 1000 m ≈ 21 px across
    const px = silhouettePx(16.38, 1000, 720);
    expect(px).toBeGreaterThan(19);
    expect(px).toBeLessThan(23);
    expect(silhouettePx(16.38, 500, 720)).toBeCloseTo(px * 2);
  });

  it('keeps lock boxes small (14–34 px) and outside the silhouette with a 6 px gap', () => {
    const u = 1, H = 720;
    const fighter = { radius: 10.9, def: { size: 9.1, visScale: 1.8 } };
    expect(lockBoxSize(0, u, H)).toBe(MARK.boxMin); // tiny / far target
    // a fighter across its lock range
    for (const d of [700, 1000, 1300, 1600, 2400]) {
      const sil = silhouettePx(enemyHalfExtent(fighter), d, H);
      const side = lockBoxSize(sil, u, H);
      expect(side).toBeGreaterThanOrEqual(14);
      expect(side).toBeLessThanOrEqual(34 + 1e-9);
      // box edge sits a full gap outside the silhouette
      expect(side / 2).toBeGreaterThanOrEqual(sil / 2 + MARK.gap - 1e-9);
    }
    // it scales with the layout unit (bigger screens)
    expect(lockBoxSize(0, 2, H * 2)).toBe(28);
    expect(lockBoxSize(40, 2, H * 2)).toBe(64);
  });

  it('only grows past 34 px when a close / big airframe would reach the corner ticks', () => {
    const u = 1, H = 720;
    expect(lockBoxSize(24, u, H)).toBe(34);
    const near = lockBoxSize(120, u, H);
    expect(near).toBeGreaterThan(34);
    expect(near).toBeGreaterThanOrEqual(120 * MARK.corner + 2 * MARK.gap);
    expect(near).toBeLessThan(120 + 2 * MARK.gap);
    expect(lockBoxSize(5000, u, H)).toBeLessThanOrEqual(H * 0.45);
  });

  it('places the tick arms, the ✕ (above-right) and the health bar (below) around the box', () => {
    const g = markerGeometry(400, 300, 20, 1, 720);
    expect(g.side).toBe(32);
    expect(g.half).toBe(16);
    expect(g.arm).toBe(MARK.arm);
    expect(g.line).toBe(MARK.line);
    expect(g.xr * 2).toBe(MARK.x);
    expect(g.xx - g.xr).toBeGreaterThan(400 + g.half + 2); // right of the box
    expect(g.xy + g.xr).toBeLessThan(300 - g.half - 2); // above it, clear of the corner tick
    expect(g.barY).toBeGreaterThan(300 + g.half);
    expect(g.top).toBe(300 - g.half);
    // tiny boxes keep short arms so the corners stay separate
    expect(markerGeometry(0, 0, 0, 1, 720).arm).toBeLessThan(MARK.boxMin / 2);
  });

  it('picks combo colour tiers and armor colours', () => {
    expect(comboTier(5)).toBe(0);
    expect(comboTier(20)).toBe(1);
    expect(comboTier(80)).toBe(2);
    expect(armorColor(1)).toEqual([90, 255, 90]);
    const low = armorColor(0);
    expect(low[0]).toBe(255);
    expect(low[1]).toBeLessThan(60);
    const mid = armorColor(0.5);
    expect(mid[0]).toBe(255);
    expect(mid[1]).toBeGreaterThan(200);
  });

  it('projects warning arrows onto the screen edge', () => {
    const p = edgePoint(1, 0, 1000, 500, 20);
    expect(p.x).toBeCloseTo(980);
    expect(p.y).toBeCloseTo(250);
    const q = edgePoint(0, 1, 1000, 500, 20);
    expect(q.y).toBeCloseTo(480);
    const d = edgePoint(-1, -1, 1000, 500, 20);
    expect(d.y).toBeCloseTo(20);
    expect(d.x).toBeGreaterThan(20);
  });

  it('maps message colours to callout variants', () => {
    expect(calloutVariant('gold')).toBe('gold');
    expect(calloutVariant(null, '#7dffb0')).toBe('green');
    expect(calloutVariant(null, '#ff5a4a')).toBe('red');
    expect(calloutVariant(null, null)).toBe('red');
  });
});

describe('Route map', () => {
  const graph = {
    start: 'ocean',
    nodes: {
      ocean: { next: 'emerald' },
      emerald: { next: 'canyon' },
      canyon: { fork: [{ id: 'sunset', side: -1 }, { id: 'glacier', side: 1 }] },
      sunset: { next: 'dunes' },
      glacier: { next: 'dunes' },
      dunes: { fork: [{ id: 'clouds', side: -1 }, { id: 'strike', side: 1 }], bonus: { id: 'aurora', requires: 3 } },
      aurora: { fork: [{ id: 'clouds', side: -1 }, { id: 'strike', side: 1 }] },
      clouds: { next: 'fortress' },
      strike: { next: 'fortress' },
      fortress: { end: true }
    },
    layout: {
      ocean: [0, 1, 'square'], emerald: [1, 1, 'square'], canyon: [2, 1, 'square'], sunset: [3, 0, 'square'], glacier: [3, 2, 'square'],
      dunes: [4, 1, 'square'], aurora: [5, 1, 'sphere'], clouds: [6, 0, 'square'], strike: [6, 2, 'square'], fortress: [7, 1, 'square']
    }
  };

  it('lists successors and edges without duplicates', () => {
    expect(routeSuccessors(graph.nodes.dunes)).toEqual(['clouds', 'strike', 'aurora']);
    expect(routeSuccessors({ next: 'a', fork: [{ id: 'a' }] })).toEqual(['a']);
    const edges = routeEdges(graph);
    expect(edges).toContainEqual(['canyon', 'sunset']);
    expect(edges).toContainEqual(['aurora', 'strike']);
    expect(edges.length).toBe(13);
  });

  it('marks visited, current, available and locked nodes', () => {
    const st = routeNodeStates(graph, { route: ['ocean', 'emerald', 'canyon'], node: 'canyon', eoCleared: {} });
    expect(st.ocean).toBe('visited');
    expect(st.canyon).toBe('current');
    expect(st.sunset).toBe('available');
    expect(st.glacier).toBe('available');
    expect(st.dunes).toBe('locked');
  });

  it('opens the bonus sphere only with enough Emergency Orders cleared', () => {
    const s1 = { route: ['ocean', 'emerald', 'canyon', 'glacier', 'dunes'], node: 'dunes', eoCleared: { helos: true, xb70: true } };
    expect(routeNodeStates(graph, s1).aurora).toBe('locked');
    const s2 = { ...s1, eoCleared: { helos: true, xb70: true, aa: true } };
    const st = routeNodeStates(graph, s2);
    expect(st.aurora).toBe('available');
    expect(st.clouds).toBe('available');
    expect(st.sunset).toBe('locked');
    expect(routeNodeStates(graph, s2, { highlight: 'glacier' }).glacier).toBe('current');
  });

  it('offers the start node before the first sortie', () => {
    expect(routeNodeStates(graph, { route: [], node: null }).ocean).toBe('available');
  });
});

describe('Route map bonus progress', () => {
  const graph = { start: 'a', nodes: { a: { next: 'b', bonus: { id: 'x', requires: 2 } }, x: { rejoin: 'a', bonusStage: true }, b: { end: true } }, layout: {} };

  it('counts cleared Emergency Orders against the requirement', () => {
    expect(bonusProgress(graph, { eoCleared: { e1: true } }, 'x')).toEqual({ n: 1, need: 2, open: false });
    expect(bonusProgress(graph, { eoCleared: { e1: true, e2: true, e3: false } }, 'x')).toEqual({ n: 2, need: 2, open: true });
    expect(bonusProgress(graph, {}, 'b')).toBe(null);
  });
});

describe('HUD strings', () => {
  it('has every HUD key in English and Thai text for warnings', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('hud.') || k.startsWith('route.') || k.startsWith('status.') || k.startsWith('wait.'));
    expect(keys.length).toBeGreaterThan(40);
    for (const k of ['opt.autoMissile', 'opt.climaxToggle', 'opt.stickRoll', 'opt.missileTone', 'opt.toneSoft', 'opt.toneOff', 'hud.missile', 'hud.pullUp', 'status.title', 'wait.title']) {
      expect(en[k]).toBeTruthy();
      expect(th[k]).toBeTruthy();
    }
    expect(/[฀-๿]/.test(th['hud.missile'])).toBe(true);
  });
});
