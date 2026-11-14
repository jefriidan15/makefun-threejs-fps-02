# MERIDIAN FOUNDRY — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/jefriidan15/makefun-threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/jefriidan15/makefun-threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical first-person shooter in the style Counter-Strike made
famous — with its own map, art, sounds and names. Built for the make.fun
`threejs-fps-02` bounty. Single-player against bots, desktop browser, three.js
0.187.0 (vendored), static files, no build step, no network request.

## What changed in v2

- **Look:** brighter dusk lighting (warm furnace sun vs cool blue fill, lit
  window strips, a low sun disc on the horizon), a textured furnace mouth
  (glowing coals behind grate bars), painted yard signs (MERIDIAN FOUNDRY /
  CRANE BAY), more props (pipe runs, barrels, floor lane markings), smaller
  site plates. The v1 screenshots came out muddy and the furnace read as a
  flat orange slab.
- **Gunplay on screen:** slimmer view-model guns with real iron sights
  (front post + rear ring) and a canvas starburst muzzle flash; tracers are
  now visible additive beams instead of 1 px lines; impact sparks are bigger
  with a glow sprite at the hit.
- **Bots with roles:** NYX flanks wide, DAGGER holds an angle, HAVOC rushes
  mid (ROOK holds, VEX flanks) — different reaction times, aim, speed and
  routes per role, with a name tag above each bot's head. Bot-vs-bot fire
  starts only on first contact (your shot, a hit on you, or 8 s in), so both
  squads are at full strength when the fight starts.
- **Objective UI:** while an Azure bot defuses, a red progress bar shows
  "AZURE IS DEFUSING THE CHARGE — STOP THEM" — the plant/defuse objective
  now reads for both teams. The "carrying the charge" tag no longer shows
  after the match ends.

## The game

**MERIDIAN FOUNDRY** is an industrial yard at dusk: a furnace hall (Site A)
in the north-west, a crane bay (Site B) in the south-east, three lanes of
shipping containers, crates, silos and pipes between them. Two teams of
three — **EMBER** (you, Rook and Vex) against **AZURE** (Nyx, Dagger and
Havoc). First to five rounds takes the match.

- **Rounds:** 100 seconds. Win by eliminating the Azure squad, by planting
  the charge at Furnace or Crane Bay and defending it until it detonates, or
  by the clock when nothing is planted. Azure wins the round by defusing a
  planted charge, by eliminating Ember, or on time.
- **The charge:** you carry it. Hold **E** inside a site ring for 3 seconds
  to plant; the fuse runs 35 seconds and an Azure bot will come to defuse it
  (5 second channel — stop them).
- **Money:** start with $800. Round win $3,250, loss $1,900, every
  elimination $300. Spend it in the buy phase between rounds.
- **Arsenal:** P9 Sidewinder pistol (free), Raptor-12 SMG ($1,200),
  Longshot-7 rifle ($2,500), Deadeye-50 sniper ($4,000), Spark-9 flash
  grenade ($200, press G). Headshots deal 2.5× damage.
- **Gunplay:** hitscan with recoil and spread that punish firing on the
  move — stopping to aim pays. Sprint, crouch, jump; collision with the map;
  tracers, muzzle flash, impact sparks.
- **Bots:** real AI — they patrol the lanes on a waypoint graph, hold site
  positions, engage on line of sight with reaction time and aim error, strafe
  and take cover, retake a planted site, and defuse. They hear your shots and
  come looking.
- **HUD:** health, ammunition, credits, round timer, round score, squad
  strength, kill feed, minimap, crosshair with spread, hitmarker, plant
  progress, buy menu.
- **Sound:** everything is synthesized live with WebAudio — gunshots, reloads,
  hits, plant beeps, the explosion, round jingles. No audio files.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click to lock) |
| Click | Fire |
| R | Reload |
| Shift | Sprint |
| Ctrl / C | Crouch |
| Space | Jump |
| E | Plant the charge (hold, inside a site) |
| G | Throw Spark-9 flash grenade |
| B | Buy menu (buy phase) |

## Run it

```sh
node serve.ts   # serves game/ on http://localhost:8080
```

Open http://localhost:8080 in desktop Chrome (WebGL 2). No install, no
build. The entry program `main.ts` (Node 22) copies `game/` and
`screenshots/` to `/output` and writes `/output/dossier.json`.

## Screenshots

`?shot=start|play|plant|end&seed=1` renders a deterministic capture frame
(buy phase, mid-round combat, planting at Furnace, match scoreboard) and sets
`window.__shotReady` when it is ready to screenshot. `?shot=demo` plays one
round unattended through the real code — deploy, plant at Furnace, fuse to
detonation — and reports the result in `window.__demo`.

## License

MIT — see LICENSE. three.js 0.187.0 is vendored under game/vendor/three with
its own LICENSE.

---

<sub>Entered on [make.fun](https://make.fun/?ref=s7vdxe79&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
