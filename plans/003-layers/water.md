# Water — Harbor, Canals, Boats, Reflections (10x study)

## 1. Audit: what the layer does today

`src/components/prototype/CourtyardScene.tsx:231-296` (`Waterworks`) + `src/components/prototype/city.ts:59-91,317-345,374-380`:

- Harbor: one flat `planeGeometry` 36×54 at `HARBOR (-60,51)` (`city.ts:62-68`), `meshStandardMaterial #123a45, roughness 0.25, metalness 0.35, emissive #0a2730×0.6`. Canals: 3 rotated boxes (`CANAL_WIDTH 8`, height 0.18) along `CANAL_POINTS [-42,36]→[26,-16]`. Two quay walls (gray boxes), 4 identical piers at `x=-52, z=32/44/56/68` (`w20×d4`), 2 bridges (`span 14`, deck at `y3.0`).
- Boats: `Boats():519-557` — 3 box-hull boats (`2.2×0.9×5 #5a4a38` + cabin `#33465a`) ping-ponging canal/harbor `BOAT_ROUTES` on periods 54/62/46 s. `ShipBoat():565-642` — one-shot Port departure `DOCK [-54,44]→EXIT [-69,58]` over 9 s with fade, driven by `shipCount` (`src/prototype-main.tsx:98`: `isLive ? 0 : state.ships.length`; `scenario.ts:230-254` pushes `ships` on `step.ship`).
- Context: 160×160 ground `#141a22` at y0, fog `#0b1220 170-340`, DPR `[1,1.6]` (`CourtyardScene.tsx:32,1211,1313`); `BlackHoleBackdrop.tsx:1-9` is decorative and reads no telemetry.

Three biggest weaknesses:

1. **Dead plastic water.** Flat color + constant emissive, no vertex waves, no normal perturbation, no flow direction. At city view it reads as painted concrete, not the "jade-blue canals" promised in `plans/001-living-cosmic-city.md:25`. Canal boxes visibly clip banks (`city.ts:212` carve) with hard 90° edges and no foam/ao seam.
2. **Zero city-to-water light transport.** Lamps (`Lamps():708`), district window glow (`DistrictWindows():776`), Citadel crowns, needs-you beam (`Workers.tsx:464-469`), and black-hole arch all emit — water reflects none of it. Harbor feels detached from the night city; the most legible night-water cue (long vertical glitter streaks) is missing.
3. **Meaningless boat traffic.** Hulls are unlit boxes with no bob, roll, wake, or bow foam; ping-pong reversal (`CourtyardScene.tsx:532-538`) teleports heading mid-channel. `ShipBoat` is the only truthful beat, but it is simulation-only (`shipCount=0` in live, `prototype-main.tsx:98`) and fades out instead of arriving anywhere. No moored/idle state, so every boat always moves — pure scenery masquerading as activity.

## 2. 10x vision

Midnight jade mirror: the harbor and canals become one dark, barely-moving sheet that catches the city — amber lamp glitter paths, per-district window color bleeding at quay edges, a single violet smear from the black hole, and one trembling amber pillar whenever the needs-you beam burns — while two low workboats breathe with the swell and a lone ship-ritual freighter slides out of the Port only when someone actually ships; from the default overview the water is stillness that proves the city is awake.

## 3. Ranked moves

Verdict on the focus question: **gradient + dual-scrolled procedural normals + fake streak sprites wins beauty/ms on integrated GPU.** Full planar `Reflector` doubles draw calls and re-renders 80 buildings; three.js `Water` (planar reflection + flowmap) costs ~1 extra scene pass + large normal texture; SSR needs a post pass. Fake glitter costs ~+2 draw calls and one cheap fragment addition.

1. **Jade-mirror water shader (replace StandardMaterial).** Custom `ShaderMaterial` (fog-aware): deep gradient by view fresnel, 2 scrolling procedural normal octaves (hash-based value noise, no texture), analytic specular from 1 dir light + 3 fake point glints, subtle 0.15-unit vertex swell (16×16 segments harbor, 8×32 canal). Impact 5, Effort M, Perf ~+2 draw calls total (merge canals into 1 geometry), ~30 ALU frag, 0 textures, degrades to flat color + frozen normals on low tier. Data: scenery. Deps: lighting (light dirs/colors), sky (hole tint as uniform only).
2. **Fake glitter streaks for real activity.** Instanced additive vertical streak quads (width 0.6–1.2, length 6–14, `depthWrite:false`) laid on water under: quay lamps, Port/Foundry window spill, Citadel crown spill, and one amber streak under the active needs-you beam. Opacity driven per-frame from existing counts. Impact 5, Effort S, Perf 1 instanced draw (~40 instances), trivial shader, degrade: hide streaks beyond city view / halve count. Data: `CityAgent.workState==='needs-input'` count + position (beam streak), `freshness==='fresh' && workState==='active'` per-district counts (spill brightness), `toolKind` district color; static lamp streaks are scenery. Deps: agents (beam position API), lighting (lamp palette), datamap (district colors).
3. **Ship ritual 2.0 — the only boat that means something.** Upgrade `ShipBoat` hull to low-poly freighter (hull + 3 emissive containers + mast light), add wake ribbon + horn-light pulse, quay lamp chase on departure, keep 9 s sail but arrive-then-fade behind pier instead of mid-water vanish. Fix live mode: derive queue from real `toolKind==='ship'` transitions, not `state.ships`. Impact 5, Effort M, Perf +3 draws during 9 s only, degrade: reuse current box hull. Data: `CityAgent.toolKind==='ship'` transition (one shot per agent id, as today); nothing sails otherwise. Deps: agents/experience (ship-event contract), streets/piers (dock keep-clear).
4. **Wakes, bow foam, hull motion.** Per-boat trailing ribbon (12-segment fading quad strip, one instanced mesh for all boats) + small bow foam sprite; hulls bob/roll from same `uTime` as water shader (`y=sin(t*0.9+phase)*0.08`, `roll=sin(t*0.7)*0.03`). Impact 4, Effort S, Perf 2 draws, ~200 tris, degrade: hide wakes on low tier, keep bob static under reduced-motion. Data: scenery (wake is physics, never telemetry). Deps: none (reads boat matrices already computed).
5. **Quay foam seams + canal banks.** Thin animated foam ribbons (extruded strips along `HARBOR` edges + `CANAL_POINTS` offset ±4.2) with scrolling alpha noise in the water shader family; dark AO gradient under piers/bridges baked into vertex colors. Kills the concrete-edge look. Impact 4, Effort S, Perf +2 draws, degrade: static opacity. Data: scenery. Deps: architecture (pier/bridge footprints).
6. **Moored truthfulness pass.** Keep 1 ambient harbor ferry (clearly scenery, slow loop) + 1–2 moored hulls at piers; canal routes become event-gated: boats wait docked and only traverse when their district has `fresh` workers, else stay moored with riding-light on. Stops constant fake traffic. Impact 4, Effort M, Perf same draws, fewer matrix updates, degrade: all moored on low tier. Data: `freshness` per-district presence gates departure; moored = `historical`/empty. Deps: agents (presence helper), experience (label "harbor ferry — scenery").
7. **Black-hole violet smear.** One long faint additive streak on harbor aligned to `BLACK_HOLE_DIRECTION` (`CourtyardScene.tsx:42`), color sampled from sky disk (`#8a9fd0`-violet), static except shimmer. Gives sky-to-water anchor for free. Impact 3, Effort S, Perf 1 draw, degrade: drop first. Data: scenery. Deps: sky (direction/color uniforms only, no activity coupling).
8. **Buoys + pier riding lights.** 6 instanced buoys (cone + emissive tip) bobbing on harbor lane, warm tips near piers, one violet tip on the exit channel; blink is slow sine scenery, never encodes agents. Impact 3, Effort S, Perf 1 instanced draw, degrade: static on reduced-motion. Data: scenery. Deps: lighting (emissive palette cap).

Reduced-motion for all: freeze `uTime` at still value (as `BlackHoleBackdrop.tsx:175-177` does), wakes hidden, boats snapped to dock/moored, streaks static — scene stays fully legible.

## 4. Signature moment

City view at night, camera low over the southwest: the harbor holds a trembling amber pillar from the Citadel needs-you beam, lamp glitter ladders run off both quays, the black hole's violet smear cuts between them — and a tiny lit freighter with a white wake slides out of the Port under the rail bridge while everything else sleeps. One still frame tells you: someone needs you, and someone just shipped.

## 5. Build sketch for the top 3 moves

**A. Jade-mirror shader.** Technique: replace harbor plane + 3 canal boxes with one merged `PlaneGeometry` set (harbor 24×24 seg, canals 8×40) sharing a `ShaderMaterial` with fog; vertex: `pos.y += sin(worldXZ·k + uTime)·0.12`; fragment: `n = noise(uv·s1+t·v1)+noise(uv·s2−t·v2)`, `fres = pow(1−dot(V,N),3)`, `col = mix(deep #0a1e26, sky #16293a, fres) + spec(dirLight)·glitter + districtSpill(uSpillRGB)`. Include `fog_pars` chunks. Files: `CourtyardScene.tsx` (`Waterworks`), new `waterMaterial.ts` (~180 LOC), `city.ts` (export water edge polylines, ~20 LOC). Pitfalls: ShaderMaterial ignores scene lights/fog unless added — copy `fogFragment` pattern from three `Water`; keep `transparent:false` to avoid sort bugs with streaks; clamp DPR already at 1.6.

**B. Glitter streaks.** Technique: one `InstancedMesh` of `PlaneGeometry(1,1)` rotated flat, additive `MeshBasicMaterial` with procedural vertical-gradient alpha map from `CanvasTexture` (64×256, generated once), per-instance color via `instanceColor`; per-frame CPU updates only opacity scale from `glowCounts` + beam position prop (no per-frame alloc — reuse `Object3D` dummy as `Rail():477` does). ~120 LOC in new `WaterGlitter.tsx` + 15 LOC to thread `beamPos` from `Workers`. Pitfalls: additive over dark water blows out — cap opacity 0.35, lengthen don't brighten; set `renderOrder=2, depthWrite:false`; under reduced-motion skip updates entirely.

**C. Ship ritual 2.0.** Technique: keep `ShipBoat` queue logic (`CourtyardScene.tsx:565-577`) but source queue from a `useEffect` diffing `agents` for `toolKind==='ship'` fresh transitions (keyed `id`, as celebrations are in `prototype-main.tsx:88-97`); hull group gains container boxes colored by `provider` (Codex teal / Claude orange / OpenCode blue — read-only display, owned by agents layer), mast `PointLight` intensity pulse on sail start, wake ribbon child toggled visible only while `sailing`. Fix exit: sail `DOCK→behind pier tip→EXIT` so fade happens occluded. ~150 LOC edits + 40 LOC wake. Pitfalls: live-mode double-fire on snapshot re-delivery — key by `id+lastSignalAt`; don't sail while `paused`/reduced-motion (hold docked, as today `591-599`); keep sail on local `useDrivenTime` clock so pause freezes mid-sail.

## 6. Cut list

- Remove `meshStandardMaterial` water (flat teal + fake metalness) — replaced by (1).
- Remove 2nd/3rd canal ambient boats always looping; keep 1 harbor ferry + moored hulls + event ship — cuts fake-traffic reads and 2 matrix updates/frame.
- Remove mid-channel fade-out; fade only behind pier / out of harbor mouth.
- Don't add `three/examples Water.js` + `Reflector`: ~100 KB + full second scene render per frame, overkill for 36×54 harbor at this camera distance; revisit only if discrete GPU tier is added.
- Don't add real-time planar reflection, SSR pass, or canvas-generated normal textures — procedural noise in-shader is enough and has zero memory.

## 7. Sources

- three.js docs — `Reflector` (why planar costs a second pass): https://threejs.org/docs/#examples/en/objects/Reflector
- three.js docs — `Water` / `WaterMesh` (planar + flowmap reference, and why we skip it): https://threejs.org/docs/#examples/en/objects/Water
- three.js example `webgl_mirror` (Reflector usage/perf baseline): https://threejs.org/examples/#webgl_mirror
- three.js example `webgl_water` (Water.js cost baseline): https://threejs.org/examples/#webgl_water
- three.js docs — `InstancedMesh` + `instanceColor` (streak/buoy batching): https://threejs.org/docs/#api/en/objects/InstancedMesh
- Repo truth: `CourtyardScene.tsx:231-296,519-642`, `city.ts:59-91,317-380`, `prototype-main.tsx:88-98`, `BlackHoleBackdrop.tsx:1-9`, `plans/001-living-cosmic-city.md:25-27`, `docs/courtyard-prototype.md:70-71,104-106`
