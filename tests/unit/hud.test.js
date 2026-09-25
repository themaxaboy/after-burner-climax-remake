import { describe, it, expect } from 'vitest';
import { hudUnit, hudLayout, targetBoxSize, comboTier, armorColor, edgePoint } from '../../src/ui/hud/layout.js';
import { calloutVariant } from '../../src/ui/hud/callouts.js';
import { routeNodeStates, routeEdges, routeSuccessors } from '../../src/ui/routeMap.js';
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

  it('sizes target boxes by distance within 16–60 reference px', () => {
    const u = 1;
    expect(targetBoxSize(10, 5, 720, u)).toBe(60);
    expect(targetBoxSize(10, 1e6, 720, u)).toBe(16);
    const mid = targetBoxSize(10, 800, 720, u);
    expect(mid).toBeGreaterThan(16);
    expect(mid).toBeLessThan(60);
    expect(targetBoxSize(10, 400, 720, u)).toBeGreaterThan(mid);
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

describe('HUD strings', () => {
  it('has every HUD key in English and Thai text for warnings', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('hud.') || k.startsWith('route.') || k.startsWith('status.') || k.startsWith('wait.'));
    expect(keys.length).toBeGreaterThan(40);
    for (const k of ['opt.autoMissile', 'opt.climaxToggle', 'hud.missile', 'hud.pullUp', 'status.title', 'wait.title']) {
      expect(en[k]).toBeTruthy();
      expect(th[k]).toBeTruthy();
    }
    expect(/[฀-๿]/.test(th['hud.missile'])).toBe(true);
  });
});
