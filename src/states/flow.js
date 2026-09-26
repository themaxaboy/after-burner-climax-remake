import { STAGES, STAGE_BY_ID, getStageDef } from '../stages/campaign.js';
import { ROUTE_GRAPH, forkOf, nextOf, plannedChoice, routeTo } from '../stages/routes.js';
import { TitleState } from './titleState.js';
import { HangarState } from './hangarState.js';
import { StageState } from './stageState.js';
import { ResultsState, StatusReportState, EndingState, showPleaseWait } from './panelState.js';

/**
 * Screen flow along the route graph (docs/overhaul/CONTRACTS.md §10):
 * title → hangar → [Please Wait → stage → results (→ status report)] … → ending.
 * Fork stages end with a route select; the choice arrives as `results.route`.
 *
 * Session: route (visited ids), node (current id), stageNo (1-based count),
 * choices ({forkNode: chosen id}), routePlan (?route=… pre-selected ids),
 * eoCleared, results.
 */
export class Flow {
  constructor(game) {
    this.game = game;
  }

  toTitle() {
    const g = this.game;
    g.session = g.newSession();
    g.setState(new TitleState(g));
  }

  toHangar() {
    // user gesture: go fullscreen + landscape on phones
    if (matchMedia('(pointer: coarse)').matches && !document.fullscreenElement) {
      document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    }
    this.game.setState(new HangarState(this.game));
  }

  _prepSession() {
    const s = this.game.session;
    s.route ||= [];
    s.choices ||= {};
    s.results ||= [];
    s.routePlan = this.game.params.route || [];
    return s;
  }

  /** New run from the start of the route (after the hangar). */
  startCampaign() {
    const s = this._prepSession();
    s.route = [];
    s.choices = {};
    s.stageNo = 1;
    s.node = null;
    s.statusFrom = 0;
    this.toStage(ROUTE_GRAPH.start);
  }

  /**
   * Enter stage `id` on the route. The "Please Wait" panel (jet, route map,
   * stage brief) covers the load unless `loading` is false.
   */
  toStage(id, { loading = true, restart = false } = {}) {
    const g = this.game;
    const def = STAGE_BY_ID[id] || getStageDef(id);
    if (!def) return this.toEnding();
    const s = this._prepSession();
    s.node = def.id;
    s.stageIndex = STAGES.indexOf(def);
    if (!restart && s.route[s.route.length - 1] !== def.id) s.route.push(def.id);
    const stage = new StageState(g, def);
    if (loading) showPleaseWait(g, def, stage);
    g.setState(stage);
  }

  /** Direct entry (URL ?stage=): start that stage with a fresh session placed on the route. */
  toStageDirect(def) {
    const g = this.game;
    const s = this._prepSession();
    const at = routeTo(def.id, s.routePlan);
    s.stageIndex = Math.max(0, STAGES.indexOf(def));
    s.route = at ? at.route : [def.id];
    s.choices = at ? at.choices : {};
    s.stageNo = at ? at.stageNo : def.index || 1;
    s.node = def.id;
    s.statusFrom = 0;
    g.setState(new StageState(g, def));
  }

  restartStage() {
    this.toStage(this.game.session.node || ROUTE_GRAPH.start, { loading: false, restart: true });
  }

  onStageComplete(results) {
    this.game.setState(new ResultsState(this.game, results));
  }

  /** After the results panel: record the fork choice, show a status report if due, go on. */
  afterResults(results) {
    const g = this.game;
    const s = this._prepSession();
    const node = s.node || results?.stage?.id;
    const fork = forkOf(node);
    if (fork) {
      const ids = fork.map((o) => o.id);
      const made = ids.includes(results?.route) ? results.route : plannedChoice(node, s.routePlan) || ids[0];
      s.choices[node] = made;
    }
    const next = nextOf(node, s);
    const go = () => (next ? this._advance(next) : this.toEnding());
    if (ROUTE_GRAPH.statusAfter.includes(node)) {
      const bonus = !!(next && ROUTE_GRAPH.nodes[next]?.bonusStage);
      const env = (STAGE_BY_ID[node] || results.stage).env;
      const midGame = !!next && node === ROUTE_GRAPH.statusAfter[0];
      g.setState(new StatusReportState(g, { results: s.results.slice(), env, bonus, midGame }, go));
    } else go();
  }

  _advance(next) {
    const s = this.game.session;
    s.stageNo = (s.stageNo || 1) + 1;
    this.toStage(next);
  }

  toEnding() {
    const g = this.game;
    const last = STAGE_BY_ID[g.session.node] || STAGES[STAGES.length - 1];
    g.setState(new EndingState(g, last.env));
  }
}
