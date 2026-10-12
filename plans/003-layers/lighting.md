# Lighting, Materials & Render Pipeline — 10x Study

## 1. Audit: what the layer does today

The rig is a classic three-light night setup in `src/components/prototype/CourtyardScene.tsx:1210-1228`: `background #05070f`, linear `fog #0b1220 170-340`, `ambientLight 0.72 #aebccd` + `hemisphereLight 0.85`, one warm `directionalLight 2.2 #ffd9a2` at `[60,90,40]` with `2048` shadowmap, `80px` ortho box, `bias -0.0005`. Canvas is `shadows, dpr [1,1.6], antialias:true, high-performance` (`CourtyardScene.tsx:32-33,1311-1315`).

Materials are almost all `meshStandardMaterial` with high roughness (`0.88-1.0`) and low metalness (`0.05-0.12`): building layers white-base + instance color (`CourtyardScene.tsx:813-829`), roofcaps `#2f3742` / spires `#4a5666` (`830-843`), ground `#141a22 roughness 1` (`1232-1235`), streets `#1b2028/#262d38` (`212-229`), water `#123a45 emissive #0a2730 x0.6` (`231-243`).

Emissive is scattered, ungraded, unbloomed: `DistrictWindows` base `0.4`, animated `0.35+0.3*min(3,counts)` (`776-810`, counts=`fresh+active` at `1182-1191`); lamps `1.6` / plaza lamps `1.4` (`708-766`); Citadel bands `0.42`, crown rings `2.0` (`326-349`); foundry caps `1.1` (`376-380`); forge/candle/signal `pointLight intensity 7/4/4 distance 6-8` (`929,991,1051`); portal `emissive 0.8 opacity 0.35` (`467-470`); tram/boat `emissive 0.5`, flames/steam `meshBasicMaterial depthWrite:false` (`898-907,700-706`); needs-you beam additive `fog:false` (`464-484`). Tone mapping is R3F default (ACES) with no explicit exposure/grading; there is no `EffectComposer`, bloom, AO, vignette, grain, or height fog. Shadows: most meshes `receiveShadow`, few `castShadow` (characters, stations, tram/boats), so the 2048 map over a 160 m plane is soft and cheap but blobby.

**Weakness 1 — No bloom / tone shaping, so night does not glow.** Dozens of emissives (windows, lamps, crowns, beams) clip to flat pastel because nothing exceeds threshold into halation and nothing rolls off highlights. Biggest mood loss for least GPU cost.
**Weakness 2 — Flat wash + wrong fog + wasteful lights.** Ambient+hemi `~1.57` total flattens midnight contrast; linear distance fog cannot do harbor haze vs. rooftop clarity; 3+ forward `pointLight`s per station scale badly with 24 workers; 2048 shadow over the whole city gives ~8 cm/texel mush.
**Weakness 3 — No frame budget or adaptive quality.** DPR is a static range, `antialias:true` always on, no `PerformanceMonitor`/tiers/fallback. A MacBook Air will drop frames at city view (80 buildings, ~30 instanced draws + shadow + workers) with no graceful path.

## 2. 10x vision

Midnight harbor noir with amber heart and jade-blue breath: crushed inky shadows, warm window/crown/forge halation that pulses with real work, cool moon-rim on roofs, low canal mist and volumetric-feeling lamp cones, the black-hole sky clean above — a Blade-Runner postcard where every glow is either truthful telemetry or legibly scenery, holding 60 fps on integrated silicon.

## 3. Ranked moves

**M1 — Lock ACES + exposure + night LUT/grade (single biggest mood jump).** Impact 5, Effort S, Perf ~0.1 ms fullscreen LUT, Data: scenery (grade) + `fresh/active` count scales window warmth, Dependencies: none (inform sky of new sky-ground blend).
**M2 — Selective threshold bloom (luminance-gated, half-res).** Impact 5, Effort M, Perf ~1.5-2.5 ms @1.5 DPR half-res, degrades to quarter-res/off, Data: `workState needs-input` (beam), `fresh+active` (windows), `phase tool/talking` (props/glow), Dependencies: agents (keep emissiveIntensity conventions), camera (don't bloom HUD `Html`).
**M3 — Height + distance fog with harbor haze.** Impact 4, Effort M, Perf ~0.3 ms (fog in-shader, 1 transparent haze plane), Data: scenery, Dependencies: city layout (canal/harbor bounds), sky (match horizon color).
**M4 — Retune light rig + shadow diet.** Impact 4, Effort S, Perf saves ~1-2 ms, Data: scenery, Dependencies: city/agents (which meshes cast).
**M5 — Emissive atlas + per-district color temp, sprite cones replace pointLights.** Impact 4, Effort M, Perf saves forward-light cost, +0.2 ms sprites, Data: `toolKind→district`, `freshness`, `workState`, Dependencies: agents + city dressing.
**M6 — Frame budget + adaptive DPR + 3 quality tiers + monitor.** Impact 4, Effort M, Perf controller (saves 3-6 ms under load), Data: scenery (fps/DPR), Dependencies: HUD (debug stats), camera.
**M7 — Fake AO/contact: blob discs + podium gradient, skip SSAO/GTAO.** Impact 3, Effort S, Perf ~0.2 ms (instanced discs), Data: scenery, Dependencies: city layout.
**M8 — Final vignette + grain + subtle chromatic fringe, motion-safe.** Impact 3, Effort S, Perf ~0.3 ms merged in bloom grade pass, Data: scenery, Dependencies: accessibility (off under `prefers-reduced-motion`).

Frame budget (MacBook Air, 60 fps = 16.6 ms): JS update 2-3 ms, main opaque 6-8 ms, shadow 1-2 ms, bloom half-res 1.5-2.5 ms, grade/vignette/grain 0.4 ms, reserve 2-3 ms. Stay inside via DPR `1.0-1.65` adaptive, shadow 2048→1024, bloom half→quarter→off, `antialias:false` when composer is on (composer does its own AA).

On `postprocessing` vs hand-rolled: `postprocessing` (~90 kB gz) + `@react-three/postprocessing` (~30 kB) earn it — single-triangle passes, merged `EffectPass`, HalfFloat HDR, `ToneMappingEffect`, `BloomEffect(mipmapBlur)`, `VignetteEffect`, `NoiseEffect` in ~15 lines. No-dependency alternative is `three/addons` `EffectComposer+UnrealBloomPass+OutputPass` (~60 kB already in three, 3 passes, slower). Do not add SSAO/GTAO/DoF: 2-4 ms each on Air, not worth it; blob AO + fog gives 80% of depth.

## 4. Signature moment

City view at night after a deploy wave: Foundry chimneys breathing orange, amber windows bloomed per-district with Citadel crown flaring where `needs-input` waits, jade canal mist under the rail loop, the tall amber beam diffused into bloom above the Citadel steps — black hole crisp in a clean sky band. One frame tells you where work burns.

## 5. Build sketch for the top 3 moves

**M1 — Grade:** technique: set `gl.toneMapping=ACESFilmic, exposure 1.05-1.15` on `Canvas onCreated`; append `ToneMappingEffect+LUTCube/ColorAverage+BrightnessContrast` as last `EffectPass`; lift blacks `#05070f`, cool shadows, warm mids. Files: `CourtyardScene.tsx` (~30 lines: Canvas props + `<EffectComposer>` block), new `src/components/prototype/grade.ts` (~40 lines LUT). Pitfalls: double tone-map (set renderer to `NoToneMapping` when composer owns it); `Html` labels must stay outside composer; test paused/reduced-motion still grades identically.

**M2 — Selective bloom:** technique: `EffectComposer HalfFloatType` + `BloomEffect({mipmapBlur, luminanceThreshold:1.0, luminanceSmoothing:0.2, intensity:0.6-0.9})`; push key emissives above 1 (`windows 1.2-2.2`, crowns `2.5`, beams additive) and keep lit diffuse below 1; half-res, `resolutionScale 0.5`. Files: `CourtyardScene.tsx` (~25 lines), `DistrictWindows` + `Lamps/Citadel` emissive bumps (~20 lines). LOC ~60. Pitfalls: whole-scene wash if threshold <0.8; MSAA off — rely on composer SMAA; `fog:false` beams must stay bright; gate intensity by `reducedMotion` (static lower value).

**M3 — Height fog:** technique: keep linear `Fog` for depth cue, add `FogExp2`-style height term via `onBeforeCompile` on ground/building materials OR one additive canal-haze plane + lamp cone sprites; uniform `uHaze` by camera height. Files: `CourtyardScene.tsx` + new `haze.tsx` (~80 lines), `city.ts` bounds reuse. Pitfalls: transparent sorting with steam/flames — set `depthWrite:false, renderOrder`; don't fog the sky shader (`fog:false` already); keep harbor haze subtle or Port reads as smoke.

## 6. Cut list

- Remove per-station `pointLight`s (3× intensity 4-7); replace with one emissive sprite cone each — same warmth, no forward-light scaling.
- Drop `antialias:true` once composer is on; drop 2048 shadows to 1024 with tightened `±60` box and `castShadow` only on characters/stations/landmarks (background instancing receives only).
- Do not add SSAO/GTAO, DoF, SSR, or real volumetrics; cut `Steam` sphere segments `6x5` to billboard planes if over budget; cut chimney-cap emissive instances to one shared material (already shared — keep it).
- Cut linear-fog-only look; cut white-base building color jitter wider than current district palettes — grade handles variety.

## 7. Sources

- https://threejs.org/examples/#webgl_postprocessing_unreal_bloom — threshold/mipmap bloom reference.
- https://threejs.org/docs/#api/en/renderers/WebGLRenderer.toneMapping — ACES/NoToneMapping with composer rule.
- https://github.com/pmndrs/postprocessing — EffectPass merging, HalfFloat HDR, ToneMapping/Bloom/Vignette effects, single-triangle passes.
- three.js `Fog`, `FogExp2`, `UnrealBloomPass`, `OutputPass` docs (addons/postprocessing index) — fog vs height-haze tradeoffs.
- `src/components/prototype/CourtyardScene.tsx`, `src/components/prototype/city.ts`, `src/components/prototype/agentModel.ts`, `plans/001-living-cosmic-city.md`, `plans/002-living-agents.md`, `docs/courtyard-prototype.md` — audit ground truth.
