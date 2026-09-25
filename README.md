# AFTER BURNER CLIMAX — Web Remake (fan project)

A browser remake of SEGA's 2006 arcade jet shooter *After Burner Climax* (and its mobile ports),
built with **three.js (WebGL2)**, a heavy post-processing pipeline and fully procedural content, with a
*Top Gun: Maverick*-inspired mood: a vivid arcade look with one dominant colour per stage, relentless enemy
waves, swirling missiles, a branching route of ten one-minute stages, terrain you have to thread and constant
voiced radio chatter.

> **Unofficial fan project** — not affiliated with or endorsed by SEGA or Paramount. No original assets,
> music, logos or voices are used: every aircraft, ship, effect, sound and music track is generated in code,
> radio voices are synthesised offline with the open Kokoro TTS model, and the terrain textures are CC0 from
> [Poly Haven](https://polyhaven.com).

## Play

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/ (static, deployable anywhere)
npm run preview    # serve the production build on :4173
```

GitHub Pages: the workflow in `.github/workflows/pages.yml` tests, builds and deploys on every push to
`main`. Enable it once under **Settings → Pages → Source: GitHub Actions**.

## The game

Short (~1 minute) stages on a **branching route**, as in the arcade original. At the end of a fork stage the
screen offers two routes — steer **left or right** between the big arrows to choose. Clear enough Emergency
Orders and a secret bonus stage opens up.

```
OCEAN ─ EMERALD ─ CANYON ─┬─ SUNSET ──┬─ DUNES ─(◯ AURORA)─┬─ CLOUDS ─┬─ FORTRESS
                          └─ GLACIER ─┘                     └─ STRIKE ─┘
```

| Stage | Setting | Highlights |
|---|---|---|
| BLUE HORIZON | Deep-blue ocean, white cumulus | Catapult launch from the carrier, fighter waves, rammers |
| EMERALD PEAKS | Green valley, snow caps, pines | Snaking valley, **EO: down 8 of 10 transport helicopters** |
| RED CANYON | Red rock canyon under a low sun | Corridor swings, rock pillars and arches, **EO: XB-70**, route select |
| SUNSET ARMADA | Orange sunset sea | Fleet action, **EO: B-52**, tanker refuelling |
| GLACIER FJORD | Turquoise fjord, snowy walls | Low-level through the fjord, **EO: 6 AA sites on the banks** |
| GOLDEN DUNES | Bright yellow desert, cyan sky | Pursuit from behind, **EO: 3 cruise missiles (gun only)**, route select |
| AURORA (bonus) | Night sea under an aurora | Dense swarms that don't shoot back |
| SEA OF CLOUDS | Golden twilight above the clouds | **EO: the ace** |
| CANYON STRIKE | Canyon under a radar ceiling | Low-level run against the clock, pop-up strike in slow motion, 9-G pull-out |
| SKY FORTRESS | Twilight final battle | Flying fortress with four engine pods, kill-cam, carrier trap landing |

Faithful arcade systems:
- **Wide on-rails flight**: the jet sweeps across a large box (±240 m) while a close chase camera rolls hard with
  the bank. **SLOW / NORMAL / FAST** throttle.
- **Tiny reticle, sweep-to-lock**: pass the reticle over enemies to lock them. Each missile press fires **one**
  missile at the oldest lock; targets with a missile on the way get a red **✕** and are never fired at twice.
  Tough targets take several locks. 8 ready missiles, refilling constantly; hold the button to ripple-fire
  (AUTO MISSILE option). Vulcan (auto-fire by default) also shoots down enemy missiles.
- **CLIMAX**: fill the gauge, then **hold** the Climax button — cyan burst, time slows to ¼, the lock area covers
  most of the screen, locks are unlimited and missiles infinite; mash missile for up to 2× damage. Release (or run
  dry) and every lock is fired at once. Destroy them all for a bonus.
- **Relentless enemies**: 1–2 per second — head-on formations, jets overtaking close past the canopy, crossing
  sweeps, swarms, chasers on your six and **rammers** that dive straight at you (dodge them for a near-miss bonus).
- **Cinematic enemy missiles** swirl across the screen trailing thick white smoke before homing in; a well-timed
  **barrel roll** (or a hard jink in walled terrain) makes them miss. Red "strong" missiles home harder.
- **Terrain that forces dodging**: canyons, valleys, fjords and dunes whose corridor snakes left and right, with
  pillars, spires, arches and bridges. Scrapes cost a little armour, head-on hits a lot; CAUTION / PULL UP warn you.
- Armor %, combos (+5,000 per 10), near misses, rank stars, Emergency Orders, **status reports** graded AAA–C,
  a **route map** on the loading screen, local high scores.
- **Radio chatter**: ~185 voiced lines (AWACS, wingman, lead, carrier, tanker) through a radio filter with
  subtitles in English or Thai, reacting to kills, threats, Climax, combos, EOs and route choices.

### Controls

| | Keyboard | Gamepad | Touch (mobile-style) |
|---|---|---|---|
| Fly | WASD / arrows | Left stick | Drag anywhere on the left 60% |
| Missile (hold = ripple) | J / Space | A | MISSILE button |
| CLIMAX (hold) | K / X | B / X | CLIMAX button (tap on / tap off) |
| Fast / Slow | Shift / Ctrl | RT / LT | Throttle slider |
| Barrel roll | Q / E, double-tap or snap the stick | LB / RB or stick snap | Flick the stick |
| Flares | F | Y | FLARE button |
| Pause | Esc / P | Start | ❚❚ |

Mouse flight (cursor = stick, LMB missile, RMB Climax, wheel throttle), tilt steering, invert-Y, auto missile,
Climax hold/toggle and aim assist are in **Options**. The UI and radio subtitles are in **English and Thai**.

## Graphics & performance

- WebGL2 `three@0.186.1` + [pmndrs postprocessing](https://github.com/pmndrs/postprocessing) in a half-float HDR pipeline:
  MSAA 4× / SMAA / FXAA, **cascaded shadow maps** (patched for r186), god rays, mip-map bloom, **anamorphic lens flare**,
  camera **motion blur** reconstructed from depth, radial speed blur, chromatic aberration, engine **heat haze**,
  **Neutral** tone mapping with vibrance and per-stage hue-focused grading (the bright, saturated arcade look),
  damage / missile-warning / Climax burst / cloud-whiteout effects, film grain, N8AO on Ultra.
- Flicker-safe pipeline: NaN/negative guard at the head of the post chain, eased screen effects, resolution
  changes applied before drawing, smoothed sun occlusion; `tests/e2e/flicker.mjs` measures frame-to-frame luminance.
- Physically based **atmosphere** (Rayleigh + Mie + ozone) with an arcade stylisation pass (deep zenith blue, bright
  horizon, hot sun disc, optional aurora) baked to a cubemap → PMREM image-based lighting, with matching height fog.
- **Gerstner ocean** with detail normals, foam, subsurface tint and ship wakes; lit **cumulus** impostors and a
  **cloud-deck** layer; **streamed terrain** (canyon / valley / fjord / dunes profiles with a snaking corridor, snow line,
  pines and rock obstacles) meshed in a Web Worker with triplanar CC0 textures.
- **Procedural aircraft** (F-14D with swing wings, F/A-18E, F-15E + enemies, bombers, tanker, helicopter, ships)
  with shader liveries (4 paint schemes), decals, animated control surfaces and landing gear; **GPU particles**
  (explosions, smoke, debris, trails, tracers, afterburners with Mach diamonds, vapor cones).
- 60 fps+ strategy: fixed 120 Hz simulation with interpolated rendering (uncapped for 120/144 Hz displays),
  **dynamic resolution**, four quality presets with GPU auto-detection, instancing, zero-allocation hot loops,
  all shaders precompiled while loading (the smoke test verifies nothing compiles mid-stage).

| Preset | AA | Shadows | Extras |
|---|---|---|---|
| Low (phones) | FXAA | — | lens flare, bloom |
| Medium | SMAA | 2 cascades | + camera FX |
| High | MSAA 4× | 3 cascades | + motion blur, god rays, heat haze |
| Ultra | MSAA 4× + SMAA | 4 cascades | + N8AO |

### Benchmark on your hardware

Open `/?bench=1` (or `/?bench=1&quality=ultra`): the autopilot flies stage 1 for 50 s and shows average FPS,
1% lows, frame-time percentiles, draw calls, triangles and shader compiles. Press **F3** (or `` ` ``) in game for a live overlay.

## Development

```bash
npm test                                   # vitest: 360+ unit tests
node tests/e2e/smoke.mjs [url] [--strict]  # plays the end of every stage: errors, results, no mid-stage shader compiles
node tests/e2e/routes.mjs [url] [A|B]      # plays both route paths through the forks (and the bonus) to the ending
node tests/e2e/flicker.mjs [url]           # frame-to-frame luminance dips (dark-flicker detector)
node tests/e2e/vivid.mjs [url]             # colour saturation / brightness / dominant hue per stage
node tests/e2e/shoot.mjs "<url>" out.png   # screenshot any state
python3 scripts/voices/generate.py --setup && python3 scripts/voices/generate.py   # (re)voice radio lines (incremental)
node scripts/fetch-textures.mjs && python3 scripts/compress_textures.py            # re-download CC0 textures
```

Useful URL flags: `?stage=<1..10|id>` (e.g. `?stage=canyon`), `?route=glacier,aurora,strike` (pre-chosen forks),
`?quality=low|medium|high|ultra`, `?skipintro=1`, `?warp=SECONDS` (fast-forward the simulation), `?autopilot=1`,
`?god=1`, `?climax=1`, `?jet=f14d|fa18e|f15e`, `?scheme=standard|camo|special|lowvis`, `?look=<name>` (preview a
visual look), `?waves=1`, `?lumaprobe=N`, `?lang=th`, `?debug=1`, `?mute=1`. Dev pages: `/dev/hud.html`,
`/dev/terrain.html`, `/labs/model-lab.html`, `/labs/fx-lab.html`, `/labs/audio-lab.html`.
Module contracts between the subsystems are documented in `docs/overhaul/CONTRACTS.md`.

```
src/core      loop (fixed step), clock (Climax time scale), quality/dynamic resolution, luma probe, save, bench
src/input     keyboard, mouse, gamepad, touch (floating stick), tilt, autopilot
src/sim       rail, flight model, enemies & behaviours, wave generator, missiles (cinematic + PN), weapons,
              lock-on, reticle, Climax, scoring, director
src/world     atmosphere/sky, looks (visual presets), ocean, clouds, cloud deck, carrier, terrain (profiles, obstacles, worker)
src/render    renderer, post chain & custom effects, shadows, instanced renderers, FX library
src/models    procedural aircraft/vehicle builder + liveries
src/audio     WebAudio engine, SFX bank, music, radio director + voice clips
src/stages    route graph, stage defs, reusable stage components (launch, refuel, route select, strike, boss, landing…)
src/states    title, hangar, stage (+ combat / enemy ops / FX hooks / HUD & post bridges), panels, flow
src/ui        HUD modules (Canvas2D), route map, menus, options, EN/TH strings
```

## Credits

- Terrain textures: *Rock Face*, *Worn Rock Natural 01*, *Gravelly Sand*, *Aerial Grass Rock*, *Snow Field Aerial*,
  *Aerial Sand* — CC0, [Poly Haven](https://polyhaven.com) (see `public/textures/CREDITS.md`).
- Fonts (bundled): Orbitron, Rajdhani, Noto Sans Thai — SIL OFL 1.1 (see `public/fonts/CREDITS.md`).
- Radio voices: synthesised with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) via kokoro-onnx;
  all lines are original.
- Libraries: three.js (MIT), postprocessing (Zlib), N8AO (CC0), Vite, Vitest.
- Inspired by SEGA AM2's *After Burner Climax* (2006). This project is a non-commercial tribute.
