# Implementation Plan: Viking Village Scene

**Branch**: `codex/viking-village` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-viking-village/spec.md`

**Note**: This plan covers planning artifacts only. No application source is changed in this run, and no tests, builds, or verification commands are run (see Constitution Principle VI).

## Summary

Make the agent overlay read as a prettier Viking village: a small bounded set of workers visibly perform three believable chores (wood chopping, water filling, cooking with smoke) at shared stations, every other worker stays visibly alive, worker silhouettes gain low-poly Viking details (tunics/cloaks, fur, beards, helms, grounded boots, legible props), and hovering a worker shows a tiny semi-transparent bobbing rhombus carrying only a short name and an abbreviated task. Chore staffing works district-first — wood at the Forge, water at the Dock, cooking at the Great Hall — preferring active workers in that district and falling back to any other non-stale real record, including the historical (past) and unknown records that dominate the current live page (0 active / 23 past / 4 unknown), so chores are visible in live mode; only stale failed-refresh snapshots stay neutral, and no worker's status marker, label, roster wording, or count changes. A bounded camera/worker-scale/label legibility pass makes the chores and Viking details readable at a normal (~842px) viewport. The existing read-only adapters, live/simulation distinction, history placement, status labels, click selection, reduced-motion handling, and local-only boundary are preserved. The implementation stays inside the existing React Three Fiber / Three.js components with no new dependency and no remote assets.

Visual direction: take broad inspiration from playful strategy-game villages, with chunky toy-like proportions, warm timber and stone, selective saturated accents, and readable fire/smoke effects. Use original procedural geometry and the existing local map; do not copy another game's assets or character designs.

## Technical Context

**Language/Version**: TypeScript 5.9, React 19.2 (Vite 7.1 build)

**Primary Dependencies**: `three` 0.180, `@react-three/fiber` 9.4, `@react-three/drei` 10.7 (existing `Html`, `OrbitControls`, `useLoader`), `@phosphor-icons/react` (roster only). No new dependency is added.

**Storage**: N/A — read-only telemetry is fetched in memory from the local proxy; nothing is persisted.

**Testing**: No test pipeline is mandated or run for this feature. `npm run test:telemetry` exists but, per the AGENTS rule and Constitution Principle VI, it MUST NOT be run unless the user explicitly requests it. Validation guidance is documented in `quickstart.md` for later manual use only.

**Target Platform**: Desktop browser with WebGL2, served locally at `127.0.0.1:5173` by the existing Vite dev/proxy setup. Responsive fallback for narrow viewports already exists; the legibility target is the normal ~842px-wide viewport.

**Project Type**: Single-project web application (Vite + React front end with a loopback-only Node read-only telemetry proxy).

**Performance Goals**: Smooth, interactive scene with dozens of workers. Bounded chore stations, no per-frame React state for chore motion, and the existing `dpr={[1, 1.65]}` cap retained. Hover markers stay mounted and fade on hover to avoid flicker.

**Constraints**: Local-only; no remote assets or CDN requests; no heavy animation or character dependency; telemetry stays read-only; live and simulation never blend; each chore is staffed from its intended district first (wood Forge, water Dock, cooking Great Hall) with active workers preferred there, and non-stale historical/unknown records may be staged at chores but are never counted active and never relabelled; stale records stay neutral; reduced motion disables scene motion and CSS loops; orbit-drag must not select; no visible motion/evidence disclaimer.

**Scale/Scope**: Seven districts, dozens of workers across them (current live snapshot: 27 records), a bounded set of chore stations (at most one per chore kind plus at most one repeat — a handful total), one hover marker visible at a time, and a bounded camera/scale/label change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Local, Read-Only Telemetry | No new network/remote assets, no write routes; adapters untouched. | PASS — all new geometry/materials are procedural and bundled; no fetch or asset URL added. |
| II. Live and Simulation Stay Separate | Simulation watermark, source control, and no-blend behavior unchanged. | PASS — scene changes are presentational and read the same records. |
| III. Visuals Are Never Evidence | Chores/markers never mutate or imply telemetry; not presented as proof. | PASS — chores are a deterministic decorative mapping over existing records; no record field is written, no visible disclaimer is added (the rule is enforced by non-mutation). |
| IV. Reduced Motion Is Honored | Motion and bobbing stop; information stays legible. | PASS — existing `reducedMotion` prop gates chore motion; marker bob is disabled under the same flag. |
| V. Small Scope, No New Weight | Simplest change inside existing components; shared props; no new dependency. | PASS — changes are confined to `WorldScene.tsx` and `styles.css`; shared geometries/materials; no dependency added. |
| VI. Verification Is Explicit | No tests/builds/verification run unless requested; no mandated pipeline. | PASS — this run only reads source and writes planning artifacts; no command beyond the Spec Kit `setup-plan.sh` script was run. |

No violations. Complexity Tracking is intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-viking-village/
├── plan.md              # This file ($speckit-plan command output)
├── spec.md              # Feature specification ($speckit-specify command output)
├── research.md          # Phase 0 output ($speckit-plan command)
├── data-model.md        # Phase 1 output ($speckit-plan command)
├── quickstart.md        # Phase 1 output ($speckit-plan command)
├── contracts/
│   └── ui-contract.md   # Phase 1 output — UI contract for the scene affordances
├── checklists/
│   └── requirements.md  # Spec quality checklist ($speckit-specify command output)
└── tasks.md             # Phase 2 output ($speckit-tasks command — NOT created by $speckit-plan)
```

### Source Code (repository root)

```text
src/
├── components/
│   ├── WorldScene.tsx   # Map, worker markers, chore stations, silhouettes, hover marker, framing  (primary change)
│   └── OperationsPanel.tsx  # Roster + inspector — unchanged (authoritative detail surface)
├── data/
│   └── demo.ts          # District metadata and staging — unchanged
├── hooks/
│   └── useTelemetry.ts  # Read-only telemetry, live/simulation — unchanged
├── types.ts             # AgentRecord contract — unchanged
├── App.tsx              # Reduced-motion detection, selection — unchanged
└── styles.css           # Hover marker + label styling replace the rectangular tooltip   (primary change)
```

```text
server/                  # Read-only adapters and proxy — unchanged
public/models/           # Static Villages GLTF + license — unchanged (no new assets)
```

**Structure Decision**: Extend the existing single-project layout. All work lives in `src/components/WorldScene.tsx` (scene composition, chore stations, Viking silhouettes, hover marker, camera/label framing) and `src/styles.css` (marker and label styling). No new source module is required; the bounded chore mapping, prop definitions, and framing constants are small, deterministic constants colocated in `WorldScene.tsx`. Telemetry files, the map, and the server are untouched, which is what keeps the preserved behaviors safe by construction.

## Camera, Worker-Scale, and Label Legibility Plan

Source review of the restored page at ~842px wide found that workers render tiny against the whole island and that central hall labels overlap. This is a bounded framing polish, not a redesign; it touches only the default camera, one worker-scale constant, slot spacing, and label placement. The map, its scale, telemetry, and the server are untouched.

| Element | Current | Planned (bounded target) | Reason |
|---------|---------|--------------------------|--------|
| Default camera | `position=[15, 19, 32]`, `fov=46`, `target=[0, 2, 0]` | `position≈[10, 12.5, 21]`, `fov≈42`, `target≈[0, 1.6, 0]` | Frame the seven-district cluster instead of the whole island; camera distance drops from ≈39 to ≈26 world units, so workers read ~1.5× larger while the village stays a backdrop. |
| Orbit zoom bounds | `minDistance=12`, `maxDistance=72` | `minDistance≈9`, `maxDistance≈60` | Let the operator zoom in to a legible close-up and out to the cluster, without losing the village context. Pan stays disabled and polar limits (0.35–1.32) unchanged. |
| Worker scale | implicit `1.0` (figure ≈2.05 units tall) | `WORKER_SCALE≈1.4` applied to each worker group, scaling from `y=0` so boots stay grounded | Makes Viking details (helm/beard/fur) and chore props distinguishable at the default view. |
| Worker slot spacing | `x=1.15`, `z=1.0` | `x≈1.5`, `z≈1.25` | Keeps scaled-up workers from overlapping within a district. |
| Hall label | `y=3.0`, `distanceFactor=26` | `y≈3.4` (clears the scaled head/orb), `distanceFactor≈20`, smaller type | Matches the scaled workers and shrinks the label footprint. |
| Hall label overlap | all at the same height, default z-index | bounded vertical stagger by district index (`index * ≈0.35` world units) plus hall labels at a lower render priority than worker markers (`zIndexRange` below the marker) | Separates the central halls whose labels currently overlap, and keeps labels from covering workers. |
| Worker hover marker | `y=2.55`, `distanceFactor=34`, `zIndexRange=[20,0]` | `y≈3.6` (clears the scaled orb), `distanceFactor≈30`, `zIndexRange` above hall labels | Keeps the marker above the worker and above hall labels after scaling. |

**Bounded outcome**: at ~842px wide with the default camera, a worker's silhouette details and chore props are distinguishable, and no two hall-label boxes intersect. Exact values are settled from the constants above; no other camera or scene behavior changes, and no visual check is run as part of implementation.

## Complexity Tracking

> No Constitution Check violations. This section is intentionally empty.
