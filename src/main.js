import './ui/ui.css';
import { Game } from './game.js';
import { params } from './core/params.js';
import { getStageDef } from './stages/campaign.js';
import { Flow } from './states/flow.js';

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
  game.flow = new Flow(game);
  if (params.bench && !params.stage) params.stage = 1;
  if (params.bench) params.god = true;
  const direct = getStageDef(params.stage);
  if (direct) {
    // direct stage entry (testing / benchmarks)
    game.flow.toStageDirect(direct);
  } else {
    game.flow.toTitle();
  }
  game.start();
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
