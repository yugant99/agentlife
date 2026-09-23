# Phase 1 Data Model: Viking Village Scene

**Feature**: `specs/001-viking-village` | **Date**: 2026-09-23

This feature is presentational. It introduces no persisted data and does not change the telemetry contract. The entities below are scene-local view models derived from the existing read-only `AgentRecord`; none of them is written back to telemetry.

---

## E1. AgentRecord (existing — read-only input)

The existing telemetry record from `src/types.ts`. Consumed unchanged.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Stable identity; used as the React key and selection id. |
| `title` | string | Short worker name shown in the hover marker (may be abbreviated for display only). |
| `status` | `WorkerStatus` | `active \| waiting \| needs-input \| review \| failed \| complete \| unknown`. Drives motion and colour; never changed by the scene. |
| `activity` | string | Full activity text; only an abbreviated form appears in the hover marker. |
| `provider`, `model` | string | Shown in the roster/inspector only, never in the marker. |
| `district` | `DistrictId` | Which hall the worker is displayed in. |
| `stale` | boolean? | Failed-refresh marker; neutral pose, no chore, last-known labelling. |
| `historical` | boolean? | Past session; may staff a decorative chore, never counted active, keeps its Past label. |
| `reportedStatus` | `WorkerStatus`? | Preserved original status for past records. |

**Validation / invariants**: the scene MUST NOT mutate any field. Chore eligibility and marker text are derived copies, never assignments back onto the record. A record's status marker, roster wording, and active/past/unknown counts are identical whether or not it staffs a chore (spec FR-005, FR-008, SC-011).

---

## E2. ChoreKind (new — enum)

The three requested chores.

| Value | Meaning | Station prop set |
|-------|---------|------------------|
| `woodcutting` | Chopping wood at a block | axe + chopping block + log pile |
| `water` | Drawing and filling water | bucket + well/trough |
| `cooking` | Cooking over a fire | cauldron + fire + smoke |

**Validation**: closed set of exactly three values for this feature.

---

## E3. ChoreStation (new — scene-local)

A believable fixed location in the village that owns one chore and its props.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Stable id, e.g. `station-wood-01`. |
| `kind` | `ChoreKind` | One of the three chores. |
| `anchor` | `THREE.Vector3` (or district id + offset) | Placement, derived once from the normalized map layout. |
| `capacity` | number | Always `1` for this feature. |
| `assignedWorkerId` | string \| null | The worker currently at the station, or null. |
| `props` | prop descriptor | Shared geometry/material references, instantiated only here. |

**Relationships**: each station belongs to the village; each station is assigned at most one `AgentRecord`.

**Validation rules**:
- Total stations MUST be bounded (one per kind, optional single repeat) — no per-worker stations.
- `capacity` is `1`; a station is never double-assigned.
- A station MUST NOT be placed on top of a district's worker slots in a way that hides them (placement is checked against the anchor ring).

**State transitions**: `empty → assigned` when a non-stale real worker is chosen for the station; `assigned → empty` when that worker leaves the snapshot (becomes absent or stale). Transitions do not move the station, and they do not change any record field.

---

## E4. ChoreAssignment (new — derived)

The deterministic, bounded mapping from eligible workers to stations.

| Field | Type | Notes |
|-------|------|-------|
| `workerId` | string | An eligible `AgentRecord.id`. |
| `stationId` | string | A `ChoreStation.id`. |
| `kind` | `ChoreKind` | Convenience copy of the station kind. |

**Derivation (pure, evaluated outside the frame loop)**:
1. Consider every real record that is not `stale` (a failed-refresh snapshot is not a real current observation). This deliberately includes `historical` (past) and `unknown` records, because the live page can be dominated by them (currently 0 active / 23 past / 4 unknown) and the user wants older workers to move and perform chores.
2. Order candidates so that currently-`active` workers are preferred when any exist; then other non-stale records.
3. Within each preference tier, prefer the district thematically nearest the chore (forge/great-hall → wood/fire; dock → water; great-hall → cooking), tie-broken by lowest stable `id` for determinism.
4. Iterate stations in a fixed order (`woodcutting`, `water`, `cooking`) and assign the next unassigned candidate to each.
5. A worker is assigned to at most one station; leftover candidates keep their existing status-based motion.

**Validation rules**: pure and deterministic for a given record set; never mutates a record; re-evaluated when `records` changes, not per frame; `stale` records are never assigned.

**State transitions**: recomputed on each new snapshot; an assignment whose worker is no longer present or has become stale is dropped and the station returns to `empty`.

---

## E5. WorkerSilhouetteProfile (new — scene-local, static)

The low-poly Viking appearance of a worker.

| Field | Type | Notes |
|-------|------|-------|
| `district` | `DistrictId` | Selects the existing uniform (coat/accent/hat). |
| `cloak` | boolean | Adds a cloak/coat panel variant. |
| `fur` | boolean | Adds a fur collar/shoulder. |
| `beard` | boolean | Adds a beard mesh. |
| `helm` | `HatKind` | `helm \| hood \| cap \| brim`, reinterpreted as Viking headwear. |
| `boots` | `true` | Grounded foot meshes at the leg base (always on). |
| `choreProp` | `ChoreKind \| null` | The prop the worker holds while assigned to a station. |

**Validation**: variants are chosen deterministically (e.g. from district + slot) so silhouettes differ without randomness; geometry/materials are shared across all workers.

---

## E6. HoverMarker (new — transient UI state)

The rhombus shown when a worker is hovered or selected.

| Field | Type | Notes |
|-------|------|-------|
| `visible` | boolean | True while hovered (or selected, per implementation choice). |
| `workerId` | string | Which worker it describes. |
| `name` | string | Short name (`record.title`), display-abbreviated if needed. |
| `taskAbbreviation` | string | Abbreviated form of `record.activity` (or title fallback). |
| `semiTransparent` | `true` | Ghostlike translucency. |
| `bob` | boolean | Faint bob; `false` under reduced motion. |
| `pointerSafe` | `true` | Never captures pointer events. |

**Validation rules**:
- MUST contain only `name` + `taskAbbreviation`; no provider/model/tokens/timestamps/full activity.
- MUST remain compact (small fraction of worker height) and legible.
- `bob` MUST be `false` when reduced motion is requested.
- `pointerSafe` MUST be `true` in all states.

**State transitions**: `hidden → visible` on pointer-over (or selection); `visible → hidden` on pointer-out (or deselection); reduced-motion change sets `bob = false` without hiding the marker.

---

## E7. SmokeEmitter (new — scene-local, cooking only)

A tiny procedural smoke loop owned by the cooking station.

| Field | Type | Notes |
|-------|------|-------|
| `stationId` | string | The cooking station. |
| `particleCount` | number | Small fixed count (single digits). |
| `geometry`, `material` | shared refs | One geometry + one material reused for all particles. |
| `loopSeconds` | number | Short, bounded rise/fade loop. |

**Validation**: only instantiated at the cooking station; disabled (static or hidden) under reduced motion; no new asset or dependency.

---

## E8. ViewFraming (new — scene-local, static)

The bounded default framing that keeps the cluster legible at the normal viewport.

| Field | Type | Planned target | Notes |
|-------|------|----------------|-------|
| `cameraPosition` | `[x, y, z]` | `≈[10, 12.5, 21]` | Replaces `[15, 19, 32]`; frames the cluster, not the whole island. |
| `fov` | number | `≈42` | Slightly narrower than the current `46`. |
| `target` | `[x, y, z]` | `≈[0, 1.6, 0]` | Slightly lower than the current `[0, 2, 0]`. |
| `minDistance` | number | `≈9` | Orbit zoom-in limit (current `12`). |
| `maxDistance` | number | `≈60` | Orbit zoom-out limit (current `72`). |
| `workerScale` | number | `≈1.4` | Applied to each worker group, scaling from `y=0` so boots stay grounded. |
| `slotSpacing` | `[x, z]` | `≈[1.5, 1.25]` | Widened from `[1.15, 1.0]` so scaled workers do not overlap. |

**Validation**: pan remains disabled and polar limits (0.35–1.32) are unchanged; the map scale (`DISTRICT_SPAN_TARGET`) is unchanged; the change is bounded to these values.

---

## E9. LabelPlacement (new — scene-local, static)

The bounded declutter rule for hall labels and the worker hover marker.

| Field | Type | Planned target | Notes |
|-------|------|----------------|-------|
| `hallLabelHeight` | number | `≈3.4` | Clears the scaled head/orb (current `3.0`). |
| `hallLabelDistanceFactor` | number | `≈20` | Smaller footprint (current `26`). |
| `hallLabelStagger` | number | `≈0.35` world units per district index | Separates central halls whose labels currently overlap. |
| `hallLabelRenderPriority` | number | below the worker marker | Hall labels never cover the hover marker or workers. |
| `markerHeight` | number | `≈3.6` | Clears the scaled orb (current `2.55`). |
| `markerDistanceFactor` | number | `≈30` | Keeps the marker compact (current `34`). |
| `markerRenderPriority` | number | above hall labels | Marker stays readable over labels. |

**Validation**: no two hall-label boxes may intersect at the normal (~842px) viewport; labels must not cover the workers they label; exact values finalized during implementation with one visual check.

---

## Entity relationships

```text
AgentRecord (read-only, non-stale) 1 ─── 0..1 ChoreAssignment ─── 1 ChoreStation
AgentRecord 1 ─── 1 WorkerSilhouetteProfile (static, by district/slot)
ChoreStation (cooking) 1 ─── 1 SmokeEmitter
AgentRecord 0..1 ─── 0..1 HoverMarker (transient, hovered only)
Village 1 ─── 1 ViewFraming
Village 1 ─── 1 LabelPlacement
```

All new entities are scene-local and derived. Deleting them has no effect on telemetry; there is no persistence and no migration. `stale` records are the only exclusion from chore staffing, and that exclusion is a scene-local choice that never changes the record.
