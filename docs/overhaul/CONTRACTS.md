# Overhaul v2 — module contracts

This is the single source of truth for the parallel overhaul work (see the approved
plan: vivid arcade look, original-style gameplay, routes, radio voice). Every
workstream owns a disjoint set of files (§1). Build against the interfaces below.
If you need something from a file you don't own, **don't edit it**: write the
request under "Needs from others" in your final report. The integrator (INT) merges
the branches in this order: LOOK → FLIGHT → ENEMY → FX → HUD → WORLD → RADIO → STAGES,
and then does a final tuning pass.

Reference material (read-only), in the session scratchpad:
- `…/scratchpad/ref/*.jpg`: HD screenshots and thumbnails of the original.
- `…/scratchpad/vid/sb0_*.jpg`: 5×5 storyboards, one frame every ~10 s of a full playthrough.
- `…/scratchpad/vid/picks.jpg`: enlarged key frames (route select, Climax burst, stages).

## 0. The feel we are matching (After Burner Climax)

**Colour and framing**
- Each stage is 50–65 s long and has one dominant, saturated hue on a bright, high-key image. The sun is a hot white disc with bloom.
- The jet is large, in the lower centre of the screen. The camera stays close and rolls hard with the bank (the horizon tilts 25–30° in turns).
- The world swings under the jet.

**Aiming and locking**
- The reticle is a tiny bracket with a "+", about 3% of screen height.
- Passing the reticle over an enemy locks it.
- Each missile press fires one missile at the oldest lock that has no missile yet. That target then shows a red ✕ and is never fired at again while missiles are en route.

**Enemies and threats**
- About 1.2–1.6 enemies per second: head-on, overtaking close from behind, crossing, swarms, and rammers.
- Enemy missiles curve across the screen trailing thick white smoke, then come at you.
- Barrel roll or hard jinks dodge them.
- Explosions are big fireballs with black smoke, shake and boom.

**Climax**
- Needs a full gauge. Hold the button to sustain it; time slows to ×0.25.
- The lock circle becomes huge and locks are unlimited.
- On release, or when the gauge runs out, every lock fires at once. Activation shows a burst of cyan rings.

**Structure**
- A route map with forks. At the end of a fork stage you steer left or right between big arrows to choose.
- Status reports appear between stages.
- Radio chatter plays the whole time.

## 1. Ownership

| Stream | Owns (create/modify) |
|---|---|
| INT | `src/states/stageState.js`, `src/game.js` (except LOOK's resize/dynres/renderWorld code), `src/main.js`, `src/core/params.js`, `src/core/events.js`, `src/ui/i18n.js`, `package.json`, `README.md`, `docs/overhaul/*` |
| LOOK | `src/world/looks.js`, `src/game.js` (only resize/dynres/renderWorld code), `src/render/composer.js`, `src/render/effects/*`, `src/render/renderer.js`, `src/world/{sky,atmosphere,ocean,clouds,cloudDeck,world}.js`, `src/render/{enemyRenderer,missileRenderer}.js`, `src/states/stage/postBridge.js`, `src/core/quality.js`, `src/core/loop.js`, `src/core/lumaProbe.js` (new), `tests/e2e/{flicker,vivid}.mjs` (new), `tests/unit/look.test.js` (new) |
| FLIGHT | `src/sim/{player,lockon,weapons,climax,scoring,reticle}.js`, `src/render/cameraRig.js`, `src/render/playerJet.js`, `src/input/*`, `src/models/aircraftBuilder.js` (only `PLAYER_JETS` metadata), `src/states/stage/combat.js`, `src/ui/screens/options.js`, `tests/unit/{flight,lock,climax}.test.js` (new) |
| ENEMY | `src/sim/{enemies,enemyTypes,director,waves,missiles,enemyGuns}.js`, `src/states/stage/enemyOps.js`, `tests/unit/{waves,missiles}.test.js` (new) |
| FX | `src/render/fx/*`, `src/render/fxStub.js`, `src/audio/sfxBank.js`, `src/states/stage/fxHooks.js`, `tests/unit/fx.test.js` |
| WORLD | `src/world/terrain/*`, `src/stages/common/terrainRun.js` (baseline stub exists), `public/textures/*`, `scripts/fetch-textures.mjs`, `tests/unit/terrain.test.js`, `dev/terrain.*` (new dev page, not built) |
| STAGES | `src/stages/**` (except `common/terrainRun.js`), `src/states/{flow,panelState,titleState,hangarState,showcase}.js`, `src/ui/strings/stages_{en,th}.js`, `tests/unit/routes.test.js` (new), `tests/e2e/routes.mjs` (new), `tests/e2e/smoke.mjs`, `src/stages/radioLines.json` (new) |
| HUD | `src/ui/hud.js`, `src/ui/hud/*` (new), `src/ui/routeMap.js` (new), `src/ui/ui.css`, `src/ui/menu.js`, `src/ui/strings/{en,th}.js`, `public/fonts/*` (new), `index.html`, `src/states/stage/hudBridge.js`, `dev/hud.*` (new dev page, not built) |
| RADIO | `src/audio/radio.js`, `src/audio/audio.js` (radio/voice section + a `playVoice` API), `src/audio/voice/*` (new), `scripts/voices/*` (new), `public/audio/voice/*` (new), `tests/unit/radio.test.js` (new) |

- `tests/unit/sim.test.js` is shared: FLIGHT may edit only the player/lockon/climax/weapons/scoring cases, ENEMY only the enemies/missiles/director cases (keep edits hunk-local so merges are clean).
- Tests you don't own may be *read*.
- If a change you make breaks another stream's existing unit test, note it in your report; don't edit that test.
- Don't edit `package.json`. List any scripts or dependencies you need in your report.

## 2. Stage runtime (`StageState`, INT)

`stage` below means the running `StageState` instance.
- **Sim objects:** `stage.player`, `stage.rail`, `stage.enemies`, `stage.missiles`, `stage.vulcan`, `stage.enemyGuns`, `stage.lockon`, `stage.stock`, `stage.climax`, `stage.scoring`, `stage.director`.
- **Presentation and scene:** `stage.fx`, `stage.jet`, `stage.clouds`, `stage.stageLogic`.
- **Modules:** `stage.combat` (FLIGHT), `stage.enemyOps` (ENEMY), `stage.fxHooks` (FX), `stage.hudBridge` (HUD), `stage.postBridge` (LOOK), `stage.radio` (RADIO).
- `stage.events` is an `Events` bus (`on(type, fn) → off`, `emit`). Payload objects may be reused, so copy anything you keep.
- `stage.schedule(delay, fn)` runs `fn` after `delay` sim seconds; it pauses and slows with the game.
- `stage.playerHit(amountPercent, kind, pos)`: `kind` is one of `'gun' | 'missile' | 'collision' | 'terrain' | 'flak'`.
- `stage.difficulty`: `{ missile, gun, collision, terrain }`, percentages from `DAMAGE[settings.difficulty]`.
- `stage.hudExtra`: a free-form object that stage components write for the HUD:
  - `routeSelect`: `{left: {id, name}, right: {id, name}, side: -1|0|1, t: 0..1 progress, commit: -1|0|1}`, or null.
  - `caution`: `'CAUTION' | 'PULL UP' | null`.
  - Anything else must be agreed with HUD.
- `stage.autopilotHint`: `{ x, y }`, rail-space targets (m) or `null`. Components set it every step: terrain gives a safe corridor x; route select gives the chosen side. The autopilot steers toward it when it isn't null.
- `stage.routeChoice`: the stage id chosen at a fork, set by the routeSelect component. It is copied into `results.route`.
- **Update order, per 120 Hz sim step (`dt` real, `wdt` world):**
  1. timers
  2. `logic.preUpdate`
  3. `combat.preUpdate` (climax toggle, roll, flares)
  4. `player.update`
  5. `director.update`
  6. `enemies.update`
  7. `logic.update`
  8. `combat.update` (lock-on, missile fire, salvo, stock, vulcan)
  9. `missiles.update`
  10. `enemyGuns.update`
  11. `enemyOps.update` (collisions, near miss)
  12. `combat.postUpdate` (climax gauge/timer, real dt)
  13. scoring, death, finish
- **Render order, per frame:**
  1. jet, enemy and missile renderers
  2. `fxHooks.render(alpha)` (trails, tracers)
  3. `logic.render`
  4. `rig.update` (unless `logic.cameraOverride`)
  5. `world.update`, clouds
  6. `combat.updateReticle(realDt)`
  7. `enemyOps.updateThreat(realDt)`
  8. `postBridge.update(realDt)`
  9. `radio.update(realDt)`
  10. `fx.update`
  11. `game.renderWorld`
  12. `hudBridge.update(realDt)`
- **Precompile:** every material, light and mesh that can appear in a stage must exist before `StageState._precompile()`, which calls `renderer.compileAsync`. That includes `fxHooks.warmup()` and anything created in `logic.init()`. The e2e smoke test fails if a new shader program appears mid-stage.

### 2.1 Events (`stage.events`)

| type | payload | emitted by |
|---|---|---|
| `stageStart` | `{def}` | StageState after loading |
| `stageEnd` | results object | StageState `_finish` |
| `stageExit` | `{}` | StageState `exit` |
| `kill` | `{e, src, mode, res:{base, bonus}}` | enemy hook (score already applied) |
| `explode` | `{e, kind, dist}` | enemy hook |
| `escape` | `{e}` | enemy hook |
| `missileLaunch` | the missile object `m` (`m.owner`: `'player'` or an enemy id; `m.strong`) | missile hook |
| `missileEnd` | `{m, reason}` (`'hit'`, `'timeout'`, `'ground'`, `'water'`, `'decoy'`, `'lost'`) | missile hook |
| `playerHit` | `{kind, amount, pos}` | StageState `playerHit` |
| `playerDown` / `respawn` | `{}` | StageState |
| `lock` | `{n}` (new locks this step) | combat |
| `fox` | `{locked: bool}` (player missile fired by button) | combat |
| `climax` | `{phase: 'ready' \| 'start' \| 'end', salvo?: n}` | combat (FLIGHT emits `'ready'` when the gauge becomes full) |
| `evade` | `{n}` (enemy missiles defeated by a roll) | combat / ENEMY missiles |
| `nearMiss` | `{e, d}` | enemyOps (ENEMY) |
| `caution` | `{kind: 'terrain' \| 'pullup', on: bool}` | terrainRun (WORLD) |
| `eo` | `{kind: 'start' \| 'cleared' \| 'failed', eo}` | StageState |
| `routeSelect` | `{phase: 'open' \| 'commit', side, left, right}` | routeSelect component (STAGES) |
| `combo` | `{n, bonus}` when a combo bonus is paid | scoring glue (FLIGHT, via combat or hooks) |

Radio and HUD react to these. Add new event types only by documenting them here in your report.

### 2.2 Stage logic / components (STAGES; WORLD for terrain)

`def.createLogic(stage)` returns an object with these optional members:
- **Lifecycle:** `init()` (async), `preUpdate(dt, wdt)`, `update(dt, wdt)`, `render(alpha, realDt)`, `dispose()`.
- **Hooks:** `cue(name, ev)`, `onKill(e)`, `groundAt(s, x) → world y`.
- **Flags:** `lockControls`, `cameraOverride`, `handlesMusic`, `skipIntroMessage`.
- **HUD:** `hud: {hideCombat, hideGauges, timer}`, `radarWarning`.
- **Other:** `whiteout` (0..1).

STAGES provides `src/stages/common/compose.js`, which merges several components into one logic object: hooks are called in order, and flags are OR-ed. It also provides components for:
- carrier launch and refuel
- radar ceiling and strike run
- cloud deck, boss fortress and carrier landing
- route select

WORLD provides `src/stages/common/terrainRun.js`:

```js
export class TerrainRun {            // a component (same member names as above)
  constructor(stage, terrainDef)     // terrainDef = def.terrain (see §6)
  async init()                       // builds streamer + obstacles, primes chunks around player
  preUpdate(dt, wdt)                 // streaming, stage.autopilotHint.x from safeX()
  update(dt, wdt)                    // collisions (scrape / head-on) → stage.playerHit(…, 'terrain'), caution
  groundAt(s, x) → world y           // terrain height under a rail-space point (for limits/ground units)
  query(s, x, y) → clearance m       // signed distance to nearest terrain/obstacle surface (autopilot, caution)
  safeX(s, y) → x                    // lateral offset of the free corridor (centre(s) & obstacle gaps)
  dispose()
}
export function terrainRun(terrainDef) → (stage) => new TerrainRun(stage, terrainDef)   // factory for compose()
```

## 3. Player and flight (FLIGHT)

- **Movement box**
  - `player.box = {x, y}`: half extents in metres around the rail (±x lateral, `boxCenterY ± y` vertical).
  - It comes from `def.rail.box`; `def.rail.boxCenterY` defaults to 0.
  - The vertical floor is `limits.minY`, computed from the ground or sea plus `rail.minAltitude`.
- **Stage-def targets.** Ocean and sky stages use `box {x: 240, y: 100}`, terrain stages `{x: 200, y: 80}`. Terrain walls are enforced by terrainRun collisions, not by box clamping.
- **Barrel roll.** `player.noRoll` is set from `def.rail.noRoll`. When true, rolling is disabled and the input becomes a quick jink.
- **Speeds and roll feel**
  - `player.lateralSpeed ≈ 150`, `player.verticalSpeed ≈ 100` (FLIGHT tunes).
  - `player.evadeWindow > 0` means the player is in a barrel roll's missile-evade window. Enemy missiles read it.
- **G-load.** `player.gLoad` must stay a sane display value (≤ 9 from stick input). Screen greyout reads only `player.gOverride` (0..1, scripted, default 0).
- **Pose.** `player.throttle` ∈ {-1, 0, 1}; also `player.speed`, `player.baseSpeed`, `player.bank`, `player.forward`, `player.velocity`, `player.pos`, `player.s`, `player.x`, `player.y`, `player.vx`, `player.vy`.
- **Camera.** `rig.update(player, rail, alpha, realDt, {climax})`. FLIGHT tunes the framing (§0).

## 4. Lock-on, weapons, Climax, scoring (FLIGHT)

**Per-enemy fields** (written by LockOn, read by the HUD):

| Field | Meaning |
|---|---|
| `e.lockNeed` | missiles needed to kill: `min(4, ceil(hpLeft / missileDamage))` |
| `e.locks` | pending locks (missile not fired yet) |
| `e.incoming` | player missiles in flight at `e` (already maintained by `MissileSystem.launch`/drop) |
| `e.xMark` | true when `incoming > 0 && locks + incoming ≥ lockNeed`; the HUD draws a red ✕ above the target |
| `e.onScreen`, `e.sx`, `e.sy`, `e.dist`, `e.screenD` | screen projection, as today |
| `e.lockRange` | lock range for this target this step (m): `ENEMY_TYPES[type].lockRange`, else air 1600 / big and ground 2400, ×1.5 during Climax |
| `e.inLockRange` | `minRange (80) ≤ dist ≤ lockRange`. Only these can be locked or taken as the assist target; the HUD draws candidate marks only for them |

**LockOn**

| Member | Meaning |
|---|---|
| `lockon.reticle` | `{x, y}`, NDC centre of the drawn reticle |
| `lockon.reticleSize` | fraction of screen height for the drawn bracket, ≈ 0.032 |
| `lockon.radius` | current hidden catch radius (half-height units); Climax ≈ 0.45 |
| `lockon.max` | lock capacity (per jet, `PLAYER_JETS[id].lockCap`) |
| `lockon.climaxMax` | 64 |
| `lockon.locks` / `lockon.lockIds` | pending lock entries (`{e}` list plus id guard) |
| `lockon.newLocks` | locks acquired this step |
| `lockon.assistTarget` | vulcan / assist target (in lock range only) |
| `lockon.maxRange` / `lockon.minRange` | hard caps around the per-type range; a lock is dropped beyond 1.2× the range it was taken at |
| `lockon.consume()` | oldest valid pending lock → e (moves one from `locks` to about-to-fire) or null |
| `lockon.snapshot(out)` / `lockon.reset()` | as today |

**MissileStock:** `stock.ready` (integer ready missiles, the HUD icon row), `stock.max` (8), `stock.reload` (0..1 progress of the next missile), `stock.take()`, `stock.update(wdt)`, `stock.infinite`.

**Climax**

| Member | Meaning |
|---|---|
| `climax.gauge` | 0..1 |
| `climax.ready` | gauge full and not active |
| `climax.active` | true while active |
| `climax.phase` | `'idle' \| 'ready' \| 'active' \| 'salvo' \| 'afterburn'` |
| `climax.timeScale` | 0.25 |
| `climax.damageMul` | ≤ 2 |
| `activate()`, `end()`, `update(realDt) → endedThisStep`, `fill(realDt, throttle)`, `onKill(big, throttle)`, `mash()` | methods |

Activation holds: `input.hold.climax` sustains Climax and releasing ends it. With `settings.climaxToggle`, or on touch, a press toggles instead.

**Scoring**
- `scoring.combo`, `scoring.comboTimer`, `scoring.comboWindow` (4 s, frozen during Climax), `scoring.bestCombo`, `scoring.total`, `scoring.stars`, `scoring.shining`.
- `scoring.nearMiss()` adds +500; `scoring.climaxClear(n)` pays the all-down bonus.
- Kills return `{base, bonus}`.

## 5. Enemies, waves, missiles (ENEMY)

- **Type metadata.** `ENEMY_TYPES[type]` adds `visScale` (render scale for readability; fighter 1.8, stealth 1.6, helo 1.4, big 1.15, ground 1). LOOK's `EnemyRenderer` multiplies instance scale by `def.visScale ?? 1`. Collisions use `e.radius` (real size × 1.2).
- **Flags for the HUD.** `e.behaviorName`; `e.rammer = true` for kamikaze aircraft (the HUD draws "!" chevrons); `e.tag` (EO / TARGET marker).
- **Waves** (`def.waves`, read by the Director; `src/sim/waves.js`):

```js
waves: {
  seed: 7,
  rate: { base: 1.8, perStar: 0.12 },          // enemies per second
  maxAlive: { high: 24, medium: 20, low: 16 },
  gap: 0.6,                                     // min seconds between pattern starts
  starve: 1.5, floor: 2,                        // < floor on screen for `starve` s → next pattern now
  behind: 0.35,                                 // target share of attackers from behind
  spans: [{ from: 900, to: 13000 }],           // rail metres where waves run
  quiet: [[6200, 7400]],                        // pauses (set pieces)
  mix: [['vHeadOn', 4], ['rammerPair', 2], ['overtakeClose', 2], ['crossSweep', 1], ['swarmPass', 1], ['chaserPair', 1, { minS: 4000 }]],
  types: { light: 'fighterA', heavy: 'stealthB' },
  preloadTypes: []                              // extra types patterns may spawn
}
```

  Timeline event `{ at, waves: 'on' | 'off' | { rate } }` toggles or retunes the waves. ENEMY documents the full pattern list and every option in the header of `waves.js`.
  Patterns include `overheadPass` / `underPass` (from behind, right over or under the canopy), `headOnPass` (head-on pass-by, near-miss bonus), `pincer` and `overtakeStream`.
  The starvation rule counts enemies on screen through the director API's optional `onScreenCount()` (StageState provides it from `e.onScreen`).
- **Timeline events** (unchanged, plus `waves`):
  - Triggers: `{at: metres | {t: sec} | {event: 'killed' | 'escaped', tag, delay}, minRank, maxRank, flag, …}`.
  - Actions: `spawn: {type, formation, behavior, x, y, dist, count, spread, tag, params, hpMul, countable, world, heading, ground}`, `cue`, `radio`, `message`, `eo: {id, title, kind, count, timeLimit, bonus, spawn}`, `eoCheck`, `end`.
- **Behaviours**
  - Existing: `headOn`, `overtake`, `crossing`, `formation`, `chaser`, `strafe`, `bomber`, `hover`, `ace`, `bossBomber`, `attached`, `static`.
  - New: `rammer`, `overtakeClose`, `swarmPass`.
- **Missiles**
  - Object fields: `m.owner` (`'player'` or enemy id), `m.pos`, `m.prevPos`, `m.vel`, `m.t`, `m.dropT`, `m.target`, `m.strong` (red variant), `m.alive`.
  - Enemy missiles use the cinematic model: arc and helix, then terminal homing. A roll during `player.evadeWindow` makes them `'lost'`.
  - They can be shot by the vulcan. ENEMY provides `missiles.shootables(out) → out` (the enemy missiles currently shootable, each with `pos`, `vel`, `radius` ≈ 4, `active`) and `missiles.shootDown(m)` (destroys it; `onEnd` reason `'shot'`). FLIGHT's `Vulcan` tests bullets against them as extra targets.
  - `missiles.threat(pos, vel) → {m, tgo}` for the HUD warning.
  - Enemy missile damage is applied by StageState: `difficulty.missile` (×1.3 if `m.strong`).
- **enemyOps:** `threat` (render-time snapshot `{tgo, sx, sy, behind, strong, warn, urgent}` or null), `warnActive` (the missile warning is on: terminal-phase or close missile, with hysteresis; drives the tone, the HUD MISSILE plate and the post `uWarn`; `urgent` = warn and time-to-go short), `enemyMissile(e)`, `update()` (collisions and near-miss → `events.emit('nearMiss', …)`, `scoring.nearMiss?.()`), `enemyBehind()`.

## 6. Terrain (WORLD) — `def.terrain`

```js
terrain: {
  seed: 21,
  profile: 'canyon' | 'valley' | 'dunes',
  palette: 'desertRed' | 'emerald' | 'glacier' | 'dunes',
  sections: [{ s, floor, depth, width, clearance }],   // as canyonShape today; valley: width = floor half-width, depth = peak height; dunes: depth = dune amplitude
  centre: { keys: [[s, offsetM], …] } | { amp: 90, wavelength: 2200, from: 3000, to: 12000, phase: 0 },   // corridor swing (rail-space x of the corridor centre)
  water: { level: 0, preset: 'glacierRiver' } | null,   // flat water plane in the valley (fjord); uses LOOK's ocean presets
  snowLine: 260,                                         // m above floor; emerald/glacier
  trees: { density: 0.6 } | null,                       // optional instanced pines on valley slopes
  obstacles: [
    { s: 5200, l: 0, kind: 'arch', h: 70, w: 120 },                      // explicit, l relative to corridor centre
    { from: 3000, to: 11000, every: [350, 650], kinds: ['pillar', 'spire'], lat: [-0.9, 0.9] }   // scatter; lat in fractions of the free half-width
  ]
}
```

- Every obstacle layout keeps a free gap of at least 45 m at each s.
- Terrain stages have `rail.noRoll: true`.

## 7. Look (LOOK) — `def.env` additions

**Visual presets live in `src/world/looks.js` (`LOOKS`, owned by LOOK).** Stage defs
(STAGES) compose them and must not hand-tune colour/light values:
`env: { ...LOOKS.canyonRed, clouds: { ...LOOKS.canyonRed.clouds, count: 0.5 } }`.
Look names: `oceanDay, emerald, canyonRed, sunset, glacier, dunes, clouds, fortress,
strike, aurora, title, hangar`. `?look=<name>` (params.look) lets LOOK preview a look on
any stage (applied in `world.configure` by LOOK).

- `env.grade` preset names: `arcadeOcean`, `arcadeEmerald`, `arcadeCanyon`, `arcadeSunset`, `arcadeGlacier`, `arcadeDunes`, `arcadeClouds`, `arcadeFortress`, `arcadeAurora`, `arcadeStrike`. The old names remain.
- `env.ocean` preset names: `arcadeBlue`, `sunsetGold`, `glacierRiver`, `auroraNight` (plus the old `goldSwell`, `twilight`).
- `env.sky`: `{ zenithBoost, saturation, horizonBright, sunDisc }`, optional. LOOK picks good defaults.
- `env.aurora`: 0..1 (night aurora band, bonus stage).
- `env.toneExposure`: around 1.0 now (Neutral tonemapping).
- `env.bloom`: `{ threshold, intensity }`.
- Sun elevation and azimuth: day stages use `elev` 22–40° with `azim` placing the sun ahead of the player.

Additional env fields implemented by LOOK: `sky.{hue, skyHue, horizonHue, knee, sunGlow, iblSaturation}`,
`sunTint`, `bloom.smoothing`, `flareTint`, `hemi`, `shadowIntensity`, `clouds: null` (no cloud banks).
APIs: `post.applyLook(env, renderer)`, `post.resetHistory({sun})`, `world.resolveEnv(env)` (applies `?look=`),
`world.env` (the resolved env of the current stage/screen).

## 8. HUD snapshot (`hudBridge` → `hud.draw(dt, s, scale)`)

`makeHudState()` in `src/states/stage/hudBridge.js` lists every field. The main ones:
- **Reticle and locks:** `reticle {x, y}`, `reticleSize`, `lockRadius`, `lockCap`, `lockCount`, `newLock` (1 → 0 flash), `targets` (enemy list with the lock fields from §4).
- **Climax:** `climax`, `climaxGauge`, `climaxReady`, `climaxPhase`, `climaxOnScreen`.
- **Warnings:** `threat`, `enemyBehind`, `pullUp`, `caution`, `radarWarning`.
- **Score:** `score`, `combo`, `comboTimer`, `comboWindow`, `stars`, `shining`.
- **Status:** `armor`, `lives`, `missiles` (ready), `missilesMax`, `missileReload`, `throttle`, `speed01`, `jetName`.
- **Stage:** `eo`, `timer`, `routeSelect`, `stageNo`, `stageName`.

HUD methods used by others: `hud.message(text, {sub, dur, color, delay, style})`, `hud.popup(x, y, text, color)`, `hud.radio(who, text, dur)`, `hud.eo`.
- The HUD adds `style: 'callout'` for ENGAGE / MISSION COMPLETE banners.
- It adds `hud.radioPanel` behaviour: one line at a time, top-centre.

## 9. Radio (RADIO)

- **Runtime.** `stage.radio.say(key, { priority = 1, ttl })`; priority 0 is most urgent, 3 is idle chatter. It returns false when the line is dropped.
- **Scripted lines.** Timelines keep using `{ radio: 'r.<stage>.<name>' }`.
- **Dynamic chatter.** Listens to §2.1 events: kills, fox, missile launches at the player, hits, near misses, evades, Climax, combo, EO, route select, low armour, stage start and end.
- **Line data**
  - `src/audio/voice/lines.json`, owned by RADIO, holds generic pools: `{ "gen.kill": { "speaker": "wing", "variants": [{ "en": "Splash one!", "th": "…" }, …] }, … }`.
  - STAGES writes stage lines to `src/stages/radioLines.json` in the same format, with keys `r.<stageId>.<name>` and one or more variants.
  - The RADIO generator voices both files. Keep lines short: 1–3 s.
- **Speakers.** `awacs` (controller, female), `lead` (you), `wing` (wingman), `carrier` (boss), `tanker`. All callsigns are original.
- **Voice clips.** `public/audio/voice/<key>.<variant>.mp3` plus `manifest.json`. Missing clips fall back to subtitle and squelch.
- **Subtitles.** `hud.radio(callsignText, lineText)` in the current language.

## 10. Routes and flow (STAGES)

- **Stage ids:** `ocean`, `emerald`, `canyon`, `sunset`, `glacier`, `dunes`, `clouds`, `strike`, `fortress`, and bonus `aurora`.
- **`src/stages/routes.js`** exports:
  - `ROUTE_GRAPH`: `{ nodes: { id: { next?: id, fork?: [{id, side: -1|1}], bonus?: {id, requires}, end?: true } }, layout: { id: [col, row, 'square' | 'sphere'] }, start: 'ocean', statusAfter: [...] }`
  - `nextOf(nodeId, session)`
  - `forkOf(nodeId)`
- **`campaign.js`:** `STAGES` (all defs), `STAGE_BY_ID`, `getStageDef(idOrIndex)` (already there).
- **Session:** `session.route` (visited ids), `session.node`, `session.stageNo`, `session.eoCleared`.
- **Flow:** `toStage(id)`, `toStageDirect(def)` (URL entry, already there), `afterResults(results)` (uses `results.route` at forks), the Status Report, and Continue.
- **URL `?route=a,b,c`** pre-selects fork choices: the autopilot and routeSelect honour it.
- **Screens**
  - "Please Wait" loading panel: jet plus the route map (`src/ui/routeMap.js` from HUD: `renderRouteMap(el, graph, session, {highlight})`).
  - STATUS REPORT and CONTINUE panels.
- **Stage names (original):**
  - ocean: BLUE HORIZON / SORTIE
  - emerald: EMERALD PEAKS / HIGHLANDS
  - canyon: RED CANYON / THE GAUNTLET
  - sunset: SUNSET ARMADA / FLEET ACTION
  - glacier: GLACIER FJORD / COLD STEEL
  - dunes: GOLDEN DUNES / SANDSTORM PURSUIT
  - clouds: SEA OF CLOUDS / ACE HIGH
  - strike: CANYON STRIKE / UNDER THE RADAR
  - fortress: SKY FORTRESS / FINAL LINE
  - aurora: AURORA / SECRET SORTIE
- **Emergency Orders (tags):**
  - emerald: `helos`, 8 of 10 CH-47 (`heloCH47`)
  - canyon: `xb70`, bomber (`bomberXB`)
  - sunset: `b52` (`bomberB52`)
  - glacier: `aa`, destroy 6 AA sites
  - dunes: `cruise`, 3 cruise missiles, gun only
  - clouds: `ace` (`ace`)
  - strike: strike target
  - Bonus `aurora` unlocks when at least 3 EOs are cleared before the end of dunes.

## 11. Testing rules

- **Unit tests:** `npx vitest run` (all must pass; add your own under `tests/unit`).
- **Browser checks.** Run vite on your assigned port, `npx vite --port <PORT> --strictPort`, and use Playwright with SwiftShader:
  - `require('/opt/node22/lib/node_modules/playwright')`
  - `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`
  - args `['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']`
- **Useful URL params:**
  - `?stage=<id|n>&quality=low&autopilot=1&god=1&warp=<sec>&turbo=4&frames=2&skipintro=1`
  - `&t=<sec>` fast-forwards flight only.
- **Screenshots:** see `tests/e2e/shoot.mjs`.
- **CPU is shared** (4 cores, several agents). Keep headless runs short (small viewport, `quality=low`) and don't leave servers running.
