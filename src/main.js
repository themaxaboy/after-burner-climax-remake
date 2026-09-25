import './ui/ui.css';
import { Game } from './game.js';
import { params } from './core/params.js';
import { StageState } from './states/stageState.js';
import { STAGES } from './stages/campaign.js';

async function boot() {
  const game = new Game({
    canvas: document.getElementById('gl'),
    hud: document.getElementById('hud'),
    ui: document.getElementById('ui')
  });
  try {
    await game.init();
  } catch (e) {
    showFatal(e);
    return;
  }
  const stageIndex = params.stage || 1;
  game.setState(new StageState(game, STAGES[stageIndex - 1]));
  game.start();
  document.getElementById('boot')?.classList.add('hidden');
}

function showFatal(e) {
  console.error(e);
  const el = document.getElementById('boot');
  if (el) {
    el.classList.remove('hidden');
    el.querySelector('.boot-status').textContent = 'WebGL2 is required. ' + (e && e.message ? e.message : e);
  }
}

boot();
