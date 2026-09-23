# Quickstart Validation Guide: Viking Village Scene

**Feature**: `specs/001-viking-village` | **Date**: 2026-09-23

This guide describes how to validate the feature **by hand, later, when the user explicitly asks for verification**. Per the project's AGENTS rule and Constitution Principle VI, the commands below are documented for reference only and were **not** run during this planning run. Nothing here is a mandated test pipeline.

- Requirements and behavior: [spec.md](./spec.md)
- Design and decisions: [plan.md](./plan.md), [research.md](./research.md)
- Entities: [data-model.md](./data-model.md)
- Acceptance surface: [contracts/ui-contract.md](./contracts/ui-contract.md)

---

## Prerequisites

- Node.js 20+ and npm.
- A local checkout on branch `codex/viking-village`.
- Optional: `.env` configured as in the README so live adapters can be read. Simulation mode needs no configuration.

## Setup (reference only — do not run unless requested)

```bash
npm install
cp .env.example .env   # optional, for live adapters
npm run dev            # serves the app and read-only proxy on loopback
```

Open the local URL printed by the dev server (default `http://127.0.0.1:5173`). Use the **Simulation** source for a deterministic populated roster, and the **Live** source to confirm the 0-active case.

> Do not run `npm run build`, `npm run test:telemetry`, typecheck, or any browser-QA automation unless the user explicitly requests it.

---

## Scenario 1 — Visible, bounded chores in simulation and live (P1)

**Setup**: Start the app. First choose **Simulation**; then switch to **Live** (the current live page has about 27 records, 0 active, 23 past, 4 unknown).

**Steps**:
1. Orbit the camera to view the district cluster.
2. Locate the woodcutting, water, and cooking stations in each source mode.

**Expected (contracts UI-CHORE-01…12)**:
- An axe-and-block chopping motion is visible.
- A bucket-and-water filling motion is visible.
- A cauldron with rising smoke is visible.
- Chores are visible in **both** simulation and live, even though live has no active workers (UI-CHORE-10).
- The number of workers at stations is a small handful, not dozens.
- All other workers still show ambient/status motion (none frozen).
- Props appear only at stations (no per-worker prop forest).

---

## Scenario 2 — Chores never relabel telemetry (P1)

**Setup**: With a chore visible, open the roster and inspect the worker at that station.

**Steps**:
1. Select the worker performing a chore.
2. Read the inspector status, activity, provider, and model.
3. Note the roster's Past/Unknown markers and the active/past/unknown counts.

**Expected (UI-CHORE-11/12, UI-PRESERVE-04/05/09, UI-A11Y-05)**:
- The inspector shows the provider-reported status/activity unchanged; the chore is not described as the worker's real activity.
- A past worker at a station still shows its **Past** label and neutral marker; an unknown worker still shows **Unknown**.
- The active/past/unknown totals are identical with and without chore staging.
- In a stale (failed-refresh) snapshot, no worker performs a chore and all stay neutral (UI-CHORE-11).

---

## Scenario 3 — Compact ghostlike hover marker (P2)

**Setup**: Any populated roster; motion enabled.

**Steps**:
1. Hover a worker.
2. Inspect the marker's shape and content.
3. Hover a worker whose activity text is long.
4. While hovering, orbit the camera and click the worker.

**Expected (UI-HOVER-01…10)**:
- A small semi-transparent rhombus/diamond appears, not a rectangle.
- It shows only the short name and an abbreviated task.
- Long activity text is abbreviated; the marker does not grow into a large panel.
- The marker bobs gently.
- Orbiting and clicking still work; the marker never captures the pointer.
- Moving the pointer away hides the marker.

---

## Scenario 4 — Viking look (P3)

**Steps**:
1. Compare workers in different districts.
2. Look at boots and props.

**Expected (UI-LOOK-01…06)**:
- Distinct tunics/cloaks, fur, beards, and helms; low-poly forms.
- Grounded boots; legible axe/bucket/cauldron.
- No giant horns, no realistic imported characters.
- The village reads as one cohesive Viking settlement.

---

## Scenario 5 — Legible at the normal viewport (~842px) (P2)

**Setup**: Set the browser viewport to about 842px wide and load with the default camera (no interaction).

**Steps**:
1. Read the workers' silhouettes and chore props without zooming.
2. Look at the hall/district labels, especially the central halls.
3. Drag to orbit and scroll to zoom.

**Expected (UI-LEG-01…07)**:
- The cluster is framed prominently, not lost against the whole island.
- Worker silhouette details (helm/beard/fur) are distinguishable.
- Wood, water, and cooking props are recognisable without zooming.
- No two hall-label boxes overlap, and labels do not cover their workers.
- Hovering a worker shows the marker above the labels, unclipped.
- Orbit and zoom still work; pan stays disabled; polar limits unchanged.

---

## Scenario 6 — Reduced motion (P1/P2)

**Setup**: Enable the OS/browser "reduce motion" preference, then reload.

**Steps**:
1. Observe the chore stations and smoke.
2. Hover a worker.

**Expected (UI-CHORE-09, UI-HOVER-09, UI-A11Y-04)**:
- No chore motion and no smoke animation.
- The hover marker appears static (no bob) and remains readable.
- Workers still read as present and identifiable.

---

## Scenario 7 — Preserved behaviors (regression)

**Steps**:
1. Toggle **Live** ↔ **Simulation**; confirm the watermark and source control behave as before.
2. Click a worker, then drag-orbit starting on a worker.
3. Inspect status labels/colours and the active/past counts.
4. Confirm no visible "motion is illustrative / not evidence" disclaimer appears anywhere in the UI.

**Expected (UI-PRESERVE-01…12)**:
- Live and simulation stay separate; simulation is watermarked.
- A click selects; an orbit drag does not.
- Status labels/colours and history placement are unchanged.
- No new disclaimer text is present (UI-PRESERVE-11).
- With dozens of workers the scene stays smooth.

---

## Scenario 8 — Local-only and no new weight

**Steps**:
1. Open the browser network panel and load the app.
2. Confirm no remote asset or CDN request is made.

**Expected (UI-DEP-01…03, UI-PRESERVE-02)**:
- All assets are served locally; no new dependency or remote request.
- The map/font/Draco license text is intact.

---

## Out of scope for validation

- Automated unit/integration/e2e tests (none are mandated).
- Provider connectivity and model-ID verification (unchanged, separate from this feature).
- Production builds and deployment checks.

## Reporting

When verification is eventually requested, report exactly which scenarios were exercised, what was observed, and which were not run. Do not report unrun commands as passing.
