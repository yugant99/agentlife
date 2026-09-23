# Feature Specification: Viking Village Scene

**Feature Branch**: `codex/viking-village`

**Created**: 2026-09-23

**Status**: Draft

**Input**: User description: "A prettier Viking village, workers visibly doing chores (wood chopping, filling water, cooking with smoke), and a tiny ghostlike floating rhombus on hover with only a short agent name and abbreviated task. Preserve read-only telemetry, live/simulation distinction, history placement, status labels, click selection, reduced-motion support, and the local-only app. No remote assets or heavy animation dependency."

**Revision (2026-09-23, post source review)**: The live page currently shows 27 records — 0 active, 23 past, 4 unknown. The original rule that excluded historical and unknown records from chore stations would therefore show zero chores in live mode. The user explicitly wants older workers to move and now perform chores. This revision (a) allows non-stale historical and unknown records to be chosen for decorative chore staging while their Past/Unknown markers, roster wording, counts, and telemetry facts stay unchanged; (b) keeps stale failed-refresh snapshots neutral; (c) staffs each chore from its intended district first (wood at the Forge, water at the Dock, cooking at the Great Hall), preferring active workers there, and falls back to other non-stale real records only when that district has no eligible worker; (d) removes any visible legalistic motion disclaimer; and (e) adds a bounded camera/worker-scale/label legibility requirement because workers render tiny against the whole island and central hall labels overlap at a normal (~842px) viewport.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Workers visibly perform believable chores (Priority: P1)

An operator watching the village sees a few workers doing recognisable Viking chores at believable stations — chopping wood at a block, drawing and filling water at a well or trough, and cooking at a cauldron with smoke rising — while every other worker still reads as alive rather than frozen. This holds whether the snapshot is full of active workers or contains only past and unknown ones, as the current live page does.

**Why this priority**: This is the core visual request. It is what makes the village feel like a working settlement instead of statues on a map, and it can be delivered and judged on its own.

**Independent Test**: Open the scene with a populated roster (including a live snapshot with no active workers) and confirm that wood chopping, water filling, and cooking-with-smoke are each visible and identifiable, that only a small bounded set of workers are at chore stations, and that all remaining workers still show ambient motion.

**Acceptance Scenarios**:

1. **Given** a populated village, **When** the scene is viewed, **Then** at least one worker is chopping wood with an axe and block, at least one is filling a bucket at a water source, and at least one is cooking at a cauldron with visible smoke.
2. **Given** a village with many workers, **When** the scene is viewed, **Then** only a small, bounded number of workers occupy chore stations and every other worker remains visibly alive through ambient motion.
3. **Given** a live snapshot with no currently-active workers but with past and unknown real records (e.g. 0 active / 23 past / 4 unknown), **When** the scene is viewed, **Then** chores are still visible, staffed from those non-stale records.
4. **Given** any worker performing a chore, **When** that worker's telemetry is inspected in the roster or inspector, **Then** its status, activity, provider, model, id, and Past/Unknown labelling are unchanged, and the chore is not presented as the worker's real activity.
5. **Given** reduced motion is requested, **When** the scene renders, **Then** chore motion and smoke stop and each worker still reads as present and identifiable.

---

### User Story 2 - Compact ghostlike hover marker (Priority: P2)

An operator hovers a worker and sees a tiny, semi-transparent, faintly bobbing rhombus-shaped marker carrying only the worker's short name and an abbreviated task, without a large metadata panel obscuring the village.

**Why this priority**: The hover marker is the scene's quick-glance identification affordance. It is independently valuable and independently testable, but secondary to the chores themselves.

**Independent Test**: Hover a worker and confirm a compact diamond/rhombus marker appears with a short name and abbreviated task only, that it bobs gently, that it never blocks orbiting or selection, and that it becomes static under reduced motion.

**Acceptance Scenarios**:

1. **Given** a worker in the scene, **When** the pointer hovers that worker, **Then** a compact rhombus-shaped marker appears showing only the short name and an abbreviated task.
2. **Given** the hover marker is shown, **When** the operator orbits, clicks, or moves across neighbouring workers, **Then** the marker never captures pointer input and never blocks selection or camera control.
3. **Given** reduced motion is requested, **When** a worker is hovered, **Then** the marker appears without bobbing and the name and task remain readable.
4. **Given** a worker with a long name or long activity text, **When** it is hovered, **Then** the marker stays compact and the task is abbreviated rather than expanding into a large panel.

---

### User Story 3 - Distinctive low-poly Viking villagers (Priority: P3)

An operator sees a prettier, cohesive Viking village whose workers read as individual Vikings through distinctive tunics, cloaks, fur, beards, and helms, with grounded boots and legible axes, buckets, and cauldrons, and without exaggerated horns or realistic imported characters.

**Why this priority**: This lifts the visual quality and makes workers recognisable, but it refines the same scene the earlier stories already make functional.

**Independent Test**: Inspect several workers across districts and confirm distinct, low-poly Viking silhouettes with visible tunics/cloaks/fur/beards/helms, grounded boots, and chore-appropriate props, with no giant horns or imported realistic characters.

**Acceptance Scenarios**:

1. **Given** workers in different districts, **When** the scene is viewed, **Then** their silhouettes differ through tunic/cloak, fur, beard, and headwear details while remaining low-poly.
2. **Given** a worker at a chore station, **When** it is viewed, **Then** the held or nearby prop (axe, bucket, or cauldron) is legible and appropriate to that chore.
3. **Given** the overall scene, **When** it is viewed, **Then** no worker uses giant horns or a realistic imported human character, and the village reads as one cohesive Viking settlement.

---

### User Story 4 - Legible at the normal viewport (Priority: P2)

An operator opening the app at a normal viewport (about 842px wide) sees workers large enough to read their Viking details and their chore props, and sees hall labels that do not overlap each other or the workers, while still being able to orbit and zoom the scene as before.

**Why this priority**: Without this, the chores and Viking details from the other stories are not actually visible at the default view — they are lost against the full island. It is required for the other stories to be observable, but it is a bounded framing polish rather than a new capability.

**Independent Test**: Open the scene at ~842px wide with the default camera and confirm that wood, water, and cooking stations and Viking silhouette details are distinguishable, that no two hall labels overlap, and that orbit and zoom still work.

**Acceptance Scenarios**:

1. **Given** the default view at ~842px wide, **When** the scene loads, **Then** workers are large enough that their silhouette details (helm/beard/fur) and chore props are distinguishable.
2. **Given** the default view, **When** the scene loads, **Then** hall/district labels do not overlap each other or cover the workers they label.
3. **Given** the default view, **When** the operator drags to orbit or scrolls to zoom, **Then** camera control behaves as before (orbit works, pan stays disabled, zoom stays within bounded limits).

---

### Edge Cases

- **Empty roster**: with no workers, no chore stations, props, smoke, or hover markers appear; the scene shows only the map.
- **Single worker**: at most one chore station is active and no chore is duplicated across the village.
- **Large single district**: many workers in one district do not create duplicate prop forests; chore stations stay bounded and the rest idle ambiently.
- **Live snapshot with no active workers**: chores are still staffed, drawn from non-stale past/unknown records, and every affected worker keeps its Past/Unknown label and is still excluded from active counts.
- **Historical or unknown worker at a station**: it may perform a chore, but its Past/Unknown status marker, roster wording, and counts remain unchanged and it is never counted as active.
- **Stale failed-refresh snapshot**: stale records rest neutral, are not placed at chore stations, and keep their last-known labelling.
- **Long labels**: a very long name or activity is abbreviated so the hover marker stays compact.
- **Touch / no-hover device**: no hover marker is required, and nothing in the scene obstructs touch or pointer interaction.
- **Overlapping workers**: a hover marker does not obscure neighbouring workers or grow to cover several at once.
- **Narrow viewport (~842px)**: hall labels stay separated and workers stay legible; labels do not stack into an unreadable pile in the central halls.
- **Reduced motion toggled at runtime**: scene motion and marker bobbing stop immediately without leaving a worker in a broken pose.

## Requirements *(mandatory)*

### Functional Requirements

**Chore visualization**

- **FR-001**: The scene MUST present workers as Viking villagers who occupy believable chore stations, including wood chopping, water filling, and cooking with visible smoke.
- **FR-002**: Only a small, bounded subset of workers MUST occupy chore stations at a time; all remaining workers MUST remain visibly alive through ambient motion rather than standing frozen.
- **FR-003**: Each chore MUST read unambiguously at a glance through a matching prop and station (axe and chopping block for wood, bucket and water source for water, cauldron with rising smoke for cooking).
- **FR-004**: Chore props MUST be shared and reused across stations so the scene never accumulates a duplicate prop per worker.
- **FR-005**: Decorative chore activity MUST NOT alter or override any worker's telemetry status, activity text, provider, model, id, history, status marker, roster wording, or active/past/unknown counts.
- **FR-006**: The no-claim rule MUST be enforced by not mutating telemetry and not implying a chore is verified work; no visible motion or "not evidence" disclaimer text may be added to the UI.
- **FR-007**: Chore station selection MUST staff each chore from its intended district first — wood at the Forge, water at the Dock, cooking at the Great Hall — whenever that district has any eligible non-stale worker, preferring active workers within it. It MUST fall back to another district only when the intended district has no eligible non-stale worker, and MUST accept other non-stale real records — including historical (past) and unknown workers — so chores remain visible in a live snapshot with no active workers. Only stale (failed-refresh) records MUST be excluded and left neutral.
- **FR-008**: A worker shown at a chore station MUST keep its existing Past/Unknown status marker, label, and roster wording unchanged, and MUST NOT be counted as active.

**Hover marker**

- **FR-009**: Hovering a worker MUST show a compact floating marker shaped as a rhombus/diamond.
- **FR-010**: The marker MUST be semi-transparent, MUST bob faintly, and MUST NOT capture pointer input or block selection or camera control.
- **FR-011**: The marker MUST show only the worker's short name and an abbreviated task; it MUST NOT show large metadata such as provider, model, tokens, timestamps, or full activity text.
- **FR-012**: The marker MUST remain legible against the village backdrop and compact enough not to obscure neighbouring workers.
- **FR-013**: The marker's bobbing MUST stop (static pose) when reduced motion is requested, while remaining readable.

**Viking village look**

- **FR-014**: Worker figures MUST use low-poly geometry and read as Vikings through distinctive tunics/cloaks, fur, beards, and helms.
- **FR-015**: Figures MUST have grounded boots and legible held or adjacent props (axe, bucket, cauldron) appropriate to their chore.
- **FR-016**: Figures MUST NOT use exaggerated features such as giant horns and MUST NOT use realistic imported human characters.
- **FR-017**: The village MUST read as a cohesive, playful strategy-game Viking settlement through chunky silhouettes, warm timber and stone, clear colour accents, and expressive but restrained fire and smoke, without copying another game's characters or assets or adding a remote asset or heavy animation dependency.

**Viewport legibility**

- **FR-018**: The default camera MUST frame the seven-district cluster so workers are legible at a normal viewport (about 842px wide), without losing the surrounding village as a backdrop.
- **FR-019**: Worker markers MUST be scaled so Viking silhouette details (helm/beard/fur) and chore props are distinguishable at the default view.
- **FR-020**: Hall/district labels MUST NOT overlap each other or obscure the workers they label at the normal viewport; a bounded declutter rule MUST be applied.
- **FR-021**: Orbit controls MUST remain available and unchanged in gesture behavior (drag to orbit, pan disabled, zoom within bounded limits, same polar limits).

**Preserved behavior**

- **FR-022**: Telemetry MUST remain read-only and local-only; the feature MUST NOT add remote assets, CDN requests, write routes, or new network dependencies.
- **FR-023**: The live-versus-simulation distinction MUST remain explicit and unchanged, including the simulation watermark and source control.
- **FR-024**: History placement and counts MUST remain accurate: historical records are never counted as active and keep their Past labels; stale records rest neutral and are labelled last-known.
- **FR-025**: Status labels and colours, and the roster/inspector as the authoritative detail surface, MUST remain accurate and unchanged.
- **FR-026**: Click selection MUST continue to select a worker and drive the roster and inspector, and an orbit drag MUST NOT select.
- **FR-027**: Reduced-motion support MUST continue to disable scene motion and CSS loops.
- **FR-028**: The scene MUST remain responsive with dozens of workers; frame cost MUST stay sensible through shared geometry, bounded stations, and bounded props.

### Key Entities *(include if feature involves data)*

- **Worker (agent record)**: A telemetry record placed in the village. Key attributes: id, session title, status, activity, provider, model, district, and the historical/stale flags. Read-only; never mutated by the scene.
- **Chore station**: A believable location in the village tied to one chore kind (wood chopping, water, cooking). Attributes: kind, world location, the prop set it owns, and a capacity of one worker.
- **Chore assignment**: The bounded, deterministic mapping of a small number of eligible workers to chore stations. Each chore is staffed from its intended district first (wood → Forge, water → Dock, cooking → Great Hall), preferring active workers within that district, and falls back elsewhere only when the intended district has no eligible non-stale worker. Decorative only; it never changes a record.
- **Worker silhouette profile**: The low-poly appearance of a worker — tunic/cloak, fur, beard, helm, grounded boots — plus the chore prop it may hold.
- **Hover marker**: The transient rhombus shown on hover. Attributes: visibility, short name, abbreviated task, semi-transparency, bob state, and pointer-safe behavior.
- **View framing**: The bounded default camera pose, zoom limits, worker scale, and label placement that keep the cluster legible at the normal viewport.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All three named chores — wood chopping, water filling, and cooking with smoke — are visible and identifiable in the scene within a single view of the village.
- **SC-002**: The number of workers shown at chore stations is bounded to a small count (no more than a handful at once), while every other worker still shows ambient motion.
- **SC-003**: In a live snapshot with no active workers but non-stale past/unknown records, chores are still visible (at least one station staffed per chore kind where enough records exist).
- **SC-004**: A reviewer can identify a hovered worker's name and task from the marker alone, without opening the roster, in under 2 seconds.
- **SC-005**: The hover marker occupies only a small fraction of a worker's on-screen height and never presents a large square or full metadata panel.
- **SC-006**: At ~842px wide with the default camera, workers are legible (silhouette details and props distinguishable) and no two hall-label boxes overlap.
- **SC-007**: With dozens of workers present, the scene remains smooth and responsive with no visible stutter or input lag on a typical laptop.
- **SC-008**: No new remote network requests or remote assets are introduced; the app remains fully local.
- **SC-009**: With reduced motion enabled, no chore, smoke, or marker animation plays and all information stays readable.
- **SC-010**: For the same inputs, the preserved behaviors (selection, orbit-drag non-selection, live/simulation labels, status labels, history placement, active/past/unknown counts) are unchanged.
- **SC-011**: Placing a past or unknown worker at a chore station changes none of its labels or counts: Past/Unknown markers and the active/past/unknown totals are identical to a run without chore staging.

## Assumptions

- The existing static Villages map remains the backdrop; only the agent overlay, its dressing, and the default framing change.
- The telemetry contract (`AgentRecord`, live/simulation, historical/stale) is unchanged and remains the source of truth.
- Chore stations are a small fixed set (one bounded station per chore kind). Each is assigned deterministically from its intended district first (wood → Forge, water → Dock, cooking → Great Hall), preferring active workers and accepting non-stale past/unknown workers, so a 0-active snapshot still shows chores; it falls back to another district only when the intended district has no eligible non-stale worker.
- The hover marker is a scene affordance only; full detail continues to live in the roster and inspector.
- No new third-party dependency is added; all geometry, materials, and effects are built from what the project already bundles.
- Reduced motion follows the existing `prefers-reduced-motion` handling.
- Per the project's AGENTS rule, tests, builds, and verification commands are not run unless explicitly requested; this specification and its plan do not mandate a test pipeline.
