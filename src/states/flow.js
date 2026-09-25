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
