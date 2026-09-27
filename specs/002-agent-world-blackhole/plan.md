# Implementation Plan: Agent Village and Black Hole Backdrop

**Branch**: `codex/agent-world-blackhole-plan` | **Date**: 2026-09-27 | **Spec**: `specs/002-agent-world-blackhole/spec.md`

**Input**: Feature specification from `specs/002-agent-world-blackhole/spec.md`. Planning artifacts only — no implementation authorized.

**Implementation update (2026-09-27):** The user subsequently authorized both slices and end-to-end checks. The scene changes are integrated in the standalone command center through commit `82a128c`. `npm run build` and `npm run test:telemetry` passed. Browser review covered default and 842px layouts, live and simulation views, worker selection, orbit drag, reduced-motion CSS, and `?sky=off`; the final visible live view paced at a 16.7ms median and 17.4ms p95 over 120 animation frames on this machine. The no-WebGL context-creation fallback and forced stale-snapshot branch were not exercised. Planning-only language below records the original plan and is superseded by this update.

## Summary

Keep the existing Viking village read-only command center and add a subordinate, decorative Interstellar-inspired black hole (dark center, luminous tilted disk, bent-light look) in its sky. Reuse the current React Three Fiber / Three.js canvas and telemetry wiring. Render the visual illusion on one shader surface behind the village, freeze it for reduced motion, and provide static fallbacks. The first slice also grades fog and lighting enough to keep workers readable. The GPU cost is a design risk to measure later, not a performance claim.

## Technical Context

**Language/Version**: TypeScript 5.9, React 19.2, Vite 7

**Primary Dependencies**: `@react-three/fiber ^9.4.0`, `@react-three/drei ^10.7.6`, `three ^0.180.0`, `@phosphor-icons/react` (existing only — no new dependency in slice one)

**Storage**: N/A (no persistence; scene-only visual state derived at render)

**Testing**: No tests/builds/smoke/browser checks run or authorized this pass per constitution VI; `quickstart.md` scenarios are UNRUN manual checks for later

**Target Platform**: Local desktop browser with WebGL; fully offline once installed (loopback telemetry, locally bundled map/decoder/font)

**Project Type**: Single-project local web app

**Performance Goals**: Preserve the capped DPR `[1,1.65]`, avoid extra passes/shadows and per-frame allocations, and keep orbit/selection responsive with dozens of workers. Exact frame-time/device claims require later measurement.

**Constraints**: Read-only telemetry; live/simulation never blended; visuals never evidence; reduced-motion static pose; 842px viewport legibility; no remote assets/CDN/paid render service; AGPL map attribution + `public/models/LICENSE` retained; original art only; `OperationsPanel` stays the accessible detail source, scene stays `aria-hidden`

**Scale/Scope**: 7 districts, dozens of workers, the existing static map, one backdrop shader surface; planned source change is limited to scene composition, a backdrop component, and CSS fallback color.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | How satisfied |
|---|---|---|
| I. Local, read-only telemetry; offline; safe metadata only | Pass | No adapter/server/telemetry change; no write routes; no network fetch; backdrop reads no record fields |
| II. Live/simulation separate, labelled, stale retained | Pass | Source control, watermark, stale behavior untouched; backdrop identical in both modes (see `contracts/ui-contract.md`) |
| III. Visuals never evidence | Pass | Backdrop bound to no status/activity/count; `AgentRecord` unchanged; roster/inspector authoritative (`data-model.md`) |
| IV. Reduced motion honored | Pass | `reducedMotion` freezes disk/glow to static legible pose; fallback is static |
| V. Small scope, no new weight | Pass | Reuse `VillageWorld`; put shader code in one focused component because the existing scene file is over 1,200 lines; no new dependency or map asset |
| VI. Verification explicit | Pass | Nothing run; `quickstart.md` marked UNRUN; no invented pass claims |
| Preserved behaviors / a11y / attribution | Pass | Click-vs-drag, labels/colors, history placement, `aria-hidden` scene, AGPL text all preserved |

## Project Structure

### Documentation (this feature)

```text
specs/002-agent-world-blackhole/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output (UNRUN manual scenarios)
└── contracts/
    └── ui-contract.md   # Phase 1 output
```

### Source Code (repository root — existing paths this plan reuses; no changes made in this pass)

```text
src/
├── components/
│   ├── WorldScene.tsx      # VillageWorld + Canvas; backdrop host (reuse)
│   ├── BlackHoleBackdrop.tsx # Focused shader component (planned, not yet built)
│   └── OperationsPanel.tsx # Authoritative roster/inspector (untouched)
├── App.tsx                 # reducedMotion wiring + watermark (reuse)
├── styles.css              # Static CSS sky behind Canvas / no-WebGL fallback
├── types.ts                # AgentRecord/DistrictId (unchanged)
├── hooks/useTelemetry.ts   # Live/simulation/stale (untouched)
└── data/demo.ts            # districtMeta anchors (untouched)
public/
├── models/                 # AGPL villages map + LICENSE (retained)
└── draco/                  # Local decoder (retained)
```

**Structure Decision**: Keep one Canvas and the existing data path. A dedicated backdrop component keeps shader code out of the already large `WorldScene.tsx`; it accepts only `reducedMotion`. `WorldScene.tsx` places it behind the map and supplies React Three Fiber's `Canvas` fallback, while `styles.css` supplies a static sky. No server or telemetry module changes.

## Architecture

Backdrop is a leaf of `VillageWorld`, independent of the records pipeline:

```text
adapters/loopback → useTelemetry → App ──┬── OperationsPanel (truth: roster/inspector/labels)
                                         └── WorldScene/Canvas (aria-hidden, decorative)
                                              ├── background/fog/lights (existing)
                                              ├── glTF village map (static, receiveShadow only)
                                              ├── District → Worker overlays (records only)
                                              └── [NEW] BlackHoleBackdrop (camera-relative sky,
                                                  rendered behind geometry, no pointer handlers;
                                                  frozen when reducedMotion)
             Canvas unavailable → CSS sky + roster/inspector remain available
```

Placement: a camera-relative background surface keeps the hole in a quiet upper-sky area as the user orbits. One shader draws the dark center, tilted disk, apparent lensing and glow; no second WebGL context or postprocessing pass. Render it before foreground geometry without writing depth, give it no pointer handlers, and match fog/lighting to the dark-cosmic sky. The effect receives no telemetry inputs.

## Delivery Sequence

**Slice 1 — sky and legibility (planning direction, not implementation authorization)**: original black-hole composition (dark center, tilted luminous ring, apparent lensing) in the existing `Canvas`, with bounded sky/fog/lighting changes; workers and status signals stay legible at 842px; `reducedMotion` freezes the effect. A documented `?sky=off` path uses static sky inside a working Canvas. Without WebGL, `Canvas` fallback plus CSS sky keeps the accessible roster and inspector usable; the 3D village cannot render. No new dependency, remote asset, or telemetry change; existing map attribution remains intact.

**Slice 2 — strategy-game village polish (planned after visual review of slice 1)**: reuse the procedural worker/chore pieces; strengthen the central hall silhouette, district paths/accents, warm practical lights and color contrast with original bounded geometry. Preserve each district's meaning and the current camera/selection interactions. Decide exact prop count and art treatment from a visible composition review before this slice begins.

**Optional later work**: dense star field, postprocessing bloom, Blender-authored original props, or walkable interaction. Each needs separate scope, license and GPU decisions. No server/terminal/multiplayer parity is implied by this visual plan.

## Failure / Performance Review

- **No WebGL** → built-in Canvas fallback and CSS sky; roster/inspector usable while the 3D village is unavailable. `?sky=off` within working WebGL shows a simple sky and keeps the village interactive. The switch is a recovery path, not automatic shader-failure detection.
- **Reduced motion** → frozen legible pose; meaning never motion-carried.
- **Orbit risk** → camera-relative sky remains visible and cannot intercept click/drag targets.
- **Contrast risk** (dark sky vs. worker silhouettes/labels) → grade sky, fog and lighting together; later visual inspection at 842px must check every status color and label.
- **GPU/battery risk** → one non-shadow shader surface, capped DPR, no per-frame allocations or postprocessing; pause/freeze animation for reduced motion and when the tab is hidden. Quantitative claims require later measurement.
- **License/originality risk** → original art only; no article image, game assets, Agent Office source, or CDN textures.
- **Scope risk (walkable/terminal interaction)** → this plan is visual-only; larger interaction scope needs a separate feature decision and plan.

The later validation guide follows each graphics branch without changing the telemetry path:

```text
open command center
├─ WebGL unavailable ───────────────→ Canvas fallback + CSS sky; roster works
└─ WebGL available
   ├─ ?sky=off ──────────────────────→ static sky + interactive village
   └─ effect on
      ├─ reduced motion ────────────→ still black-hole composition
      └─ ordinary motion ───────────→ subtle effect + orbit/selection
         └─ telemetry stale/live/simulation labels remain independent
```

All branches above are planned and unrun. The shader switch is manual recovery if a supported browser renders the effect badly; it does not automatically detect shader compilation errors.

## What Already Exists

- `WorldScene.tsx` already renders the glTF village, procedural workers, bounded chores, hover markers, orbit controls, lighting and a capped DPR; reuse that one Canvas.
- `App.tsx`, `useTelemetry.ts` and `OperationsPanel.tsx` already separate source mode, records and accessible operational detail; preserve their signatures and meaning.
- The map, decoder, font and attribution are local. No Blender export or new model asset is needed for the first slice.

## Reference Gap

| What the reference shows | Current command center | Plan response |
|---|---|---|
| Walkable office, workers at desks, live terminals and status hooks | Orbit-only village and read-only metadata; some providers cannot report live runtime state | Keep honest status/roster; improve scene presentation without claiming live work or adding runtime controls |
| Playful, readable game-world composition | Procedural Vikings, huts and chores already exist, but the scene has a flat pale sky and limited environmental focus | Slice 1 gives a coherent sky/lighting treatment; slice 2 adds original bounded village dressing |
| Black-hole image in the linked article | No black hole; no geodesic renderer | Use a shader illusion in the existing browser Canvas, with explicit physical-accuracy limits |

## Not in Scope

- Walkable avatar, live terminals, agent hiring, voice, multiplayer and GitHub boards: those are separate Agent Office product features, not scene polish.
- Physically accurate geodesic/path tracing and an exact film image: expensive and unnecessary for the requested background look.
- New server endpoints, telemetry schemas, remote assets, map replacement, or IPAM platform UI changes: none helps the standalone visual goal.

## Verification Status

No tests, builds, typechecks, smoke tests, browser QA, installs, or service launches were run or authorized in this planning pass. `quickstart.md` documents future manual scenarios only (UNRUN). Implementation success claims are limited to what is actually observed at that later time.

## Complexity Tracking

No constitution violations to justify. No new project, pattern, or dependency introduced.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| — | — | — |
