# Phase 0 Research: Viking Village Scene

**Feature**: `specs/001-viking-village` | **Date**: 2026-09-23

This document records the decisions taken to resolve the open technical questions in the plan's Technical Context. There were no `NEEDS CLARIFICATION` markers in the spec; the decisions below turn the spec's assumptions into concrete choices.

---

## R1. How chores are represented

**Decision**: Use a small set of fixed **chore stations** (one per chore kind, plus at most one repeat) and assign a bounded number of eligible workers to them. A station owns its prop set; a worker at a station plays a chore-specific pose loop.

**Rationale**: The brief asks for "a few visible workers act at believable stations and all other workers remain visibly alive without a forest of duplicate props." A station-based model naturally bounds both the number of animated props and the number of workers visibly "working", and it keeps the mapping deterministic and cheap to evaluate once per render rather than per frame.

**Alternatives considered**:
- *Per-worker prop on every worker*: rejected — dozens of workers × several props each is exactly the duplicate forest the brief forbids, and it inflates draw calls and geometry.
- *Randomised chore assignment per frame*: rejected — non-deterministic visuals flicker and make the scene hard to read.

---

## R2. Station count, eligibility, and assignment rule

**Decision**: Define a small, fixed chore set — `woodcutting`, `water`, `cooking` — with one station each (three stations total, with an optional single repeat allowed only if needed for framing). Candidates are every real record that is **not stale**, which deliberately includes `historical` (past) and `unknown` records. Candidates are ordered so currently-`active` workers are preferred when any exist, then other non-stale records; within a tier, prefer the district thematically nearest the chore (forge/great-hall → wood/fire; dock → water; great-hall → cooking), tie-broken by lowest stable `id`. Stations fill in a fixed order and a worker takes at most one station.

**Rationale**: Source review of the live page found 27 records with **0 active, 23 past, 4 unknown**. The original rule excluding historical/unknown records would have shown **zero chores in live mode**, directly contradicting the user's request that older workers move and now do chores. Excluding only `stale` (a failed-refresh snapshot, not a real current observation) keeps the scene honest while making chores visible in every real snapshot. Preferring active workers preserves the most meaningful staging when active workers exist. Determinism keeps the scene stable across refreshes, and the thematic preference keeps placement believable without inventing telemetry meaning.

**Alternatives considered**:
- *Exclude historical/unknown* (the previous rule): rejected — produces zero chores in the observed live state and contradicts the user's explicit intent.
- *Exclude only stale and ignore active preference*: rejected — chores could then be staffed by past workers while an active worker stands idle nearby, which reads worse.
- *One station per district (seven)*: rejected — more props and more "working" workers than the brief's "a few", and higher frame cost.
- *Assign by random worker each session*: rejected — non-deterministic and can place a cook at the dock.

---

## R3. Smoke without a dependency

**Decision**: Render smoke as a handful of small, shared, low-poly transparent meshes (or points) that rise, expand, and fade on a short loop above the cooking station only. Reuse one geometry and one material across all smoke particles; animate transforms only.

**Rationale**: A few animated quads/points give the readable "cooking with smoke" cue at negligible cost and add no dependency. Restricting smoke to the single cooking station keeps overdraw bounded.

**Alternatives considered**:
- *Add a particle library*: rejected — violates "no heavy animation dependency" (Constitution Principle V).
- *Texture-based smoke sprite*: rejected — would require a new asset; the project should not add remote or unbundled textures for this.
- *No smoke, just a cauldron*: rejected — the spec explicitly calls for smoke.

---

## R4. Hover marker shape and content

**Decision**: Keep the existing drei `Html` overlay approach (crisp, cheap text that is already `pointerEvents: 'none'`), but restyle it into a **compact rhombus/diamond** marker: a small semi-transparent diamond-shaped plate whose longest axis is horizontal, holding a horizontal two-line label — short name on line one, abbreviated task on line two. Add a gentle bob via a CSS transform. Under reduced motion, remove the bob (static). The marker is mounted for the hovered/selected worker only.

**Rationale**: HTML text is more legible and cheaper than 3D text for many workers, and the existing `Html` element already proves the pointer-safe pattern (`pointerEvents: 'none'`, `aria-hidden` scene). A diamond silhouette satisfies "ghostlike floating rhombus" while a short two-line label satisfies "only a short agent name and abbreviated task". Mounting only on hover keeps cost down (the current implementation keeps all tooltips mounted and fades them; moving to hover-only is a net saving).

**Alternatives considered**:
- *3D octahedron + separate label*: viable, but two elements and per-instance text geometry are heavier and less readable at distance; a CSS diamond is simpler.
- *Keep the rectangular tooltip and just shrink it*: rejected — the brief explicitly asks for a rhombus, not a rectangle.
- *Full metadata in the marker*: rejected — the brief forbids a large square/full metadata panel; detail stays in the roster/inspector.
- *drei `<Text>`/troika per worker*: rejected — per-instance text geometry for dozens of workers is heavier than one HTML overlay.

**Readability guard**: the diamond is sized to the text with internal padding so the horizontal text sits inside the diamond's inscribed area and is never clipped. Exact sizing is an implementation detail for `tasks.md`.

---

## R5. Viking silhouette construction

**Decision**: Extend the existing procedural primitive body (legs, torso, belt, arms, head) with a small, shared set of added low-poly parts: a cloak/coat panel, a fur collar/shoulder, a beard, and one of the existing headwear kinds (helm/hood/cap/brim) reinterpreted as a Viking helm/hood. Keep district uniforms for identity and keep the status orb. Add grounded boots as short, flat foot meshes at the leg base. Reuse a shared geometry/material per part type.

**Rationale**: The brief says "low-poly geometry, distinctive tunics/cloaks/fur/beards/helms, grounded boots". The existing figures are already low-poly primitives with per-district uniforms, so extending them is the smallest change that satisfies the look. Shared geometry/materials keep dozens of workers cheap.

**Alternatives considered**:
- *Import a character model*: rejected — "avoid realistic imported characters" and no new assets.
- *Giant horns*: rejected explicitly by the brief and spec FR-016.
- *Full per-worker bespoke meshes*: rejected — unbounded scope and cost.

---

## R6. Prop reuse strategy

**Decision**: Define each prop (axe, chopping block, bucket, well/trough, cauldron, smoke particles) once as a small component or shared geometry/material, and instantiate it only at the stations that need it (a handful). Chore props are not attached to every worker; only the worker currently at a station holds or stands by that station's prop.

**Rationale**: Directly satisfies spec FR-004 ("shared and reused … never a duplicate prop per worker") and keeps draw calls bounded.

**Alternatives considered**:
- *Prop on every worker's right hand* (the current tiny cube): the current single cube is harmless, but scaling it to real props per worker is the forbidden forest; props move to stations instead.

---

## R7. Frame-cost strategy

**Decision**: Bound stations; share geometry/materials; precompute the assignment and station transforms outside the frame loop; animate only transforms inside `useFrame`; mount the hover label only for the hovered/selected worker; keep the existing shadow strategy (map receives, workers cast) and `dpr` cap; avoid per-frame object/array allocation in the loop.

**Rationale**: The scene must stay smooth with dozens of workers (spec FR-028, SC-007). The dominant costs are draw calls, shadow casters, and per-frame allocations; all three are bounded by this approach.

**Alternatives considered**:
- *Instanced meshes for all workers*: rejected as a larger refactor than this feature needs; the existing per-worker group structure is already acceptable and the plan keeps it.
- *Disabling shadows*: not necessary; shadows are already bounded to workers and the map is not a caster.

---

## R8. Preserving telemetry and behavior

**Decision**: Do not modify `src/types.ts`, `src/hooks/useTelemetry.ts`, `src/data/demo.ts`, `src/App.tsx`, `src/components/OperationsPanel.tsx`, or `server/`. Read `record.status`, `record.stale`, and `record.historical` in the scene exactly as today. Chore eligibility excludes only `stale` records; a staged past/unknown worker keeps its status marker, roster wording, and counts unchanged. Selection, orbit-drag tolerance, cursor cleanup, live/simulation, and reduced motion are untouched. No visible motion/evidence disclaimer is added; the no-claim rule is enforced by never mutating telemetry (Constitution Principle III).

**Rationale**: The brief's preservation list is the safety boundary; leaving those files unchanged makes regressions unlikely by construction and keeps the change reviewable. The user previously asked for the visible disclaimer to be removed, so the plan deliberately adds none.

**Alternatives considered**:
- *Add a `chore` field to `AgentRecord`*: rejected — it would touch the read-only contract and could be mistaken for telemetry. Chore assignment stays scene-local and derived.
- *Reintroduce a visible "motion is illustrative" notice*: rejected — the user requested its removal; the requirement is satisfied structurally by non-mutation.

---

## R9. Dependency and asset policy

**Decision**: Add no npm dependency and no new asset file. All new visuals are procedural geometry/materials plus CSS. The static Villages GLTF, fonts, and Draco decoder remain the only bundled assets.

**Rationale**: "No remote assets or a heavy animation dependency" (brief; spec FR-017/FR-022; Constitution Principles I and V).

**Alternatives considered**:
- *Add a tweening/particle/character library*: rejected.
- *Fetch a texture or model*: rejected.

---

## R10. Reduced motion

**Decision**: Reuse the existing `reducedMotion` prop and CSS `prefers-reduced-motion` block. Chore loops, smoke, and marker bob all short-circuit to a static, legible pose; the hover marker still appears and reads.

**Rationale**: Spec FR-013/FR-027 and Constitution Principle IV. Reusing the existing signal avoids a second source of truth.

**Alternatives considered**:
- *Separate scene-level toggle*: rejected — duplicates state and risks divergence from the OS preference.

---

## R11. Camera, worker scale, and label legibility

**Decision**: Apply a bounded framing polish:
1. **Camera**: move the default pose from `[15, 19, 32]`/fov `46`/target `[0, 2, 0]` to about `[10, 12.5, 21]`/fov `42`/target `[0, 1.6, 0]`, framing the seven-district cluster rather than the whole island (camera distance ≈39 → ≈26 world units).
2. **Zoom bounds**: `minDistance` ≈9 and `maxDistance` ≈60 (from `12`/`72`), with pan still disabled and polar limits (0.35–1.32) unchanged.
3. **Worker scale**: `WORKER_SCALE` ≈1.4 on each worker group, scaling from `y=0` so boots stay grounded, and widen slot spacing to ≈`[1.5, 1.25]` (from `[1.15, 1.0]`) so scaled workers do not overlap.
4. **Labels**: raise hall labels to ≈`y=3.4`, shrink to `distanceFactor` ≈20, apply a bounded vertical stagger of ≈0.35 world units per district index, and give hall labels a lower render priority than the worker hover marker (raised to ≈`y=3.6`, `distanceFactor` ≈30).

**Rationale**: Visual inspection of the restored page at ~842px wide found workers tiny against the entire island and central hall labels overlapping. The combined camera tightening (~1.5×) and worker scale (~1.4×) make workers roughly 2× larger on screen, so wood/water/cooking and Viking details are visible, while the vertical stagger plus render-priority split separates the overlapping central labels. Keeping the map scale, pan-disabled orbit, and polar limits unchanged preserves navigation. The change is bounded to these constants and adds no new mechanism.

**Alternatives considered**:
- *Scale up only workers, leave the camera wide*: rejected — the island would still dominate and the cluster would look cramped; a modest camera tightening plus scale is better balanced.
- *Reduce `DISTRICT_SPAN_TARGET`*: rejected — it changes map layout broadly; a camera/scale change is narrower and reversible.
- *Hide overlapping labels with raycast occlusion*: rejected — extra per-frame raycasts cost more than a static stagger for a bounded label set.
- *Make hall labels clickable or interactive*: rejected — out of scope; labels stay decorative and pointer-safe.

---

## Resolved unknowns

| Technical Context item | Resolution |
|------------------------|------------|
| Testing | No pipeline run or mandated; guidance documented only (R8, Constitution VI). |
| Storage | N/A — in-memory read-only telemetry. |
| Chore count/eligibility/assignment | Bounded fixed stations; non-stale candidates incl. historical/unknown; active preferred; stale excluded (R1, R2). |
| Smoke implementation | Shared low-poly procedural particles, cooking station only (R3). |
| Hover marker implementation | Restyled pointer-safe HTML diamond, hover-only mount, CSS bob (R4). |
| Dependency/asset additions | None (R9). |
| Viewport legibility | Bounded camera/zoom/scale/slot/label values (R11). |

All Technical Context items are resolved; no `NEEDS CLARIFICATION` remains.
