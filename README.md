# AFTER BURNER CLIMAX — Web Remake (fan project)

A browser remake of SEGA's 2006 arcade jet shooter *After Burner Climax* (and its 2013 Android port),
built with **three.js (WebGL2)**, a heavy post-processing pipeline and fully procedural content, with a
*Top Gun: Maverick*-inspired mood: golden-hour carrier launches, a low-level canyon run under a radar
ceiling, a pop-up strike, high-G pull-outs, dogfights above a sea of clouds at dusk and a trap landing.

> **Unofficial fan project** — not affiliated with or endorsed by SEGA or Paramount. No original assets,
> music, logos or voices are used: every aircraft, ship, effect, sound and music track is generated in code,
> and the terrain textures are CC0 from [Poly Haven](https://polyhaven.com).

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

| Stage | Setting | Highlights |
|---|---|---|
| 1 · BOUNDLESS OCEAN — *Dawn Launch* | Golden-hour Pacific | Catapult launch (cinematic), fighter waves, destroyers & SAM boats, **EO: destroy the heavy bomber**, tanker refuelling |
| 2 · CANYON GRANDEUR — *The Run* | Desert canyon | 22 km canyon under a **radar ceiling** (fly high and SAMs lock on), **EO: XB-70**, 2:30 time-to-target, pop-up & dive strike in slow motion, 9-G pull-out through a SAM volley |
| 3 · SEA OF TWILIGHT — *Final Line* | Above the clouds at sunset | Stealth fighters, an **ace** dogfighter, a strategic bomber boss (destroy all four engines), slow-mo kill-cam, descent through the clouds to a **carrier trap landing** |

Faithful arcade systems:
- **On-rails flight** with a restricted movement box, banking chase camera and **SLOW / NORMAL / FAST** throttle.
  FAST earns flight score and throws off enemy aim; SLOW gives you time but makes you an easier target.
- **Vulcan** (unlimited, optional auto-fire) and **sweep-to-lock missiles**: 50 in stock, refilling at ~2/s.
- **CLIMAX mode**: fill the gauge, then slow time, get a huge lock circle and up to 32 instant locks. When it ends,
  one missile fires at every lock; mash the missile button for up to 2× damage.
- **Barrel roll** breaks incoming missile locks; **flares** decoy them (Maverick-style). "BREAK!" warnings with direction arrows.
- Armor %, combos (+5,000 per 10; +10,000 per 20 after 60), down rate, rank stars (higher rank = tougher enemies),
  Emergency Orders, results with rank letter, local high scores.
- **Aim assist** (Off / Low / High): magnetic reticle, bigger lock circle, bullets bend toward the lead point.

### Controls

| | Keyboard | Gamepad | Touch (Android-style) |
|---|---|---|---|
| Fly | WASD / arrows | Left stick | Drag anywhere on the left 60% |
| Missile | J / Space | A | MISSILE button |
| CLIMAX | K | B / X | CLIMAX button |
| Fast / Slow | Shift / Ctrl | RT / LT | Throttle slider |
| Barrel roll | Q / E or double-tap | LB / RB | Flick the stick |
| Flares | F | Y | FLARE button |
| Pause | Esc / P | Start | ❚❚ |

Mouse flight (cursor = stick, LMB missile, RMB Climax, wheel throttle), tilt steering, invert-Y (arcade default)
and the missile button mode (tap vs. hold-and-release) are in **Options**. The UI is in **English and Thai**.

## Graphics & performance

- WebGL2 `three@0.186.1` + [pmndrs postprocessing](https://github.com/pmndrs/postprocessing) in a half-float HDR pipeline:
  MSAA 4× / SMAA / FXAA, **cascaded shadow maps** (patched for r186), god rays, mip-map bloom, **anamorphic lens flare**,
  camera **motion blur** reconstructed from depth, radial speed blur, chromatic aberration, engine **heat haze**, **AgX**
  tone mapping, per-stage colour grading, G-force greyout / damage / Climax / cloud-whiteout effects, film grain, N8AO on Ultra.
- Physically based **atmosphere** (Rayleigh + Mie + ozone) baked to a cubemap → PMREM image-based lighting, with matching
  height fog / aerial perspective on every material.
- **Gerstner ocean** with detail normals, foam, subsurface tint and ship wakes; lit **cumulus** impostors and a
  **cloud-deck** layer; **streamed canyon terrain** meshed in a Web Worker with triplanar CC0 textures and strata bands.
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

Open `/?bench=1` (or `/?bench=1&quality=ultra`): the autopilot flies stage 1 for 90 s and shows average FPS,
1% lows, frame-time percentiles, draw calls, triangles and shader compiles. Press **F3** (or `` ` ``) in game for a live overlay.

## Development

```bash
npm test                          # vitest: 150+ unit tests (sim, guidance, lock-on, scoring, terrain, audio, models, fx)
node tests/e2e/smoke.mjs [url]    # headless Chromium: plays the end of every stage, checks errors & shader compiles
node tests/e2e/shoot.mjs "<url>" out.png   # screenshot any state
node scripts/fetch-textures.mjs && python3 scripts/compress_textures.py   # re-download CC0 textures
```

Useful URL flags: `?stage=1..3`, `?quality=low|medium|high|ultra`, `?skipintro=1`, `?warp=SECONDS` (fast-forward the
simulation), `?autopilot=1`, `?god=1`, `?climax=1`, `?jet=f14d|fa18e|f15e`, `?scheme=standard|camo|special|lowvis`,
`?lang=th`, `?debug=1`, `?mute=1`. Dev labs: `/labs/model-lab.html`, `/labs/fx-lab.html`, `/labs/audio-lab.html`.

```
src/core      loop (fixed step), clock (Climax time scale), quality/dynamic resolution, save, bench
src/input     keyboard, mouse, gamepad, touch (floating stick), tilt, autopilot
src/sim       rail, player flight model, enemies & behaviours, missiles (PN guidance), weapons, lock-on, Climax, scoring, director
src/world     atmosphere/sky, ocean, clouds, cloud deck, carrier, canyon terrain (worker)
src/render    renderer, post chain & custom effects, shadows, instanced renderers, FX library
src/models    procedural aircraft/vehicle builder + liveries
src/audio     WebAudio synth engine, SFX bank, music sequencer & songs
src/stages    stage data (timelines) + per-stage logic
src/states    title, hangar, briefing, stage, results, ending
src/ui        HUD (Canvas2D), menus, options, EN/TH strings
```

## Credits

- Terrain textures: *Rock Face*, *Worn Rock Natural 01*, *Gravelly Sand* — CC0, [Poly Haven](https://polyhaven.com) (see `public/textures/CREDITS.md`).
- Fonts: Orbitron, Rajdhani, Noto Sans Thai (SIL OFL, Google Fonts).
- Libraries: three.js (MIT), postprocessing (Zlib), N8AO (CC0), Vite, Vitest.
- Inspired by SEGA AM2's *After Burner Climax* (2006). This project is a non-commercial tribute.
