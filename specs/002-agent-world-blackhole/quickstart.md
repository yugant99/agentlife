# Quickstart: Agent Village and Black Hole Backdrop (future manual scenarios)

**Status: UNRUN — planning only.** No tests, builds, smoke checks, browser QA, service startups, or installs were run or authorized for this planning pass (constitution VI). The scenarios below are for a later authorized implementation check. Do not treat them as passing.

## Prerequisites (later)

- Local install complete; app serving on loopback via the existing `dev`/`web` scripts when explicitly authorized.
- Telemetry in known state (live snapshot available; simulation toggle reachable).
- OS/browser reduced-motion control available; a way to disable WebGL (e.g. browser flag) for the fallback scenario.

When a later implementation check is authorized, use the existing project setup (see `README.md`):

```bash
cp .env.example .env
# Set COMMAND_CENTER_SCOPE_CWD in .env to the intended local project path.
npm run dev
```

Open `http://127.0.0.1:5173`. These commands are documented for later use and were not run in this planning pass. Compare results with [the UI contract](contracts/ui-contract.md) and [data model](data-model.md).

## Scenario 1 — Default view reads as village + backdrop (842px viewport)

1. Open the command center at ~842px width, default camera.
2. Expect: seven districts, workers/chores, hall labels, and selected-worker detail legible; black-hole composition (dark center, luminous ring, bent-light look) visible behind the village, subordinate, covering no worker/label/mark.
3. Expect: roster counts, provider/model labels, timestamps match the pre-change snapshot for the same input.

## Scenario 2 — Selection and orbit preserved

1. Click a worker → roster detail selects. Drag to orbit → no selection change.
2. Toggle live/simulation → watermark appears/disappears; backdrop appearance does not change; no records blend across modes.

## Scenario 3 — Reduced motion

1. Enable `prefers-reduced-motion`.
2. Expect: disk rotation, glow pulse, flames/smoke freeze to a static legible pose; all detail still available without motion.

## Scenario 4 — Effect-off / WebGL fallback

1. Open the page with `?sky=off` while WebGL still works.
2. Expect a static dark sky plus interactive village, roster and inspector.
3. Separately disable WebGL in the browser.
4. Expect the static CSS sky and an explicit 3D-unavailable fallback; the village cannot render, while the roster and inspector remain usable. No synthetic records or telemetry-failure mislabel appears.

## Scenario 5 — Stale snapshot

1. Force a refresh failure (per existing telemetry behavior).
2. Expect: last snapshot retained and labelled stale; scene motion neutral per existing rule; backdrop unchanged.

## Recording results (later)

- Note exact commands run, what was observed, viewport size, and GPU/browser; do not claim success beyond what was observed. Unrun until then.
