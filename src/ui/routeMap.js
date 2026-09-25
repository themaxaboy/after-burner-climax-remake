import { t } from './i18n.js';

/**
 * Route map (After Burner Climax style), rendered as a styled SVG: stages are
 * glass squares, bonus stages metallic spheres, forks branch as circuit lines.
 * Node states: visited (bright cyan glass), current (orange, with the jet
 * icon flying in from the previous stage), available (white, pulsing) and
 * locked (grey). CSS lives in ui.css (.route-map, .route-map-svg, .rm-*).
 */

const NS = 'http://www.w3.org/2000/svg';

/** Successor ids of a node (next, fork branches, bonus), without duplicates. */
export function routeSuccessors(node) {
  if (!node) return [];
  const out = [];
  const add = (id) => id && !out.includes(id) && out.push(id);
  add(node.next);
  for (const f of node.fork || []) add(f.id);
  if (node.bonus) add(node.bonus.id);
  return out;
}

/** Unique directed edges [from, to] of the graph. */
export function routeEdges(graph) {
  const edges = [];
  for (const [id, node] of Object.entries(graph?.nodes || {})) for (const to of routeSuccessors(node)) edges.push([id, to]);
  return edges;
}

/** Number of cleared Emergency Orders in a session. */
function eoCount(session) {
  const c = session?.eoCleared;
  if (!c) return 0;
  if (Array.isArray(c)) return c.length;
  return Object.values(c).filter(Boolean).length;
}

/**
 * State of every node: 'current' | 'visited' | 'available' | 'locked'.
 * @param {object} graph ROUTE_GRAPH
 * @param {object} session {route: visited ids, node: current id, eoCleared}
 * @param {object} [opts] {highlight: current id override}
 */
export function routeNodeStates(graph, session, opts = {}) {
  const ids = Object.keys(graph?.layout || graph?.nodes || {});
  const cur = opts.highlight || session?.node || null;
  const visited = new Set(session?.route || []);
  const states = {};
  for (const id of ids) states[id] = id === cur ? 'current' : visited.has(id) ? 'visited' : 'locked';
  const node = cur ? graph?.nodes?.[cur] : null;
  if (node) {
    for (const id of routeSuccessors(node)) {
      if (!(id in states) || states[id] !== 'locked') continue;
      if (node.bonus && node.bonus.id === id && eoCount(session) < (node.bonus.requires || 0)) continue;
      states[id] = 'available';
    }
  } else if (!cur && graph?.start && states[graph.start] === 'locked') states[graph.start] = 'available';
  return states;
}

function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  parent?.appendChild(e);
  return e;
}

function grad(defs, id, stops, x2 = 0, y2 = 1) {
  const g = el('linearGradient', { id, x1: 0, y1: 0, x2, y2 }, defs);
  stops.forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, g));
  return g;
}

let uid = 0;

/**
 * @param {HTMLElement} container element to render into (contents replaced)
 * @param {object} graph ROUTE_GRAPH (CONTRACTS §10): {nodes, layout: {id: [col, row, 'square'|'sphere']}, start}
 * @param {object} session {route: string[] visited ids, node: current id, eoCleared}
 * @param {object} [opts] {highlight: current id, compact: bool, animate: bool (default true),
 *   from: id the jet flies in from (default: previous visited node), names: {id: label}, label: bool (ROUTE → tag, default true)}
 * @returns {SVGElement}
 */
export function renderRouteMap(container, graph, session, opts = {}) {
  const layout = graph?.layout || {};
  const ids = Object.keys(layout);
  const compact = !!opts.compact;
  const p = `rm${++uid}`;
  const S = compact ? 26 : 34; // square side
  const CX = compact ? 50 : 66, CY = compact ? 30 : 42; // cell pitch
  const padL = opts.label === false ? 14 : compact ? 50 : 76, padT = 16, padB = compact ? 16 : 30;
  let maxC = 0, maxR = 0;
  for (const id of ids) {
    maxC = Math.max(maxC, layout[id][0]);
    maxR = Math.max(maxR, layout[id][1]);
  }
  const W = padL + maxC * CX + S + 20;
  const H = padT + maxR * CY + S + padB;
  const pos = (id) => {
    const l = layout[id];
    return l ? { x: padL + l[0] * CX + S / 2, y: padT + l[1] * CY + S / 2 } : null;
  };
  const states = routeNodeStates(graph, session, opts);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: `route-map-svg${compact ? ' compact' : ''}`, role: 'img', 'aria-label': t('route.label') });
  const defs = el('defs', {}, svg);
  grad(defs, `${p}-visited`, [[0, '#f2fdff'], [0.45, '#7fe2ff'], [1, '#1a8fea']]);
  grad(defs, `${p}-current`, [[0, '#fff0c8'], [0.45, '#ffa23a'], [1, '#e2520a']]);
  grad(defs, `${p}-available`, [[0, '#ffffff'], [0.6, '#f1f6fd'], [1, '#c9d7ea']]);
  grad(defs, `${p}-locked`, [[0, '#d7dce4'], [1, '#8d96a6']]);
  const rg = el('radialGradient', { id: `${p}-sphere`, cx: 0.35, cy: 0.3, r: 0.75 }, defs);
  for (const [o, c] of [[0, '#ffffff'], [0.25, '#e9eef6'], [0.6, '#9aa6ba'], [0.85, '#5b667c'], [1, '#c3cad8']]) el('stop', { offset: o, 'stop-color': c }, rg);
  const rgOn = el('radialGradient', { id: `${p}-sphereOn`, cx: 0.35, cy: 0.3, r: 0.75 }, defs);
  for (const [o, c] of [[0, '#ffffff'], [0.25, '#e8fbff'], [0.6, '#6fd6ff'], [0.85, '#1a6fd0'], [1, '#bfeaff']]) el('stop', { offset: o, 'stop-color': c }, rgOn);
  const glow = el('filter', { id: `${p}-glow`, x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
  el('feGaussianBlur', { stdDeviation: compact ? 2 : 3, result: 'b' }, glow);
  const fm = el('feMerge', {}, glow);
  el('feMergeNode', { in: 'b' }, fm);
  el('feMergeNode', { in: 'SourceGraphic' }, fm);

  // --- edges: circuit-style elbows (horizontal, vertical at the midpoint, horizontal)
  const gEdges = el('g', { class: 'rm-edges', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
  const lit = (a, b) => (states[a] === 'visited' || states[a] === 'current') && (states[b] === 'visited' || states[b] === 'current');
  const next = (a, b) => states[a] === 'current' && states[b] === 'available';
  for (const [a, b] of routeEdges(graph)) {
    const A = pos(a), B = pos(b);
    if (!A || !B) continue;
    const ax = A.x + S / 2, bx = B.x - S / 2;
    const mx = (ax + bx) / 2;
    const d = A.y === B.y ? `M${ax} ${A.y}H${bx}` : `M${ax} ${A.y}H${mx}V${B.y}H${bx}`;
    const on = lit(a, b), nx = next(a, b);
    el('path', { d, stroke: 'rgba(6, 30, 80, 0.55)', 'stroke-width': compact ? 6 : 8 }, gEdges);
    el('path', { d, stroke: on ? '#6fe0ff' : nx ? '#ffffff' : '#a3adbd', 'stroke-width': compact ? 3 : 4, class: on ? 'rm-edge lit' : nx ? 'rm-edge next' : 'rm-edge' }, gEdges);
  }

  // --- ROUTE → tag at the start
  if (opts.label !== false && ids.length) {
    const s0 = pos(graph.start || ids[0]);
    const gl = el('g', { class: 'rm-label', transform: `translate(${s0.x - S / 2 - 8} ${s0.y})` }, svg);
    const tx = el('text', { x: -4, y: compact ? 16 : 22, 'text-anchor': 'end', 'font-family': 'Rajdhani, sans-serif', 'font-weight': 700, 'font-style': 'italic', 'font-size': compact ? 11 : 14, fill: '#0a3fae', stroke: '#ffffff', 'stroke-width': 3, 'paint-order': 'stroke' }, gl);
    tx.textContent = t('route.label');
    el('path', { d: `M${compact ? -40 : -62} ${compact ? 20 : 27}H-2l-6 -5M-2 ${compact ? 20 : 27}l-6 5`, stroke: '#ffae00', 'stroke-width': compact ? 2.5 : 3.5, fill: 'none', 'stroke-linecap': 'round' }, gl);
  }

  // --- nodes
  const gNodes = el('g', { class: 'rm-nodes' }, svg);
  const names = opts.names || {};
  for (const id of ids) {
    const P = pos(id);
    const st = states[id];
    const shape = layout[id][2] || 'square';
    const g = el('g', { class: `rm-node ${st} ${shape}`, 'data-id': id, transform: `translate(${P.x} ${P.y})` }, gNodes);
    if (shape === 'sphere') {
      const r = S * 0.42;
      el('ellipse', { cx: 1.5, cy: r * 0.95, rx: r * 0.9, ry: r * 0.25, fill: 'rgba(0, 20, 60, 0.35)' }, g);
      el('circle', { class: 'rm-face', r, fill: `url(#${p}-${st === 'visited' || st === 'current' ? 'sphereOn' : 'sphere'})`, stroke: st === 'locked' ? '#6b7486' : '#ffffff', 'stroke-width': 2, opacity: st === 'locked' ? 0.8 : 1, filter: st === 'available' ? `url(#${p}-glow)` : null }, g);
      el('ellipse', { cx: -r * 0.3, cy: -r * 0.38, rx: r * 0.34, ry: r * 0.2, fill: 'rgba(255,255,255,0.85)' }, g);
    } else {
      const h = S / 2;
      el('rect', { x: -h + 2.5, y: -h + 3, width: S, height: S, rx: 5, fill: 'rgba(0, 20, 60, 0.35)' }, g);
      const face = el('rect', { class: 'rm-face', x: -h, y: -h, width: S, height: S, rx: 5, fill: `url(#${p}-${st})`, stroke: st === 'locked' ? '#7d879a' : '#ffffff', 'stroke-width': 2 }, g);
      if (st === 'current') face.setAttribute('filter', `url(#${p}-glow)`);
      el('rect', { x: -h + 3, y: -h + 3, width: S - 6, height: S * 0.38, rx: 3, fill: 'rgba(255,255,255,0.45)' }, g);
      // inner bevel mark
      el('rect', { x: -h + 6, y: -h + 6, width: S - 12, height: S - 12, rx: 2, fill: 'none', stroke: st === 'locked' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.6)', 'stroke-width': 1 }, g);
    }
    if (names[id] && !compact) {
      const tx = el('text', { y: S / 2 + 14, 'text-anchor': 'middle', 'font-family': 'Rajdhani, sans-serif', 'font-weight': 700, 'font-size': 10, fill: st === 'locked' ? '#56617a' : '#0b2c63', stroke: '#ffffff', 'stroke-width': 2.5, 'paint-order': 'stroke' }, g);
      tx.textContent = names[id];
    }
  }

  // --- jet icon on the current node (flies in from the previous stage)
  const cur = ids.find((id) => states[id] === 'current');
  if (cur) {
    const route = session?.route || [];
    let from = opts.from;
    if (!from) {
      const i = route.lastIndexOf(cur);
      from = i > 0 ? route[i - 1] : i < 0 ? route[route.length - 1] : null;
    }
    const P = pos(cur), F = from && pos(from) ? pos(from) : P;
    const js = compact ? 0.8 : 1.1;
    const jet = el('g', { class: 'rm-jet' }, svg);
    const inner = el('g', { transform: `translate(0 ${-S * 0.05}) scale(${js}) rotate(90)` }, jet);
    el('path', {
      d: 'M0 -14 L2.4 -6 L13 2 L13 5 L2.6 2.6 L2.2 8 L6.5 11.5 L6.5 13 L0 11.4 L-6.5 13 L-6.5 11.5 L-2.2 8 L-2.6 2.6 L-13 5 L-13 2 L-2.4 -6 Z',
      fill: '#ffffff', stroke: '#0b2c63', 'stroke-width': 1.6, 'stroke-linejoin': 'round'
    }, inner);
    el('path', { d: 'M0 -9 L1.3 -4 L-1.3 -4 Z', fill: '#1a8fea' }, inner);
    const animate = opts.animate !== false && F !== P && typeof requestAnimationFrame !== 'undefined';
    jet.style.transform = `translate(${(animate ? F : P).x}px, ${(animate ? F : P).y}px)`;
    if (animate) {
      jet.style.transition = 'transform 1.1s cubic-bezier(0.3, 0.9, 0.3, 1.1) 0.25s';
      requestAnimationFrame(() => requestAnimationFrame(() => (jet.style.transform = `translate(${P.x}px, ${P.y}px)`)));
    }
  }

  container.classList?.add('route-map');
  container.classList?.toggle('compact', compact);
  container.replaceChildren(svg);
  return svg;
}
