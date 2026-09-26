// Route graph (docs/overhaul/CONTRACTS.md §10). Short stages linked by forks:
// at the end of a fork stage the player steers left or right between two big
// arrows (routeSelect component) and the choice decides the next stage.
// Bonus nodes (spheres on the route map) unlock on a condition and are played
// between a fork stage and the stage chosen at that fork.
// Laid out like the original's route map: 18 stages (16 + 2 bonus), 11 per
// run (13 with both bonus stages), a MID-GAME RESULT after GOLDEN DUNES.
//
//   ocean → emerald → canyon ─┬─ sunset ──┬─ dunes ─(aurora)─┬─ storm ───┬─ clouds ─┬─ nightfleet ─(stratos)─┬─ whiteout ─┬─ jetstream ─┬─ fortress
//                             └─ glacier ─┘                  └─ volcano ─┴─ strike ─┘                        └─ ravine ───┴─ badlands ──┘
//   (storm and volcano both fork to clouds / strike; whiteout and ravine both
//   fork to jetstream / badlands)

const CLOUDS_OR_STRIKE = [{ id: 'clouds', side: -1 }, { id: 'strike', side: 1 }];
const JETSTREAM_OR_BADLANDS = [{ id: 'jetstream', side: -1 }, { id: 'badlands', side: 1 }];

export const ROUTE_GRAPH = {
  start: 'ocean',
  nodes: {
    ocean: { next: 'emerald' },
    emerald: { next: 'canyon' },
    canyon: { fork: [{ id: 'sunset', side: -1 }, { id: 'glacier', side: 1 }] },
    sunset: { next: 'dunes' },
    glacier: { next: 'dunes' },
    dunes: {
      fork: [{ id: 'storm', side: -1 }, { id: 'volcano', side: 1 }],
      bonus: { id: 'aurora', requires: 3 } // Emergency Orders cleared so far
    },
    // bonus: continues to whatever was chosen at the dunes fork
    aurora: { rejoin: 'dunes', bonusStage: true },
    storm: { fork: CLOUDS_OR_STRIKE },
    volcano: { fork: CLOUDS_OR_STRIKE },
    clouds: { next: 'nightfleet' },
    strike: { next: 'nightfleet' },
    nightfleet: {
      fork: [{ id: 'whiteout', side: -1 }, { id: 'ravine', side: 1 }],
      bonus: { id: 'stratos', requires: 6 }
    },
    stratos: { rejoin: 'nightfleet', bonusStage: true },
    whiteout: { fork: JETSTREAM_OR_BADLANDS },
    ravine: { fork: JETSTREAM_OR_BADLANDS },
    jetstream: { next: 'fortress' },
    badlands: { next: 'fortress' },
    fortress: { end: true }
  },
  // route map: [column, row (0 top · 1 middle · 2 bottom), shape]
  layout: {
    ocean: [0, 1, 'square'],
    emerald: [1, 1, 'square'],
    canyon: [2, 1, 'square'],
    sunset: [3, 0, 'square'],
    glacier: [3, 2, 'square'],
    dunes: [4, 1, 'square'],
    aurora: [5, 1, 'sphere'],
    storm: [6, 0, 'square'],
    volcano: [6, 2, 'square'],
    clouds: [7, 0, 'square'],
    strike: [7, 2, 'square'],
    nightfleet: [8, 1, 'square'],
    stratos: [9, 1, 'sphere'],
    whiteout: [10, 0, 'square'],
    ravine: [10, 2, 'square'],
    jetstream: [11, 0, 'square'],
    badlands: [11, 2, 'square'],
    fortress: [12, 1, 'square']
  },
  // a STATUS REPORT panel follows these stages (the first one is the MID-GAME RESULT)
  statusAfter: ['dunes', 'nightfleet', 'fortress']
};

/** Fork options of a node, left first ([{id, side}, …]), or null. */
export function forkOf(nodeId, graph = ROUTE_GRAPH) {
  const n = graph.nodes[nodeId];
  if (!n?.fork) return null;
  return n.fork.slice().sort((a, b) => a.side - b.side);
}

/** Number of Emergency Orders cleared in a session ({id: true} map). */
export function eoClearedCount(session) {
  const eo = session?.eoCleared || {};
  return Object.values(eo).filter(Boolean).length;
}

/** True when the bonus stage hanging off `nodeId` is unlocked for this session. */
export function bonusUnlocked(nodeId, session, graph = ROUTE_GRAPH) {
  const b = graph.nodes[nodeId]?.bonus;
  if (!b) return false;
  if (session?.route?.includes(b.id)) return false; // already flown
  if (session?.routePlan?.includes(b.id)) return true; // forced (?route=…, tests)
  return eoClearedCount(session) >= (b.requires ?? 0);
}

/**
 * Fork decision for `nodeId`: the recorded choice (session.choices[nodeId]),
 * else a pre-planned choice (session.routePlan = ?route=a,b,c), else the left
 * option. Returns a stage id or null when the node is not a fork.
 */
export function choiceAt(nodeId, session, graph = ROUTE_GRAPH) {
  const opts = forkOf(nodeId, graph);
  if (!opts) return null;
  const ids = opts.map((o) => o.id);
  const made = session?.choices?.[nodeId];
  if (ids.includes(made)) return made;
  const planned = plannedChoice(nodeId, session?.routePlan, graph);
  return planned ?? ids[0];
}

/** The fork option of `nodeId` named in a planned route list (?route=…), or null. */
export function plannedChoice(nodeId, plan, graph = ROUTE_GRAPH) {
  const opts = forkOf(nodeId, graph);
  if (!opts || !plan?.length) return null;
  const hit = opts.find((o) => plan.includes(o.id));
  return hit ? hit.id : null;
}

/**
 * Next stage id after `nodeId` has been cleared, or null at the end.
 * session: {choices: {forkNode: chosenId}, eoCleared, routePlan, route}
 */
export function nextOf(nodeId, session = {}, graph = ROUTE_GRAPH) {
  const n = graph.nodes[nodeId];
  if (!n || n.end) return null;
  if (n.bonus && bonusUnlocked(nodeId, session, graph)) return n.bonus.id;
  if (n.fork) return choiceAt(nodeId, session, graph);
  if (n.rejoin) return choiceAt(n.rejoin, session, graph) ?? graph.nodes[n.rejoin]?.next ?? null;
  return n.next ?? null;
}

/** Every stage id that appears in the graph (route map order). */
export function routeNodeIds(graph = ROUTE_GRAPH) {
  return Object.keys(graph.nodes).sort((a, b) => {
    const la = graph.layout[a], lb = graph.layout[b];
    return la[0] - lb[0] || la[1] - lb[1];
  });
}

/**
 * Route progress for entering `id` directly (URL ?stage=): the path from the
 * start to `id` following `plan` where it has a say, the fork choices made on
 * the way and the 1-based stage number. Null when `id` is not reachable.
 */
export function routeTo(id, plan = [], graph = ROUTE_GRAPH) {
  const path = pathFor([id, ...plan], {}, graph);
  const k = path.indexOf(id);
  if (k < 0) return null;
  const route = path.slice(0, k + 1);
  const choices = {};
  for (let i = 0; i < route.length - 1; i++) {
    const n = graph.nodes[route[i]];
    if (n?.fork) choices[route[i]] = n.fork.some((o) => o.id === route[i + 1]) ? route[i + 1] : choiceAt(route[i], { routePlan: plan }, graph);
  }
  return { route, choices, stageNo: k + 1 };
}

/**
 * Walk the graph from the start with a fixed plan (fork choices / bonus ids)
 * and return the visited path. Used by tests and the route-map preview.
 */
export function pathFor(plan = [], { eoCleared = {} } = {}, graph = ROUTE_GRAPH) {
  const session = { choices: {}, eoCleared, routePlan: plan, route: [] };
  const out = [];
  let id = graph.start;
  let guard = 0;
  while (id && guard++ < 64) {
    out.push(id);
    session.route.push(id);
    if (graph.nodes[id]?.fork) session.choices[id] = choiceAt(id, session, graph);
    id = nextOf(id, session, graph);
  }
  return out;
}
