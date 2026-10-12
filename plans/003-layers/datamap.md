# Datamap — Data-to-world mapping and information design

## 1. Audit

Today every visual channel reads `CityAgent` (`src/components/prototype/agentModel.ts:27-52`), and the separation of `workState`/`freshness`/`phase`/`toolKind` is the best thing in the contract. The mapping today:

- **Location:** `preferredDistrict` (`agentModel.ts:108-112`) + `targetDistrict` with 60 s dominance / 20 s dwell (`movement.ts:38-76`) → walk polyline (`Workers.tsx:130-150,311-339`). Truthful but laggy: HUD says Archive the moment `toolKind` flips, the figure arrives 4–10 s later.
- **Pose/gesture:** `gestureForWorker` (`movement.ts:252-281`) maps `phase`+`toolKind` → hammer/scroll/telescope/crate/banner/think/talk; stale→`sit`, historical→`idle`. `gap`/`idle`/`waiting`/`complete` all collapse to `idle`.
- **Ring:** `ringFor` (`movement.ts:294-304`) → 5 colors rendered in `Workers.tsx:460-463`. Selected overrides everything; `waiting`/`complete`/`unknown` all read `muted`.
- **Beam:** `showBeam = fresh + needs-input` (`Workers.tsx:428,465-484`), amber additive cylinder, slow pulse. Only city-scale alert channel.
- **District glow:** `glowCounts` = fresh+active only (`CourtyardScene.tsx:1182-1191`) → `DistrictWindows` emissive `0.35+0.3*min(3,n)` eased 1.5 s (`CourtyardScene.tsx:784-790`). District labels + navigator count *all* non-historical (`CourtyardScene.tsx:1172-1180`, `CourtyardHud.tsx:296-301`), so label can say "3 workers" while glow says 0. Confusing.
- **HUD/roster/inspector:** `cityCounts` (`scenarioBridge.ts:88-98`) → Working/Needs-you/Complete; roster lists all + Past (`CourtyardHud.tsx:135-200`); inspector `dl` shows provider/workspace/phase/tool/freshness (`CourtyardHud.tsx:86-95`); `assignmentLabel` = `phase · tool → District` (`CourtyardHud.tsx:49-53`); `nextAttentionCity` cycles snapshot order (`scenarioBridge.ts:109-114`, `prototype-main.tsx:173-176`).
- **Scenery (must never read as telemetry):** tram/boats/couriers/steam/dish/cranes on `useDrivenTime` (`CourtyardScene.tsx:65-76,477-706`); black hole reads nothing (`BlackHoleBackdrop.tsx:5-9`); `ShipBoat` fires on `shipCount` (`CourtyardScene.tsx:565-642`) — but `prototype-main.tsx:98` hardcodes `shipCount=0` in live mode, so the Port never ships live. Celebrations also sim-only (`prototype-main.tsx:88-89`).

Three biggest weaknesses:

1. **Most fields are text-only.** `model`, `role`, `workspace`, `startedAt`, `depth` (beyond 0.8× scale), `lastSignalAt` (beyond "3m ago") drive no 3D channel. `phase=gap`, `workState=waiting/complete/unknown` have no distinct channel. A 3 s glance learns only position + ring + beam.
2. **HUD repeats itself and buries urgency.** Counts, district labels, district navigator, `DistrictBar`, roster rows, and inspector all restate district+count. Inspector repeats `workspace` twice (`CourtyardHud.tsx:84,91`) and dumps raw enums. Needs-you is one cycling button with no wait-time ordering, no district beacon, no badge count on the button itself.
3. **No history, lossy overflow.** Only signal is `lastEvent: string` (`CourtyardHud.tsx:400`). `MAX_RENDERED_WORKERS=24` (`agentModel.ts:82`) silently drops overflow from 3D; leaving capped at 6 (`Workers.tsx:29`); historical vanishes. No last-hour view, no per-workspace cadence, no test pass/fail.

## 2. 10x vision

The city becomes a legible instrument: from across the room you read *where work concentrates* (district glow + crowd density), *who needs you* (amber beams + citadel steps queue, urgency-ordered), and *how long things have been stuck* (desaturation ramp + pulse rate), while the HUD reads like a mission log — four numbers, one history ribbon, one truth card per agent — every pixel traceable to a named `CityAgent` field, and every moving backdrop element visibly scenery.

## 3. Ranked moves

| # | Move | Impact | Effort | Perf cost | Data hook | Deps |
|---|------|--------|--------|-----------|-----------|------|
| 1 | **Frozen mapping table + on-screen legend.** Single `DATAMAP.md` table (signal→channel→why-truthful→degrade); HUD "How to read" popover mirrors it. Fixes glow-vs-label mismatch by defining label=assigned, glow=fresh-active. | 5 | S (~60 lines) | 0 draw calls; 1 HTML overlay | all `CityAgent` fields | HUD, scene |
| 2 | **Urgency-ranked Needs-You rail.** Sort `cityAttentionQueue` by `now-lastSignalAt` (longest waiter first); button shows live badge count; each district with needs-input gets a small beacon pylon; Citadel steps queue in wait order. Cycle button becomes list. | 5 | M (~150) | +1 instanced pylon set (6 instances); 0/frame React state | `workState`, `freshness`, `lastSignalAt` | agents, city |
| 3 | **Age + duration as ambient channels.** Ring pulse rate ← `phase` (tool=fast, thinking=slow, gap=still); figure desaturation ramp ← `now-lastSignalAt` (fresh→stale gradient, not a snap); work-spot halo arc ← `now-startedAt` (capped 30 min). All freeze under reduced-motion/paused. | 4 | M (~180) | 0 new draws (shader uniforms / per-instance color); ~0.1 ms CPU | `phase`, `lastSignalAt`, `startedAt`, `freshness` | agents, sky(frozen) |
| 4 | **History ribbon (last hour, no clutter).** Thin 2D canvas strip in HUD: per-minute ticks for ship/test/needs-input/arrival derived from snapshot diffs; hover scrubs text; district ghost glow = decaying 15 min average. 3D stays clean. | 4 | M (~200) | 1 tiny 2D canvas, redraw 1 Hz; 0 3D cost; ring buffer 60 entries | `toolKind`, `workState`, `lastSignalAt`, `startedAt` | HUD only |
| 5 | **Privacy-safe derived signals (opt-in contract extension).** `shipRate1h` (commit count per workspace from `git log --oneline` count only), `testVerdict` (pass/fail from exit code only), `turnRate` (events/min bucketed low/med/high from `token_count` presence, never text). Server-only derivation; scene maps: shipRate→boat frequency, verdict→observatory lamp green/red, turnRate→window shimmer rate. | 5 | L (~300 + server) | boat/lamp reuse existing meshes; shimmer via existing emissiveIntensity | new optional fields; raw prompts/commands never leave server | live-feed, scene |
| 6 | **Workspace + provider braid (no PII).** `workspace` (basename only, `agentModel.ts:43`) → small pennant color on the agent's ring slot + roster group header; `provider` → coat-trim hue family; `model` (if present) → hat badge shape, never text in 3D. Full strings stay in inspector/roster HTML. | 3 | S (~120) | per-instance color only; 0 new draws | `workspace`, `provider`, `model` | agents |
| 7 | **Inspector truth card.** Replace 8-row `dl` with 4 lines: Doing (`workState`+`phase`+`toolKind` in words) / Where+Why (district + dominance note) / Since (age + startedAt duration) / Next (needs-input action or "nothing needed"). Raw fields behind `<details>`. Remove duplicate workspace row. | 4 | S (~100) | HTML only | `workState`, `phase`, `toolKind`, `freshness`, `lastSignalAt`, `startedAt` | HUD |
| 8 | **Overflow honesty + roster filters.** District labels show "3 shown +2 more" when `selectRendered` overflows (`movement.ts:212-222`); roster groups by district with filter chips (Needs you / Active / Stale / Past). Cap stays 24. | 3 | S (~110) | HTML only | `freshness`, `workState`, `preferredDistrict` | HUD, movement |

Mapping-table excerpt (full table lives in move 1): `workState=needs-input → beam+citadel (truthful: explicit approval event; degrades to static beam)`; `toolKind → district (truthful: dominant 60 s window; degrades to last tool)`; `phase → gesture+pulse (truthful: live phase only; stale freezes)`; `freshness → saturation+pose (truthful: wall-clock age; degrades to muted sit)`; `parentId/depth → tether+scale (truthful: explicit spawn link only)`; tram/boats/couriers/steam/sky → scenery (never telemetry).

## 4. Signature moment

Night city, three amber beams up over the Citadel steps — the Needs-You rail open on the left showing "2 waiting · longest 6m", history ribbon below it with a green test tick and a white sail dot from ten minutes ago, district windows warm in Foundry where five fresh workers hammer, one grey seated figure in Archive mid-fade. You feel the on-call queue before you read a word.

## 5. Build sketch for the top 3 moves

**Move 1 — Mapping table + legend.** Technique: new `src/components/prototype/datamap.ts` exporting `MAPPING_ROWS: {signal, channel, truthful, degraded}[]`; HUD popover renders it; fix `CourtyardScene.tsx:1172-1191` so labels read "assigned (all non-historical)" and glow reads "fresh-active" with those exact captions. Files: new `datamap.ts` (~60), `CourtyardHud.tsx` +40 (popover), `CourtyardScene.tsx` +10 (captions). Pitfalls: don't rename contract fields; keep reduced-motion legend static; keep z-index above drei labels (`CourtyardHud.tsx` owns z-10).

**Move 2 — Needs-You rail.** Technique: change `cityAttentionQueue(agents, now)` to sort by `now-lastSignalAt` desc, tie-break id (`scenarioBridge.ts`); `Workers.tsx` adds `NeedBeacon` instanced pylons (6 boxes, emissive amber, visible iff district has needs-input); `CourtyardHud.tsx` replaces single button with listbox of queue (name + wait `formatSignalAge` exists line 55) + badge; Citadel slot order = queue order via `assignDistrictSlots` queue-first sort. Files: `scenarioBridge.ts` ~20, `Workers.tsx` ~70, `CourtyardHud.tsx` ~60. Rough 150 lines. Pitfalls: cap beacons at 6 draws; pulse via existing beam material, not new lights; `Escape` must still unwind agent→district→city (`prototype-main.tsx:141-153`); live + sim queues never mix.

**Move 3 — Age + duration channels.** Technique: per-frame (existing `Workers.tsx:286-415` loop, no new loop) compute `age01 = clamp((now-lastSignalAt-FRESH_MS)/(STALE_MS-FRESH_MS))` → lerp character material saturation via `color.lerp(grey)` on already-collected `runtime.mats`; ring pulse `opacity = base + amp*sin(t*rateFor(phase))` with `rateFor: tool=3 Hz, thinking=1 Hz, talking=1.5 Hz, gap/idle=0`; halo arc = `THREE.RingGeometry` theta-length `min(1,(now-startedAt)/30min)*2π` per work spot, one instanced set of 6. Freeze all when `paused||reducedMotion`. Files: `Workers.tsx` ~120, `movement.ts` ~20 (`rateForPhase`), `CourtyardScene.tsx` ~40 (halos). Pitfalls: reuse vectors/materials (no per-frame alloc); sealed-material path (`Workers.tsx:347-355`) must re-open when age changes; test with `lifecycle.test` + `movement.test` patterns; DPR cap 1.6 unchanged.

## 6. Cut list

- **Inspector duplicate workspace + raw-enum dump** (`CourtyardHud.tsx:84,91-94`): replace with truth card (move 7). Saves vertical space for bottom-sheet 40% cap.
- **Single-string event line as history** (`CourtyardHud.tsx:400`): demote to tooltip; history ribbon is the record.
- **DistrictBar worker chips duplicating roster** (`CourtyardHud.tsx:233-265`): keep only when district view is active; city view uses labels + roster.
- **Renderer details from default HUD** (`CourtyardHud.tsx:202-231`): keep behind `?debug=1` only — it is not agent information.
- **Per-district glow when count ≥3 saturates** (`CourtyardScene.tsx:786`): clamp is fine, remove any plan to add per-worker lights — 6 instanced glows already tell the story; extra point lights would blow the Air GPU budget.
- **Live `shipCount=0` stub** (`prototype-main.tsx:98`): either wire live ship events or hide the Port boat in live; a boat that never sails live is misinformation.

## 7. Sources

- Local contract and planners read in full: `agentModel.ts`, `movement.ts`, `lifecycle.ts`, `city.ts`, `Workers.tsx`, `CourtyardScene.tsx`, `CourtyardHud.tsx`, `prototype-main.tsx`, `scenarioBridge.ts`, `BlackHoleBackdrop.tsx`, `plans/001-living-cosmic-city.md`, `plans/002-living-agents.md`, `docs/courtyard-prototype.md`.
- three.js instancing + emissive workflow: https://threejs.org (examples: instancing, `InstancedMesh` color/lights budget) — basis for beacon/halo-as-instanced estimates.
- R3F per-frame discipline (no React state per frame, ref-driven loops): https://github.com/pmndrs/react-three-fiber — basis for age/pulse-in-existing-loop design.
- HUD/information-design direction (diegetic cues, urgency ordering, sparkline history, truth-card inspectors): game-HUD readability and dashboard-sparkline conventions applied to `CityAgent` fields; no copied assets, all channels procedural.
