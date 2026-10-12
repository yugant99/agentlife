# Streets & Ground Plane — 10x Layer Study

## 1. Audit

What the layer is today (all instanced boxes, no textures, all motion on a pausable local clock):

- **Ground:** one 160×160 plane at y=0, `#141a22`, roughness 1 (`CourtyardScene.tsx:1232-1235`). Flat color, no noise, no curb/trim, no district variation.
- **Roads:** `Streets()` draws two `Instances` groups — plain `#1b2028`, lit `#262d38` (`CourtyardScene.tsx:212-229`) — from `ROADS` in `city.ts:298-310`: 10-unit grid over `STREET_GRID`, `len: 9`, `wide: 4.4` (6.5 on the x=0/z=0 boulevards), y=0.05, h=0.1. No intersections, sidewalks, curbs, center lines, crosswalks, or signage anywhere.
- **Lamps:** `Lamps()` (`CourtyardScene.tsx:708-723`) instances poles + emissive bulbs (`emissiveIntensity 1.6`) from `LAMPS` in `city.ts:313-315` — two single lines along x=2.8 / z=2.8 only. No real lights, no ground pools; at night they read as floating dots.
- **Plazas:** `Plazas()` (`CourtyardScene.tsx:727-769`) lays flat paving discs (r=15 `PLAZA_PAVING_RADIUS`, r=10 `SPOT_PAVING_RADIUS`, `city.ts:386-395`), 16 railings/plaza with gaps, 3 cone trees + 2 lamps per plaza (`city.ts:396-408`). Dressing is identical in every district.
- **Bridges/piers:** `Waterworks()` (`CourtyardScene.tsx:260-293`, `BRIDGES` at `city.ts:338-341`) — two raised decks with rails and shore approaches; fine, but decks have no road paint tying them to the street grid.
- **Tram:** `Rail()` (`CourtyardScene.tsx:477-517`) — `TubeGeometry(curve, 240, 0.22)` on a squircle loop (`RAIL_POINTS`, `city.ts:348-359`), 18 pillars, 3 instanced box cars looping in ~35 s (`time.current / 35`). Pure clock scenery.
- **Couriers:** `Couriers()` (`CourtyardScene.tsx:644-675`) — 8 instanced boxes on 4 ping-pong segments (`COURIER_ROUTES`, `city.ts:367-372`). Pure clock scenery.
- **Truthful exception:** `ShipBoat()` (`CourtyardScene.tsx:565-642`) sails once per ship event (`shipCount` from `prototype-main.tsx:98`). This is the only vehicle that encodes a `CityAgent` signal.
- **Walkers vs. streets:** workers walk `cityGraph.ts` polylines (Dijkstra over ~120 intersections, `buildRoadGraph:135-181`, footprint guards `isWalkable:91-97` / `isSegmentWalkable:104-114`) via the `Workers.tsx:286-415` frame loop — but the street mesh never responds. No path highlight, no footstep light, no intersection pulse.

**Three biggest weaknesses:**

1. **The ground is not a place.** One flat color + two grey road tints at every zoom; no hierarchy (boulevard vs. side street vs. plaza), no materiality (asphalt/stone/wet), no district identity. A 3-second glance learns nothing about where agents are.
2. **Walks leave no trace.** The most meaningful motion in the scene (a worker changing districts on a real `toolKind`/`workState` change) is invisible at city scale — streets stay the same grey whether 0 or 12 workers are walking them.
3. **Traffic looks like telemetry but isn't.** Tram and couriers move constantly on clocks while meaning nothing, next to the one vehicle that does mean something (ship boat). No legend or visual language separates the two, which violates the truthfulness rule and invites misreading.

## 2. 10x vision

Wet midnight basalt with an amber nervous system: boulevards read as glowing routes, side streets fall dark, and every walking worker pulls a short ribbon of light along the road beneath it that fades as its signal ages — so the city's circulation *is* the telemetry. District corners get stone curbs and crosswalk inlays tinted to their landmark (copper Foundry, jade Archive, ice Observatory), lamps throw soft fake pools instead of floating bulbs, and the tram reads unmistakably as census (lit cars = working sessions) against dim parked couriers that only run handoffs. Still frame, still legible.

## 3. Ranked moves

| # | Move | Impact / Effort | Perf cost | Data hook | Dependencies |
|---|------|----------------|-----------|-----------|--------------|
| 1 | **Walk-ribbons:** emissive ribbon decals under each moving worker's remaining `cityGraph` polyline (one instanced quad-strip per walker, additive, color = `ringFor()` color, opacity ∝ `freshness`) | 5 / M | +24 draw-call-free instances, 1 additive material, ~24×40 quads; degrades to status rings only | `CityAgent.workState`, `freshness`, `phase`, `toolKind` (via `targetDistrict`/`ringFor` in `movement.ts:252-304`) | Agents (ring palette), Lighting (ribbon brightness budget) |
| 2 | **Footstep pools:** soft additive disc under every walking worker, pulsing at stride freq, same color as its ring | 4 / S | 1 instanced circle geom (24), near-zero shader cost; static disc under reduced motion | `freshness` + `phase` (moving flag from `Workers.tsx`); scenery when paused | Agents (stride freq), Experience (legend entry) |
| 3 | **Tram = census:** visible lit cars = `min(workingFreshCount, 5)`, dim/unlit spares parked; car emissive color = majority provider accent | 5 / S | Same 3–5 instances, no new geometry; degrades to fixed 3 cars | `CityAgent.freshness==='fresh'` + `workState==='active'` count; `provider` for tint | Datamap (count definition), HUD legend |
| 4 | **Couriers = handoffs, else parked:** couriers park dim at plazas; on a `delegate` spawn event one runs the parent→child district leg once, lit amber, then re-parks | 4 / M | Same 8 instances; one `useFrame` reroute, no alloc | `CityAgent.toolKind==='delegate'` + `parentId`/`depth`; else scenery | Agents (spawn event), Experience (legend: "amber = telemetry") |
| 5 | **Street hierarchy pass:** boulevard vs. side-street materials (roughness/tint split already in `ROADS.lit`), instanced center dashes, crosswalk stripes + stone curbs at ~40 core intersections, district-tinted corner inlays | 4 / M | +4 instanced meshes (~300 small quads/boxes total), all static; degrades by hiding dashes first | Scenery | Architecture (curb vs. building palette), Lighting (emissive budget) |
| 6 | **Lamp pools + 3 real lights:** fake radial-gradient blob decals under every lamp (one instanced plane, `depthWrite:false`), plus exactly 3 `PointLight`s (Forge / Planning / Signal plazas, dist 6–8) so worker figures catch warm rims | 3 / S | 1 instanced decal mesh (~30 quads); 3 point lights, no shadows; lights off first on low tier | Scenery | Lighting (light budget owns the 3) |
| 7 | **Ground material pass:** `onBeforeCompile` asphalt noise + wet-streak roughness variation on the base plane, stone trim ring along canal/harbor edges, per-plaza canvas-generated mosaic sigil (procedural, no assets) | 3 / M | 1 shader chunk on 1 material, ~128px canvas textures ×6; falls back to flat color | Scenery | Sky/Water (canal edge meets water trim) |
| 8 | **Totem signage at plaza gaps:** slim instanced pylons at the existing railing gaps (`city.ts:403`, `i % 5 === 0`), emissive district glyph strip + worker-count pips (0–6 dots mirror the ring colors present) | 3 / M | ~6 pylons + 1 instanced pip mesh (36); static except pip color updates on reconcile, not per frame | `preferredDistrict` counts (same map as `DistrictLabel`); pips mirror `ringFor` | Agents (count source of truth), HUD (label copy must match) |

Truthfulness label (moves 3–4 + HUD): lit/amber vehicles = telemetry, dim steady vehicles = scenery. A one-line HUD legend plus matching dim-vs-lit treatment makes the split readable at city scale without tooltips.

## 4. Signature moment

City view after a burst of tool changes: five walk-ribbons in ring colors (amber needs-input, teal active-tool, ice thinking) converge on the Foundry boulevard from three districts, footstep pools strobing softly under each figure, while the tram crosses overhead with four lit cars and a single amber courier sprints a handoff leg below it. Screenshot = the city's circulation thinking.

## 5. Build sketch for the top 3 moves

**M1 — Walk-ribbons.** Technique: per-walker ribbon from the runtime's remaining route. In `Workers.tsx` the reconciler already holds `runtime.route: [x,z][]` and `runtime.moving`; each frame write those points into a preallocated instanced quad-strip (fixed 40 segments × 24 walkers = 960 quads, `setDrawRange` per walker length). Material: `meshBasicMaterial` additive, vertex-color = ring color, opacity per-instance via `instanceColor` alpha trick (or two overlapping strips for fade). Lay flat at y=0.12 above roads, width 1.2, with round-cap head quad at worker pos. Reduced motion / pause: hide ribbons, keep rings. Files: `city.ts` (+`RIBBON_*` consts), `Workers.tsx` (ribbon writer inside existing `useFrame`), `CourtyardScene.tsx` (mount `<WalkRibbons/>`). ~180 LOC. Pitfalls: route arrays mutate mid-frame — copy lengths first; z-fighting with roads — use `polygonOffset` + fixed y; color must reuse `RING_COLORS` exactly or legend lies.

**M2 — Footstep pools.** Technique: one `instancedMesh` of 24 radial-gradient discs (procedural `CanvasTexture`, 128px, `transparent`, `depthWrite:false`, additive). Per frame set matrix = worker xz (y=0.13), scale = 1.6 + 0.3·sin(stride), color = `RING_COLORS[ringFor(agent)]`. Stride freq reuses `STEP_FREQ=7` from `CourtyardCharacter.tsx:25`. Static under reduced motion (scale frozen, opacity 0.5). Files: `Workers.tsx` (disc writer next to tether writer `391-414`), one new `footstepTexture.ts` (~30 LOC). ~90 LOC total. Pitfalls: additive over bright plazas blows out — clamp opacity ≤0.35; don't allocate `Object3D` per frame (reuse the existing `dummy` pattern from `Couriers:647`).

**M3 — Tram = census.** Technique: keep `Rail()` geometry; drive car count/paint from props. `prototype-main.tsx` already computes `agents`; pass `workingFresh = agents.filter(fresh && active).length` and `majorityProvider` into `CourtyardWorld` → `Rail`. Cars: `TOTAL=5` instances, `visible = min(5, max(1, workingFresh))` lit (emissive 0.5, provider tint), remainder parked dim at the Gateway siding (precomputed offset points, emissive 0.05). Update only in the reconciler tick (500 ms), never per frame. Reduced motion: same counts, static positions. Files: `CourtyardScene.tsx` (`Rail` props + siding consts), `prototype-main.tsx` (count derivation, ~15 LOC), `CourtyardHud.tsx` (legend line). ~110 LOC. Pitfalls: provider tint must come from the agents layer's canonical palette, not a new one; count definition must match the HUD "Working" count (`cityCounts`) or the scene contradicts the roster; cap at 5 so the loop never looks empty or overflows the curve spacing (existing `car * 6 / length` spacing in `Rail:490` generalizes to `car * length / visible`).

## 6. Cut list

- **Remove the `lit` vs. `plain` two-tint road split as meaning:** today `lit` only means "on the x=0/z=0 axes" (`city.ts:303,308`) and reads as noise. Fold into the hierarchy pass (M5) or delete one group — saves 1 draw call and a confusing legend entry.
- **Remove per-plaza cone trees (18 identical cones, `Plazas:752-756`):** they fight the district landmarks at every zoom and cost silhouette clarity. Keep at most the Citadel pair; let Architecture own planting.
- **Simplify rail pillars:** 18 full-height boxes (`Rail:506-510`) → slimmer profile or every-8th placement outside the core; pillars currently pop through sightlines to work spots.
- **Cap `TubeGeometry` segments 240 → 128:** the squircle loop is smooth long before 240; saves ~3k triangles for zero visual change on an Air.
- **Delete the second plaza lamp ring (`PLAZA_LAMPS`, `Plazas:757-766`):** redundant with street lamps 10 units away; the 3 real lights in M6 replace a dozen fake bulbs.

## 7. Sources

- three.js docs — InstancedMesh / `instanceColor` (`threejs.org/docs`), `TubeGeometry` + `CatmullRomCurve3` pages; three.js examples index (`threejs.org/examples`) — instancing + ribbon/trail patterns.
- React Three Fiber docs — `useFrame` reuse/no-alloc guidance, `<Instances>` / `<Instance>` from drei (`docs.pmnd.rs/react-three-fiber`, `github.com/pmndrs/drei`).
- three.js Journey / Discover Three.js tips-and-tricks chapters — fake light blobs (`depthWrite:false` additive decals) vs. real light budgets on integrated GPUs.
- Repo ground truth: `src/components/prototype/CourtyardScene.tsx` (Streets 212-229, Rail 477-517, Couriers 644-675, Lamps 708-723, Plazas 727-769, ground 1232-1235), `city.ts` (ROADS 298-310, LAMPS 313-315, RAIL 348-359, COURIER 367-372, paving 386-408), `cityGraph.ts` (walkability 91-114, Dijkstra 196-229), `movement.ts` (rings/gestures 242-304), `agentModel.ts` (`TOOL_DISTRICT`, freshness windows), `docs/courtyard-prototype.md`, `plans/001-living-cosmic-city.md`, `plans/002-living-agents.md`.
- Note: web search was unavailable in this session (search tool returned `cancelled`), so technique choices lean on the three.js/R3F docs above and in-repo conventions rather than fresh shader write-ups; the merger should re-verify ribbon/decals against one current three.js trail example before build.
