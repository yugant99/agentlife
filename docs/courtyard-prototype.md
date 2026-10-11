# Mythic City prototype (plans 001 + 002 Lane B)

A standalone, synthetic-simulation prototype: an ambitious, inhabited harbor city under a
black-hole sky, with three viewing scales, moving city life, and walking workers. It
implements `plans/001-living-cosmic-city.md` and Lane B of `plans/002-living-agents.md`
(walking workers and readability; branch `codex/city-walking`).

> **Simulation only.** Every value shown is authored fixture data. There is no telemetry
> hook, no `fetch`, no server call, and no live agent. The HUD carries a
> `Simulation · today` source marker and the disclosure "Synthetic scenario — no agents
> are running." The **Live** source button is present but inert until Lane A merges.

The prior courtyard and the cancelled "restore the village" attempt are both superseded.
Internal file/export names (`CourtyardScene.tsx`, `CourtyardHud.tsx`, `CourtyardCharacter.tsx`,
`CourtyardScene`/`CourtyardHud`) are retained from the earlier slice purely to avoid churn;
the rendered product is **Mythic City**.

The frozen contract is `src/components/prototype/agentModel.ts` (lead-owned; Lane B only
reads it). The scene, HUD and roster take `CityAgent[]`; the simulation scenario is one
producer of `CityAgent` snapshots via `scenarioBridge.ts`.

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
- **Buildings**: the deterministic lattice yields 80 composed buildings (down from 88: the
  three new work-spot carves exclude 8 cells; counted with `BUILDINGS.length`), instanced as three archetype layers
  (podium / main / upper) with solid roof caps and spires, plus sparse instanced emissive
  facade windows grouped per district. No per-building textures. Background buildings
  receive shadows but do not cast (one shadow-casting key light only).
- **Work spots**: every district staffs at least one ring of 6 slots. The three original
  plazas stay where they are (Forge Plaza, Planning Plaza, Signal Court); the Citadel
  steps, the Observatory dish terrace and the Port quay are new, with the smallest carve
  (10 units) that keeps the agent-focus camera corridor clear, plus minimal dressing
  (steps/banners, terrace telescope, quay crates).
- **Infrastructure**: a street grid, a diagonal canal with two bridges, a southwest harbor
  with quay walls and piers, lit boulevards with instanced lamps, and an elevated rail loop.
- **Landmarks**: stepped citadel with a lit crown ring; foundry with chimneys, smoke and two
  turning cranes; archive rotunda with a column ring; observatory dome with a turning dish;
  gateway arch with a glowing portal.
- **Sky**: the original `BlackHoleBackdrop` is restored above the skyline. It is an original
  stylized shader approximation, **not** actual ray tracing, and it is decorative: it reads
  no agent state. It is sized and positioned explicitly for the city through **optional**
  props (`size`, `brightness`, `direction`) whose defaults reproduce the original rendering
  exactly, so the main app is unchanged.

## Walking workers (Lane B)

- **Road graph** (`cityGraph.ts`, pure + unit-tested): nodes are walkable street
  intersections plus one connector per work spot and the Gateway arch. No node or edge
  passes through water, the canal (except within 5.5 units of a bridge deck), the citadel
  core or the authored landmarks. Shortest path is a small Dijkstra (no library); every
  spot is reachable from the Gateway.
- **Movement** (pure planner in `movement.ts` + one frame loop in `Workers.tsx`): workers
  walk polylines at constant speed with a leg/arm walk cycle, heading on the tangent. Trip
  time clamps into 4–10 s by scaling speed (brisk walk → jog). Hysteresis: the target
  district is the dominant tool kind over 60 s, and a worker leaves a spot only after
  dwelling 20 s, so nobody ping-pongs. Gestures follow the live phase/toolKind
  immediately (hammer, scroll, telescope, crate, banner, hand-on-chin, glow pulse).
  Pause freezes walkers; reduced motion snaps them to their destination. No React state
  per frame (state ticks only on membership changes and walk start/stop flips).
- **Lifecycle** (`lifecycle.ts`, pure): new roots walk in through the Gateway arch;
  sub-agents appear beside their parent at 0.8× scale with a light tether while both are
  fresh; historical agents walk back out the Gateway and fade over ~8 s; stale agents sit
  (seated pose) and desaturate. At most 24 workers render (needs-input, then fresh, then
  stale); the roster lists everyone else, with historical agents under Past.
- **Readability**: workers stand ~2.2× the old size. Each has a ground status ring in five
  semantic colors (accent = selected, info = thinking/talking, success = active tool,
  warning = needs-input, muted = stale). Needs-input carries a tall amber beam visible
  from city view (slow pulse; static under reduced motion). District window glow follows
  the fresh-active count, eased over ~1.5 s. A one-shot boat departs the Port on a ship
  event. The black hole does not reflect activity (see known gaps).

## Three viewing scales

1. **City** — the whole connected composition, skyline and black hole. District labels show
   meaningful names and actual assigned-worker counts; clicking a label focuses it.
2. **District** — the camera moves into a neighborhood work plaza. Unassigned districts are
   reachable and clearly state "No workers assigned".
3. **Agent** — the inspector, a readable figure and its task-specific gesture.

Controls: **City**, **Districts** (compact navigator), **Needs you**, **Roster**, plus
**Pause/Play**, **Step**, **Replay**, and the **Live / Simulation · today** source switch
(Live inert until Lane A). `Escape` backs out one useful level (agent → its district →
city) and never leaves a stuck inspector. District and City return controls are present
in the inspector.

**Camera**: 650 ms for the city/district journey, 420 ms for agent focus, smoothstep eased,
retargeting from the current position when interrupted. Orbit is never reset by unrelated
HUD updates. Reduced motion snaps directly.

## Motion

- One articulated 3-car tram loops the elevated rail in ~35 s, oriented to the tangent.
- Three boats follow canal/harbor routes (46–62 s), plus the one-shot ship boat from the
  Port quay (~9 s sail). Sparse street couriers follow road segments with deterministic
  phases.
- Observatory dish rotates over ~24 s; foundry crane jibs turn slowly; chimney steam rises.
- Work gestures happen only for fresh workers at a spot; stale workers sit, unknown
  workers rest, paused workers hold. Completion is a bounded one-shot that does not replay
  on render.
- All motion uses a local clock that advances only while the scenario is running, so
  **Pause freezes traffic, walkers and ambient scenery** and resumes from where it stopped;
  hidden-tab deltas are skipped and resumption deltas clamped. Reduced motion keeps
  traffic static and poses legible. No per-frame React state.

## Source semantics

- `source` is always `'simulation'` (asserted by the focused tests).
- `provider` is a synthetic **example** attribution only; no model IDs are shown. Contract
  ids are provider-scoped (`provider:native`).
- `workState`, `freshness`, `phase` and `toolKind` stay separate; staleness is never a work
  state. Historical agents are not rendered in the city; the roster lists them under Past.
- The scenario script covers: an arrival at the Gateway, tool changes that cause walks, a
  sub-agent spawning beside its parent, needs-input waiting on the Citadel steps, stale
  sitting down, historical walking out, and a ship event. Celebrations fire only on a real
  transition into `complete` and are keyed by id, so they cannot replay; ship boats fire
  once per agent for the same reason.

## Files (Lane B owns `src/components/prototype/**` except `agentModel.ts`, plus entry/docs)

- `prototype.html`, `src/prototype-main.tsx` — entry and view/scenario state; the scenario
  is bridged to `CityAgent[]` (memoized on scenario steps so selection never rebuilds
  worker identity).
- `src/components/prototype/city.ts` — deterministic city layout (districts, buildings,
  streets, water, bridges, piers, rail, motion routes) plus work spots and carves.
- `src/components/prototype/cityGraph.ts` + `cityGraph.test.mjs` — pure road graph.
- `src/components/prototype/movement.ts` + `movement.test.mjs` — pure planner (trip clamp,
  hysteresis, slots, render cap, gestures, rings).
- `src/components/prototype/lifecycle.ts` + `lifecycle.test.mjs` — pure lifecycle rules.
- `src/components/prototype/scenario.ts` + `scenario.test.mjs` — deterministic scenario
  (extended script, still clock-free).
- `src/components/prototype/scenarioBridge.ts` + `scenarioBridge.test.mjs` — the
  simulation producer of `CityAgent` snapshots, counts and status copy.
- `src/components/prototype/CourtyardScene.tsx` — canvas, lights, sky, city, stations,
  workers, traffic, camera rig, stats (file name retained).
- `src/components/prototype/Workers.tsx` — walker reconciler + frame loop, rings, beams,
  tethers, fades (new).
- `src/components/prototype/CourtyardHud.tsx` — HUD with City/Districts/Needs you/Roster,
  source switch, district navigator, inspector, roster with Past, stats (file name
  retained). Scene labels sit below HUD layers (`z-index: 10` on the HUD, single-digit
  drei `zIndexRange` in the scene).
- `src/components/prototype/CourtyardCharacter.tsx` — the worker figure: walk cycle,
  seated pose, gesture-driven props, desaturation (rewritten for `CityAgent`).
- `src/components/BlackHoleBackdrop.tsx` — NOT Lane B owned; unchanged.
- `src/components/prototype/prototype.css` — scoped `proto-` styles; narrow-width
  inspector is a bottom sheet of at most 40% height.

## Checks to run (lead: the Lane B environment exposed no shell, so nothing below has
been executed here — run from the repository root before review)

- `npx tsc -b` — must exit 0.
- `node --experimental-strip-types --test src/components/prototype/*.test.mjs` — all
  suites (scenario, bridge, graph, movement, lifecycle) must pass.
- Optional: one `npx vite build` of `prototype.html` into a temp outDir, then delete it.

## Known gaps / unverified

- **No typecheck, tests or builds were executed by the Lane B builder**: this environment
  provided file tools only (no shell, no git). All edits were verified by re-reading;
  the lead must run the checks above and make the 4–7 commits.
- **No browser run by the implementer.** Worker scale/stride, ring/beam legibility from
  city view, tether visibility, district glow strength, the one-shot boat path, new-spot
  dressing, mobile bottom-sheet bounds, pause/reduced-motion freezing, and frame behavior
  were not observed here; the lead will review and measure. The opt-in `?debug=1` panel
  reports draw calls, triangles and mean frame interval.
- **Building count is hand-derived, not executed**: the three new carves exclude 8
  previously built cells (87 − 8 = 80). Re-derivation from the layout code also suggests
  the pre-Lane-B count was 88, not the 87 the old docs claimed — off by one somewhere in
  the old claim or in this hand count. Verify with `BUILDINGS.length` in a console and
  correct the docs.
- **Black-hole activity scaling is NOT implemented**: the plan asks for rotation speed to
  scale gently with the active count, but `BlackHoleBackdrop.tsx` is outside Lane B
  ownership. Proposed lead-approved patch (3 lines): add an optional `rate = 1` prop and
  advance `time.current += Math.min(delta, 0.06) * rate`; the scene then passes
  `rate={1 + Math.min(1, activeCount / 10) * 0.5}`. The docs must keep saying the sky is
  decorative either way.
- **Prototype production bundle is not built here**; the default `vite build` only has
  `index.html` as input. `tsc -b` does type-check every prototype file.
- The "ray traced blackhole" phrasing is not literally true: the sky is a stylized shader
  approximation. This was kept honest rather than renamed to a ray tracer.
- Traffic routes are authored approximations over the grid; the walking-worker graph is
  footprint-checked, but ambient tram/boat/courier routes are not collision-checked
  against every building corner.
- Worker slot targets snap discretely for the agent-focus camera (no per-frame React
  state); a focused walking worker may drift from the camera target mid-walk.
- Leaving workers are capped at 6 rendered departures; historical agents beyond the cap
  vanish from the city immediately but stay listed under Past.
