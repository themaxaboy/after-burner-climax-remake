import { STAGES } from '../stages/campaign.js';
import { TitleState } from './titleState.js';
import { HangarState } from './hangarState.js';
import { StageState } from './stageState.js';
import { BriefingState, ResultsState, EndingState } from './panelState.js';

/** Screen flow: title → hangar → briefing → stage → results → … → ending. */
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

  toBriefing(i) {
    const g = this.game;
    g.session.stageIndex = i;
    g.setState(new BriefingState(g, i, STAGES[i]));
  }

  toStage(i) {
    const g = this.game;
    g.session.stageIndex = i;
    g.setState(new StageState(g, STAGES[i]));
  }

  /** Direct entry (URL ?stage=): start that stage with a fresh session. */
  toStageDirect(def) {
    const g = this.game;
    const i = STAGES.indexOf(def);
    g.session.stageIndex = Math.max(0, i);
    g.session.stageNo = def.index || i + 1;
    g.session.node = def.id;
    g.session.route = [def.id];
    g.setState(new StageState(g, def));
  }

  restartStage() {
    this.toStage(this.game.session.stageIndex);
  }

  onStageComplete(results) {
    this.game.setState(new ResultsState(this.game, results));
  }

  afterResults() {
    const i = this.game.session.stageIndex + 1;
    if (STAGES[i]) this.toBriefing(i);
    else this.toEnding();
  }

  toEnding() {
    this.game.setState(new EndingState(this.game, STAGES[STAGES.length - 1].env));
  }
}
