# Mythic City prototype (plan 001)

A standalone, synthetic-simulation prototype: an ambitious, inhabited harbor city under a
black-hole sky, with three viewing scales and moving city life. It is the implementation of
`plans/001-living-cosmic-city.md`.

> **Simulation only.** Every value shown is authored fixture data. There is no telemetry
> hook, no `fetch`, no server call, and no live agent. The HUD carries a permanent
> `SIMULATION` pill and the disclosure "Synthetic scenario — no agents are running."

The prior courtyard and the cancelled "restore the village" attempt are both superseded.
Internal file/export names (`CourtyardScene.tsx`, `CourtyardHud.tsx`, `CourtyardCharacter.tsx`,
`CourtyardScene`/`CourtyardHud`) are retained from the earlier slice purely to avoid churn;
the rendered product is **Mythic City**.

## How to view

- Dev: start the normal dev server (`npm run web`) and open `/prototype.html`.
  Vite serves that standalone HTML entry, which loads `/src/prototype-main.tsx`.
- Renderer stats are opt-in: add `?debug=1` (desktop only; hidden on mobile).
- If WebGL cannot start, a plain fallback message is shown and the roster/inspector stay
  usable because they are HTML, not canvas.

## The city

A dense, connected composition built from shared/instanced primitives, no external assets:

- **Six neighborhoods** on a 10-unit lattice (citadel, foundry, archive, observatory, port,
  gateway) so streets are always clear — composed, not random cuboids.
- **Buildings**: a deterministic 10-unit lattice yields 87 composed buildings, instanced as
  three archetype layers (podium / main / upper) with solid roof caps and spires, plus sparse
  instanced emissive facade windows. No per-building textures. Background buildings receive
  shadows but do not cast (one shadow-casting key light only).
- **Infrastructure**: a street grid, a diagonal canal with two bridges, a southwest harbor
  with quay walls and piers, lit boulevards with instanced lamps, and an elevated rail loop.
- **Landmarks**: stepped citadel with a lit crown ring; foundry with chimneys, smoke and two
  turning cranes; archive rotunda with a column ring; observatory dome with a turning dish;
  gateway arch with a glowing portal.
- **Sky**: the original `BlackHoleBackdrop` is restored above the skyline. It is an original
  stylized shader approximation, **not** actual ray tracing. It is sized and positioned
  explicitly for the city through new **optional** props (`size`, `brightness`, `direction`)
  whose defaults reproduce the original rendering exactly, so the main app is unchanged.

## Three viewing scales

1. **City** — the whole connected composition, skyline and black hole. District labels show
   meaningful names and actual assigned-worker counts; clicking a label focuses it.
2. **District** — the camera moves into a neighborhood work plaza. Unassigned districts are
   reachable and clearly state "No workers assigned".
3. **Agent** — the inspector, a readable figure and its task-specific gesture.

Controls: **City**, **Districts** (compact navigator), **Needs you**, **Roster**, plus
**Pause/Play**, **Step**, **Replay**. `Escape` backs out one useful level (agent → its
district → city) and never leaves a stuck inspector. District and City return controls are
present in the inspector.

**Camera**: 650 ms for the city/district journey, 420 ms for agent focus, smoothstep eased,
retargeting from the current position when interrupted. Orbit is never reset by unrelated
HUD updates. Reduced motion snaps directly.

## Motion

- One articulated 3-car tram loops the elevated rail in ~35 s, oriented to the tangent.
- Three boats follow canal/harbor routes (46–62 s). Sparse street couriers follow road
  segments with deterministic phases.
- Observatory dish rotates over ~24 s; foundry crane jibs turn slowly; chimney steam rises.
- Active work gestures happen only for fresh active workers; unknown/stale/paused workers do
  not simulate work. Completion is a bounded one-shot that does not replay on render.
- All motion uses a local clock that advances only while the scenario is running, so
  **Pause freezes traffic and ambient scenery** and resumes from where it stopped; hidden-tab
  deltas are skipped and resumption deltas clamped. Reduced motion keeps traffic static and
  poses legible. No per-frame React state.

## Source semantics (unchanged)

- `source` is always `'simulation'` (asserted by the focused test).
- `provider` is a synthetic **example** attribution only; no model IDs are shown.
- `workState` and `freshness` stay separate; staleness is never a work state. Only a fresh,
  active worker performs a work gesture; unknown never works. Celebrations fire only on a real
  transition into `complete` and are keyed by id, so they cannot replay.

## Files

- `prototype.html`, `src/prototype-main.tsx` — entry and view/scenario state.
- `src/components/prototype/city.ts` — deterministic city layout (districts, buildings,
  streets, water, bridges, piers, rail, motion routes).
- `src/components/prototype/CourtyardScene.tsx` — canvas, lights, sky, city, stations,
  characters, traffic, camera rig, stats (file name retained).
- `src/components/prototype/CourtyardHud.tsx` — HUD with City/Districts/Needs you/Roster,
  district navigator, inspector, roster, stats (file name retained).
- `src/components/prototype/CourtyardCharacter.tsx` — the five workers (unchanged).
- `src/components/prototype/scenario.ts` + `scenario.test.mjs` — deterministic scenario.
- `src/components/BlackHoleBackdrop.tsx` — optional, backward-compatible size/position props.
- `src/components/prototype/prototype.css` — scoped `proto-` styles.

## Checks actually run

All run from the repository root after the final edits; all passed.

- `npm run build` — `tsc -b && vite build`. Exit 0. Note the main-app JS bundle hash changed
  (`dist/assets/index-Cdpa9hJA.js`) because `BlackHoleBackdrop` gained optional props; with
  default props its rendering is identical, so main-app behavior is unchanged.
- `node --experimental-strip-types --test src/components/prototype/*.test.mjs` — 7/7 pass.
- `npm run test:telemetry` — 2/2 pass.

## Known gaps / unverified

- **No browser run by the implementer.** City density, the black hole's placement/size, the
  three camera scales, labels, mobile panel bounds, pause/reduced-motion freezing, and
  frame behavior were not observed here; the lead will review and measure. The opt-in
  `?debug=1` panel reports draw calls, triangles and mean frame interval.
- **Prototype production bundle is not built here**; the default `vite build` only has
  `index.html` as input. `tsc -b` does type-check every prototype file.
- The "ray traced blackhole" phrasing is not literally true: the sky is a stylized shader
  approximation. This was kept honest rather than renamed to a ray tracer.
- Traffic routes are authored approximations over the grid; they follow streets/canals but
  are not collision-checked against every building corner.
- Building count (87) is read from the deterministic layout data; no frame rate is claimed.
