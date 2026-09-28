# Command Courtyard prototype

A standalone, synthetic-simulation prototype that replaces the tiny-workers-on-a-huge-map
scene with a compact, playable command courtyard. It is **not** wired into the main app:
`index.html` / `src/main.tsx` / `src/App.tsx` / `WorldScene.tsx` are untouched, and the
default `npm run build` output is byte-identical to before this work.

> **Simulation only.** Every value shown is authored fixture data. There is no telemetry
> hook, no `fetch`, no server call, and no live agent. The HUD carries a permanent
> `SIMULATION` pill and the disclosure "Synthetic scenario — no agents are running."

## How to view

- Dev: start the normal dev server (`npm run web`) and open `/prototype.html`.
  Vite serves that standalone HTML entry, which loads `/src/prototype-main.tsx`.
- It is a separate HTML entry, not a query parameter or a route inside the main app.
- If WebGL cannot start, a plain fallback message is shown and the roster/inspector remain
  usable because they are HTML, not canvas.

## What works

**Scene (world-first).** A ~18-unit stone platform in blue-hour twilight: charcoal stone,
dark timber, moss, teal cloth, and warm golden practicals. Ground is layered (platform base,
top surface, stone edging, deliberate paths, moss and rock scatter) rather than empty flat
ground. Three stations with distinct silhouettes:

- **Forge** — stone forge with an emissive hearth, chimney, anvil on a stump, barrel, and a
  localized warm point light plus a small animated flame cluster.
- **Planning Table** — a large timber table with a parchment survey map, loose map pieces,
  a scroll, two stools, and a warm lantern.
- **Signal Post** — a tall mast with a crossbeam, a swaying banner/pennant, crates, and a
  warm brazier.

Enclosure comes from a timber hall silhouette (two halls with posts, gable ends, a door and
lit windows) and six pines placed on a broad dusk terrain that extends well past the
platform, so the frame is filled with ground and depth instead of empty space. The sky is
an original static `DuskSky` (cool zenith, warm horizon, one small soft moon and a few dim
stars, no time uniform) — the old black-hole backdrop is no longer imported here. Repeated
ground detail is instanced: flagstone pavers, cobble paths, edging stones, moss, grass tufts
and outer rocks.

**Characters.** Five chunky ~1.9-unit figures with visible heads, eyes, hands, boots,
optional beards, optional cloaks, three headwear kinds, and five distinct cloth
accents/props (hammer, tongs, scroll, ledger, banner). Work gestures differ by station:
hammer at the forge, read a scroll at the table, hold a flag at the signal post. Idle
figures breathe/sway. Stale, unknown, waiting and completed figures never perform a work
gesture — they hold a neutral idle.

**Camera.** A tilted near-isometric overview frames the whole courtyard; selecting an agent
travels the camera in ~420 ms and frames that figure. Framing is computed from the live
canvas size and the camera FOV: the overview targets ~90 CSS px agent height at 1440×900
and focus targets ~152 px. The courtyard is framed tightly on the stations (peripheral rocks
may fall outside the frame) while the broad outer terrain fills the background, so smaller
screens re-frame from the same math without cropping a worker. `OrbitControls` allows
moderate orbit around the focus target; the rig only drives the camera while travelling and
leaves orbit alone otherwise. `Esc`, the inspector close, its "Back" button and **Overview**
all do the same thing: clear the selection and return cleanly to the overview with no
lingering panel. Station name plaques are shown in overview and hidden in focus (the
inspector carries the station then), so they never clip at a side edge or overlap the
inspector.

**HUD.** Dark, low-chrome overlay: "MYTHIC / Command Courtyard" identity, the persistent
`SIMULATION` pill and disclosure, small counts for Working / Needs you / Complete, and a
**Needs you** button that cycles eligible (fresh, needs-input) agents. A collapsible roster
lists all five with a status icon, station and explicit status; it supports `Arrow`/`Home`/
`End` keyboard navigation and shows focus outlines. The inspector (name, role, source,
station, task, explicit status, last scenario event) sits independently of the roster so it
is never pushed below a long list. In-world markers show name/status on hover, on selection,
and always for a needs-you agent.

## Scenario controls

- **Play / Pause** — advances the deterministic timeline one step per ~5.2 s, or freezes it.
  Pause also freezes scenario-linked character work and celebrations (ambient scenery such as
  the forge flame and banner keeps moving).
- **Step** — advances exactly one scenario step manually (disabled at the end).
- **Replay** — resets to the deterministic start and resumes playing.
- **Overview** — returns the camera to the overview.

Timeline (initial cast: 2 active, 1 needs-input, 1 unknown, 1 completed):

| Step | Event |
| --- | --- |
| 0 | Scenario started — five agents checked in. |
| 1 | Astrid received the human call and raised the banner. (needs-input → active) |
| 2 | Astrid paused the run — a second decision is needed. (active → needs-input) |
| 3 | Astrid resumed after the call was made. (needs-input → active) |
| 4 | Astrid completed the banner run. (**celebration**) |
| 5 | Eirik checked in and asks for a schema call. (unknown → needs-input) |
| 6 | Eirik received the call and started forging. (needs-input → active) |
| 7 | Eirik's snapshot went stale — work is paused, not counted. |
| 8 | Eirik's snapshot recovered and work resumed. |
| 9 | Sigrid completed the planning pass. (**celebration**) |

The table covers the required arc: an `active → needs-input → complete` cycle, one agent
going stale and recovering, and exactly one completion transition per completed agent.

## Source semantics

Source, work state and freshness are three separate fields and are never collapsed into one
"status":

- `source` — always `'simulation'`. Asserted by the focused test; there is no live record.
- `provider` — a synthetic **example** attribution only (`codex | opencode | claude-code |
  manual`), shown as "Example provider". No model identifiers are shown anywhere.
- `workState` — `active | needs-input | unknown | complete | waiting`.
- `freshness` — `fresh | stale`.

Consequences enforced by pure helpers in `scenario.ts`:

- `canPerformWork(agent)` is true only when `freshness === 'fresh' && workState === 'active'`.
  A stale snapshot never performs a work gesture; unknown never works.
- Stale is a **freshness**, not a work state: a stale agent still reports its last work state
  in the inspector ("Stale snapshot · last active") but drops out of the working count.
- Counts keep the split: working requires fresh+active, needs-you requires fresh+needs-input,
  complete requires fresh+complete.
- Celebrations are emitted only by a real transition into `complete`, never for the baseline
  completed agent. Applying the same step again cannot re-emit (the agent is already
  complete), and the scene plays a celebration by celebration **id** exactly once, so
  re-renders, late frames and reloads cannot retrigger it.

## Reduced motion

`prefers-reduced-motion` is read on initial load and on change. Under it: no camera travel
(instant snap), no scene loops (a still, legible stance per state), still flames/banner, and
CSS animations/transitions are disabled. No per-frame React state is used anywhere; the
renderer-stats panel writes DOM text on a slow interval from a shared mutable sink.

## Renderer details panel

Opt-in and desktop-only. Add `?debug=1` to the URL to render it; it is hidden entirely on
mobile. Draw calls, triangle count, mean frame interval, and canvas size are sampled a few
times per second from the live renderer. No frame-rate figure is claimed; only the measured
mean interval between rendered frames is shown.

## Files

- `prototype.html` — standalone Vite HTML entry.
- `src/prototype-main.tsx` — state owner (scenario, selection, camera revision, reduced
  motion) and composition.
- `src/components/prototype/scenario.ts` — deterministic fixture + pure reducer/selectors.
- `src/components/prototype/CourtyardScene.tsx` — canvas, lights, ground, stations, camera
  rig, stats reporter.
- `src/components/prototype/CourtyardCharacter.tsx` — character mesh and pose/gesture logic.
- `src/components/prototype/CourtyardHud.tsx` — overlay HUD (identity, counts, controls,
  inspector, roster, stats).
- `src/components/prototype/prototype.css` — scoped `proto-` styles (reuses the bundled
  Chillax font).
- `src/components/prototype/scenario.test.mjs` — focused `node:test` for the pure helpers.

## Checks actually run

All run from the repository root; all passed.

- `npm run build` — `tsc -b && vite build`. Exit 0. The emitted `dist/index.html` and bundle
  hashes are unchanged from before this work, confirming the prototype is not part of the
  default app bundle.
- `npm run test:telemetry` — 2/2 pass.
- `node --experimental-strip-types --test src/components/prototype/*.test.mjs` — 7/7 pass:
  initial diversity, stale disables work, unknown cannot work, completion fires once and
  never replays, replay resets deterministically, needs-you cycles in stable order, finished
  scenario does not advance.

## Second pass (post-review) changes

Applied after the first browser review, all within the same file scope:

- Removed the reused black-hole backdrop from the prototype entirely; added an original
  static `DuskSky` (small soft moon, few dim stars, no luminous ring, no time uniform).
- Strengthened lighting: warmer key from the camera side, higher ambient/hemisphere fill,
  lighter slate/moss ground and materials so agents and ground read instead of going black.
- Closer framing and larger apparent agents (~90 px overview, ~152 px focus at 1440×900),
  with a broad outer terrain so the courtyard no longer floats in empty space.
- Workers now stand on the camera side of their props and are turned 3/4 toward the view;
  heads/hands are slightly larger with shoulder cloth and a nose for face readability.
- Crafted ground: instanced flagstone pavers, cobbled paths, edging, moss and grass tufts,
  firewood stack, workbench, bench and foreground rocks.
- Stronger station silhouettes: forge hearth/hood/workbench/firewood, a larger planning
  table with candles and raised map, and a taller signal mast with cloth banner; the hall
  gained posts, gable ends, a door and lit windows.
- Station labels: overview-only, ground-anchored inside the courtyard (no edge clipping, no
  inspector overlap).
- Narrow layout: heading + disclosure + counts + controls stack at the top, the inspector
  becomes a bounded bottom sheet, the roster is a bottom bar, debug stats are hidden on
  mobile, and there is no horizontal overflow. The close/Back/Esc/Overview actions were
  unified so the inspector never lingers.
- Performance info is now opt-in (`?debug=1`) and desktop-only, labelled honestly as a mean
  frame interval.
- Provenance fixed: every fixture agent is `source === 'simulation'` (asserted by a test);
  the provider field is renamed to an example attribution and no model IDs are shown.
- Pause now freezes a local animation clock instead of deleting pending celebrations, so a
  celebration in flight resumes; reduced motion still settles to a still pose without
  playing. No per-frame React state.
- WebGL precheck, a minimal error boundary and a ready timeout guarantee the "Preparing"
  overlay clears and the HTML controls stay usable.
- **Ground surface corrected to y = 0.** Both platform cylinders were lowered by .36 so the
  courtyard walking surface is exactly y = 0; the outer terrain was moved below the platform
  base (y = -0.4) so it never cuts the platform; and every on-surface item (pavers, moss,
  edging, paths, characters, stations, grass, outer rocks, trees, halls, foreground rocks)
  was re-seated coherently. Previously the cap top sat at y = .36, burying all ground detail
  and the characters' feet. The moss scale also had a constant expression
  (`((i*5)%5) === 0`); it now varies deterministically as `0.4 + (i % 4) * 0.12`.
- **Scoped border-box reset** for `.proto-app` and all descendants/pseudo-elements, so
  percentage widths include padding and borders. This keeps the counts row and the inspector
  (including its close control) inside the viewport on narrow screens; DOM `scrollWidth`
  alone had not caught the hidden overflow.

## Known gaps / unverified

- **Prototype production bundle is not verified here.** The default `vite build` only has
  `index.html` as an input, so `prototype.html` is not bundled by `npm run build`. A separate
  prototype build check (e.g. adding `prototype.html` as a Rollup input) is left to the lead.
  Type-checking of every prototype file *is* covered by `tsc -b`.
- **No browser run performed by the implementer.** Camera framing, agent pixel heights,
  shadow quality, draw-call count and celebration timing are implemented to the stated
  targets but were not observed in a browser here. The opt-in renderer panel exists so the
  lead can read the real numbers during review.
- **Stress configuration is explicitly not implemented or measured** in this slice (no
  20-agent scenario), so multi-agent fill performance is unverified.
- The forge/planning/signal practical lights are three point lights with no shadows; contact
  grounding relies on the single shadow-casting directional key.
- Orbit is intentionally bounded (`minPolarAngle 0.3`, `maxPolarAngle 1.35`, no pan). There
  is no separate "reset view" control beyond **Overview**.
