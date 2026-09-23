# UI Contract: Viking Village Scene

**Feature**: `specs/001-viking-village` | **Date**: 2026-09-23

This project's user-facing interface is the rendered scene and the adjacent roster/inspector. This contract fixes the observable behavior the implementation must honour. It is the acceptance surface for `tasks.md` and `quickstart.md`. Identifiers are stable and referenced by both.

**Revision (2026-09-23)**: Chore staffing now prefers active workers and falls back to non-stale past/unknown records so chores appear in live mode; only stale snapshots stay neutral. A bounded viewport-legibility contract was added. No visible motion/evidence disclaimer is added.

---

## C1. Hover marker contract

The scene exposes one transient marker per hovered worker.

| ID | Requirement | Verification |
|----|-------------|--------------|
| UI-HOVER-01 | On pointer-over of a worker, a marker appears anchored near that worker. | Hover a worker; a marker appears. |
| UI-HOVER-02 | The marker silhouette is a rhombus/diamond, not a rectangle or square. | Visual inspection of the marker outline. |
| UI-HOVER-03 | The marker is semi-transparent and reads as ghostlike over the village. | Marker shows the backdrop through it. |
| UI-HOVER-04 | The marker content is exactly two pieces of information: a short name and an abbreviated task. | Inspect the marker; no provider, model, tokens, timestamps, or full activity text. |
| UI-HOVER-05 | The task text is abbreviated so the marker stays compact for long inputs. | Hover a worker with a long activity; the marker does not expand into a large panel. |
| UI-HOVER-06 | The marker bobs faintly while motion is allowed. | Observe a gentle vertical bob. |
| UI-HOVER-07 | The marker never captures pointer input. | Orbit, click, and select still work while the marker is shown; the marker is not clickable. |
| UI-HOVER-08 | The marker is compact relative to a worker and does not obscure neighbours. | Marker covers a small fraction of worker height; nearby workers remain visible. |
| UI-HOVER-09 | Under reduced motion the marker appears without bobbing and stays readable. | Enable reduced motion; hover; marker is static and legible. |
| UI-HOVER-10 | On pointer-out, the marker disappears; no marker is left behind. | Move the pointer away; marker is gone. |

**Notes**: The marker is mounted only for the hovered/selected worker. Whether selection also pins the marker is an implementation choice, but UI-HOVER-04/07/09 apply in all cases.

---

## C2. Chore station contract

| ID | Requirement | Verification |
|----|-------------|--------------|
| UI-CHORE-01 | Three chore kinds are present: woodcutting, water, and cooking. | Each is visible in the scene. |
| UI-CHORE-02 | Woodcutting shows an axe and a chopping block, with a chopping motion. | A worker swings an axe at a block. |
| UI-CHORE-03 | Water shows a bucket at a well/trough, with a fill motion. | A worker fills a bucket at a water source. |
| UI-CHORE-04 | Cooking shows a cauldron with rising smoke. | Smoke is visible above the cauldron. |
| UI-CHORE-05 | The number of workers at stations is bounded to a small count. | Count chore workers; it is a handful, not dozens. |
| UI-CHORE-06 | Every worker not at a station remains visibly alive. | Unassigned workers still show status-based motion. |
| UI-CHORE-07 | Props are shared across stations, not duplicated per worker. | Prop meshes are instantiated only at stations. |
| UI-CHORE-08 | Stations do not obscure the district worker slots or locator rings. | Workers remain visible around each station. |
| UI-CHORE-09 | Under reduced motion, chore motion and smoke stop and workers remain identifiable. | Enable reduced motion; no chore or smoke animation. |
| UI-CHORE-10 | Chore staffing prefers currently-active workers when present, and falls back to other non-stale real records — including historical (past) and unknown workers — so chores are visible even in a live snapshot with no active workers (e.g. 0 active / 23 past / 4 unknown). | With a 0-active live roster, chores are still staffed. |
| UI-CHORE-11 | Stale (failed-refresh) records are never placed at a chore station and stay neutral. | Force/observe a stale snapshot; no stale worker performs a chore. |
| UI-CHORE-12 | A worker at a station keeps its Past/Unknown status marker, label, and roster wording unchanged and is not counted as active. | Compare labels and active/past/unknown counts with and without chore staging; they are identical. |

---

## C3. Viking silhouette contract

| ID | Requirement | Verification |
|----|-------------|--------------|
| UI-LOOK-01 | Workers are low-poly and read as Vikings. | No realistic imported characters; geometry stays faceted/simple. |
| UI-LOOK-02 | Silhouettes differ through tunics/cloaks, fur, beards, and helms. | Compare workers across districts; details differ. |
| UI-LOOK-03 | Boots are grounded (feet meet the ground plane). | No floating or sunken figures, including after the worker scale change. |
| UI-LOOK-04 | Chore props (axe, bucket, cauldron) are legible. | Props are recognisable at the default camera distance. |
| UI-LOOK-05 | No giant horns and no exaggerated proportions. | Visual inspection. |
| UI-LOOK-06 | The village reads as one cohesive Viking settlement. | Palette and forms are consistent across districts. |

---

## C4. Preserved-behavior contract

These MUST hold unchanged for the same inputs.

| ID | Requirement |
|----|-------------|
| UI-PRESERVE-01 | Telemetry remains read-only; no write route, prompt, or model execution is added. |
| UI-PRESERVE-02 | The app remains local-only: no remote assets, CDN requests, or new network dependency. |
| UI-PRESERVE-03 | Live and simulation remain separate; the simulation watermark and source control behave as before. |
| UI-PRESERVE-04 | Status labels and colours are unchanged. |
| UI-PRESERVE-05 | History placement and counts are unchanged: historical records are excluded from active counts and keep their Past labels (they may staff a decorative chore, which changes no label or count); stale records rest neutral and are labelled last-known. |
| UI-PRESERVE-06 | Clicking a worker selects it and updates the roster/inspector; an orbit drag does not select. |
| UI-PRESERVE-07 | Reduced motion disables scene motion and CSS loops. |
| UI-PRESERVE-08 | The roster and inspector remain the authoritative surface for full detail. |
| UI-PRESERVE-09 | Chore/marker visuals never change or imply a record's status, activity, provider, model, or id. |
| UI-PRESERVE-10 | The scene remains smooth and responsive with dozens of workers. |
| UI-PRESERVE-11 | No visible motion or "not evidence" disclaimer text is added to the UI; the no-claim rule is enforced structurally by not mutating telemetry. |
| UI-PRESERVE-12 | Orbit controls keep their gesture behavior: drag to orbit, pan disabled, zoom within bounded limits, unchanged polar limits. |

---

## C5. Accessibility contract

| ID | Requirement |
|----|-------------|
| UI-A11Y-01 | The WebGL scene stays out of the accessibility tree (`aria-hidden`), as today. |
| UI-A11Y-02 | The hover marker is decorative and non-interactive; it must not trap focus or pointer input. |
| UI-A11Y-03 | Full, labelled detail remains available in the roster/inspector without relying on the marker. |
| UI-A11Y-04 | Under reduced motion, all information remains available in a static form. |
| UI-A11Y-05 | A past/unknown worker staged at a chore remains fully labelled as Past/Unknown in the roster and inspector. |

---

## C6. Dependency and asset contract

| ID | Requirement |
|----|-------------|
| UI-DEP-01 | No new npm dependency is added. |
| UI-DEP-02 | No new asset file (model, texture, font) is added or fetched remotely. |
| UI-DEP-03 | Existing map, font, and Draco assets remain locally bundled with their license intact. |

---

## C7. Viewport legibility contract

The normal viewport for this contract is about 842px wide with the default camera and no user interaction.

| ID | Requirement | Verification |
|----|-------------|--------------|
| UI-LEG-01 | The default camera frames the seven-district cluster rather than the whole island, keeping the village as a backdrop. | At default load, the cluster fills most of the scene with surrounding village visible. |
| UI-LEG-02 | Workers are scaled so Viking silhouette details (helm/beard/fur) are distinguishable. | Compare two workers of different districts; details read apart. |
| UI-LEG-03 | Chore props (axe/block, bucket/well, cauldron/smoke) are distinguishable at the default view. | Each prop is recognisable without zooming. |
| UI-LEG-04 | No two hall-label boxes intersect, and labels do not cover the workers they label. | Visual inspection at ~842px; no overlapping label boxes. |
| UI-LEG-05 | The hover marker remains above hall labels and clears the scaled worker. | Hover a worker; marker is fully readable and not clipped by a label. |
| UI-LEG-06 | Orbit and zoom remain available and bounded; pan stays disabled and polar limits are unchanged. | Drag to orbit and scroll to zoom; behavior matches today, with tighter distance limits. |
| UI-LEG-07 | The change is bounded: map scale (`DISTRICT_SPAN_TARGET`) and telemetry/server files are untouched. | Diff review shows only camera/scale/slot/label constants changed. |

---

## Contract ownership

The implementation lives in `src/components/WorldScene.tsx` and `src/styles.css`. The roster/inspector (`src/components/OperationsPanel.tsx`) and telemetry (`src/hooks/useTelemetry.ts`, `src/types.ts`, `server/`) are contract-preserved and must not be modified to satisfy this feature.
