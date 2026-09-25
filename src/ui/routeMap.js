/**
 * Route map (After Burner Climax style): stages as squares, bonus stages as
 * spheres, forks as branching lines; visited / current / next / locked states.
 * Baseline stub — the HUD stream replaces it with the styled SVG version.
 *
 * @param {HTMLElement} container element to render into (contents replaced)
 * @param {object} graph ROUTE_GRAPH (see src/stages/routes.js / CONTRACTS §10)
 * @param {object} session {route: string[] visited ids, node: current id, eoCleared}
 * @param {object} [opts] {highlight: id, compact: bool}
 * @returns {SVGElement}
 */
export function renderRouteMap(container, graph, session, opts = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const layout = graph?.layout || {};
  const ids = Object.keys(layout);
  const cols = Math.max(1, ...ids.map((id) => layout[id][0] + 1));
  svg.setAttribute('viewBox', `0 0 ${cols * 60} 140`);
  svg.setAttribute('class', 'route-map');
  const visited = new Set(session?.route || []);
  for (const id of ids) {
    const [c, r, shape] = layout[id];
    const el = document.createElementNS(NS, shape === 'sphere' ? 'circle' : 'rect');
    const x = c * 60 + 10, y = r * 40 + 10;
    if (shape === 'sphere') {
      el.setAttribute('cx', x + 15);
      el.setAttribute('cy', y + 15);
      el.setAttribute('r', 12);
    } else {
      el.setAttribute('x', x);
      el.setAttribute('y', y);
      el.setAttribute('width', 30);
      el.setAttribute('height', 30);
    }
    const cur = id === (opts.highlight || session?.node);
    el.setAttribute('fill', cur ? '#ff6a3a' : visited.has(id) ? '#3fb7ff' : '#9aa3ad');
    svg.appendChild(el);
  }
  container.replaceChildren(svg);
  return svg;
}
