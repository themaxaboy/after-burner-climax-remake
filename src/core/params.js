// URL flags for debugging, deterministic tests and benchmarks.
//   ?stage=1..3  jump straight into a stage      ?seed=N     RNG seed
//   ?fixed=1     fixed 1/60 s real dt per frame  ?frames=N   mark ready after N frames
//   ?t=SECONDS   fast-forward the stage          ?autopilot=1 bot pilot
//   ?quality=low|medium|high|ultra             ?bench=1    benchmark flythrough
//   ?climax=1    force Climax at start           ?debug=1    perf overlay
//   ?jet=f14d|fa18e|f15e  ?scheme=standard|camo|special|lowvis  ?turbo=N sim speed
//   ?mute=1  ?lang=en|th  ?shot=name (camera preset)  ?god=1 invulnerable
//   ?warp=SECONDS  run the full simulation (no rendering) before the first frame
//   ?stage=<id>    stage id also accepted (e.g. ?stage=canyon)
//   ?route=a,b,c   pre-chosen route (stage ids) for forks / autopilot / e2e
//   ?lumaprobe=N   record N frames of mean screen luminance (flicker detector)
function parse(search) {
  const q = new URLSearchParams(search);
  const num = (k, d) => (q.has(k) && q.get(k) !== '' && !Number.isNaN(+q.get(k)) ? +q.get(k) : d);
  const bool = (k) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
  const str = (k, d) => (q.has(k) && q.get(k) !== '' ? q.get(k) : d);
  return {
    stage: q.has('stage') && q.get('stage') !== '' && Number.isNaN(+q.get('stage')) ? q.get('stage') : num('stage', 0),
    route: str('route', '') ? str('route', '').split(',').map((x) => x.trim()).filter(Boolean) : [],
    lumaprobe: num('lumaprobe', 0),
    seed: num('seed', 0),
    fixed: bool('fixed'),
    frames: num('frames', 0),
    t: num('t', 0),
    autopilot: bool('autopilot'),
    quality: str('quality', null),
    bench: bool('bench'),
    benchSeconds: num('bench', 0) > 1 ? num('bench', 0) : 90,
    climax: bool('climax'),
    debug: bool('debug'),
    jet: str('jet', null),
    scheme: str('scheme', null),
    turbo: Math.max(1, Math.min(16, num('turbo', 1))),
    mute: bool('mute'),
    lang: str('lang', null),
    shot: str('shot', null),
    god: bool('god'),
    skipIntro: bool('skipintro'),
    warp: num('warp', 0)
  };
}

export const params = parse(typeof location !== 'undefined' ? location.search : '');
export { parse as parseParams };
