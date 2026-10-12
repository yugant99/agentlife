# Mythic City — Architecture (buildings + landmarks)

## 1. Audit

Today the layer is a deterministic lattice of ~80 composed boxes built once in `src/components/prototype/city.ts:206-284` and drawn as 3 instanced box layers (podium/main/upper) plus instanced roof caps and 5-sided spire cones in `src/components/prototype/CourtyardScene.tsx:813-846` (~11 draw calls total incl. windows). Palettes per district live in `city.ts:120-127`, height ranges in `city.ts:128-135`, sparse facade windows in `city.ts:257-282` (top part only, ≤10 panels, ~45% kept, 0.85×0.7 units), district glow in `CourtyardScene.tsx:776-811` (one `Instances` per district, `emissiveIntensity 0.35+0.3*min(3,count)` eased over 1.5 s). Landmarks are hand-authored primitives: stepped Citadel `CourtyardScene.tsx:300-352`, Foundry shed+chimneys+cranes `:354-391`, Archive rotunda `:393-420`, Observatory dome+dish `:422-449`, Gateway arch+portal `:451-473`. Ground is a 160×160 plane `:1232-1235`, DPR capped `[1,1.6]` `:32`, one 2048px shadow light `:1215-1228`; background buildings receive but do not cast.

**Weakness 1 — One slate-grey mass.** All six `COLORS` sit at ~18–28% lightness and near-zero saturation (e.g. citadel `#3a4860`, port `#39464a`, archive `#3b4a46`). Same `roughness 0.88–0.95 / metalness 0.06–0.12`, same axis-aligned 5–7 unit boxes, same `#2f3742` roof caps. Windows are too small and too few to break the mass, and only on the top part on 1–2 facades. At city view (`position [79.8,103,144.4]` `:31`) districts differ only in the HUD label.

**Weakness 2 — No skyline drama.** `HEIGHTS` compress everything except the Citadel (`citadel 24–48` vs `port 6–14`, `observatory 7–17`). The 10-unit grid plus `PLAZA_CARVE 18` / `SPOT_CARVE 10` (`city.ts:48,187`) punches flat holes, not streets that rise. Setbacks are token (`upper w*0.6/d*0.6`, archetype 3 `w*0.5` cap) with no tower rhythm, no hero beyond the Citadel stack (~43 units total), no falloff from district centres. The fog `170–340` (`:1211`) and sky band stay empty.

**Weakness 3 — Generic landmarks, thin data hook.** Landmarks read at district zoom but vanish at city zoom: Archive/Observatory domes are 9/7-radius hemispheres, Foundry is a 6-unit shed, Gateway 16-unit pillars. Only truthful encoding is per-district window glow from `fresh && workState==='active'` counts. There is no `workspace → building` mapping, no floor/stack legibility, no oculus/beacon that scales with real load.

## 2. 10x vision

A moonlit obsidian harbour ringed by six mineral districts you can name from silhouette alone: a needle-crowned Citadel over stepped terraces, rust Foundry stacks breathing ember light, a jade Archive dome with a lit oculus, a copper Observatory dish, hammerhead Port cranes, a tall violet Gateway arch — all in one limited midnight palette where warm amber windows pulse only where real agents work, and every roof tells its district at 3-second glance.

## 3. Ranked moves

1. **District material reboot.** New `COLORS` + trim/metal per district (citadel blue-slate+limestone, foundry rust+brick, archive sandstone+jade, observatory indigo+copper, port tar+timber, gateway violet). Add one instanced parapet/trim mesh tinted per district. Impact 5, effort S, perf ~0 (same 5–6 draws, +~1k tris), data hook: scenery, deps: lighting (coordinate palette/exposure).
2. **Skyline surgery: hero + gradient + setbacks.** One 58–65-unit Citadel needle, height falloff `h *= 1.3-0.6*(d/radius)`, 15% towers get 2 setbacks, Gateway arch to 24 units. Impact 5, effort M, perf +2k tris, 0 draws, data hook: scenery, deps: sky (keep black-hole band), streets (keep carves).
3. **Facade system with window atlas.** One 256×512 canvas texture (window grid + spandrel) as `map+emissiveMap` on the 3 box layers; keep instanced glow quads but 3× denser, full-height, lit ratio per district. Impact 5, effort M, perf 1×512px texture, same draws, degrades to flat colour if texture off, data hook: `freshness`+`workState` (lit ratio), `toolKind` (which floors), deps: lighting, datamap.
4. **Workspace-buildings (truthful).** Pin each `workspace` basename to one persistent building; its lit-floor fraction = `fresh` agents in that workspace / capacity, colour shift on `needs-input`. Impact 4, effort M, perf uniform-only update per frame, data hook: `workspace`, `freshness`, `workState`, deps: datamap, agents, HUD tooltip.
5. **Landmark rebuilds (6 silhouettes).** Taller Citadel crown+spire, 3 staggered Foundry stacks+gantry crane, Archive oculus ring, split Observatory dome, 2 Port hammerheads, taller Gateway arch. Impact 4, effort M, perf +~5k tris, +6 draws, data hook: scenery except Port ship-boat pulse (`toolKind==='ship'`) and Archive oculus (`phase==='thinking'` density), deps: sky, streets.
6. **Roofscape pass.** Instanced parapets, rooftop boxes, antennae/stacks per district (foundry many, archive none), 90° plan variants. Impact 3, effort S, perf +2 instanced draws, +3k tris, data hook: scenery, deps: lighting.
7. **Infill + distance LOD.** 80→~110 with low-rise harbour/gateway infill; hide window `Instances` beyond ~200 units, freeze `DistrictWindows` easing when paused. Impact 3, effort M, perf neutral (cull pays for infill), data hook: scenery, deps: experience (camera ranges).
8. **Ground-floor legibility.** Stone podium bases + lit shopfront strip along lit boulevard (`ROADS lit` in `city.ts:298-310`) + district banners at work-spot rims. Impact 3, effort S, perf +2 instanced draws, data hook: scenery, deps: streets, lighting.

## 4. Signature moment

City view at default frame: the Citadel needle and its two amber crown rings (`:342-349` grown to 3 rings) pierce the black-hole band while the Foundry stacks exhale lit steam, the Archive oculus glows jade, and one workspace-tower near the canal burns three warm floors where three real agents are `fresh/active` — the rest of the street dark. That contrast is the screenshot.

## 5. Build sketch for the top 3 moves

**M1 — Material reboot (~80 lines).** Technique: widen `COLORS` in HSV (keep value 20–45% but separate hue: citadel 215°, foundry 12°, archive 160°, observatory 225°, port 190°, gateway 265°), add `TRIM: Record<DistrictId,string>`; in `CourtyardScene.tsx:813-846` add one `Instances` of `boxGeometry` for a 0.4-unit parapet cap tinted by `part.color→trim` lerp, plus set `metalness` per layer (foundry 0.35, observatory 0.4, others 0.08). Files: `city.ts`, `CourtyardScene.tsx`. Pitfalls: `Instance color` needs `instanceColor.needsUpdate`; keep trim inside shadow receive only; check `prefers-reduced-motion` still legible (no motion involved); coordinate exposure with lighting layer so rust does not clip.

**M2 — Skyline surgery (~150 lines).** Technique: replace uniform `h = lo+rng()*(hi-lo)` (`city.ts:220`) with `h = (lo+rng()*(hi-lo)) * (1.35-0.7*min(1,distToDistrictCentre/radius))`; force `if (rng()<0.15)` tower path: main 70%, mid 20% at 0.72 scale, crown 10% at 0.45 scale. Add exported `HERO: Building` at `[0,-2]` citadel, `h 62`, 3 setbacks + spire 14, excluded from carve logic by `if (hypot(x,z)<18) continue` carve-out. In scene add `<HeroTower/>` (3 boxes + cone + 3 torus rings reusing Citadel materials). Files: `city.ts`, `CourtyardScene.tsx`, `cityGraph.ts` footprints (`CITADEL_HALF 13→15`). Pitfalls: re-verify `BUILDINGS.length` docs (80→~78 + hero); keep camera far `420` and fog `170–340`; walk graph unaffected except citadel footprint constant.

**M3 — Facade atlas (~200 lines).** Technique: at module load build `CanvasTexture 256×512`: dark spandrel + 4×8 window cells with 1px mullions; use as `map` + `emissiveMap` (`emissive #ffcf8a`) on podium/main/upper materials with `onBeforeCompile` scaling UV by `part.w/h` via instanced attribute `aScale` (or simpler: box UV repeat 1 and accept stretch — acceptable at city scale). Keep `WINDOWS` panels but generate per-floor rows (`rows = floor(h/3)`), all 4 facades on towers, cap 24/building; per-district material keeps existing glow logic (`:784-790`). Files: new `facadeTexture.ts` (~60 lines), `city.ts` window loop, `CourtyardScene.tsx:776-811,813-829`. Pitfalls: single texture must be `SRGBColorSpace`, `anisotropy 4`; instanced emissive intensity is per-mesh not per-instance — keep 6 district meshes; `prefers-reduced-motion`: glow static at last value; test DPR 1.5 fill-rate before adding street-level strips.

## 6. Cut list

- Cut uniform `#2f3742` roof caps on every building; keep caps only on flat roofs, tint by district trim.
- Cut random `spire` archetype on any district (`city.ts:239-243`); spires only on Citadel/Gateway towers and Observatory vanes.
- Cut podium layer where `h<10` (invisible at city scale); merge into main to save one draw setup cost.
- Cut tiny 0.85×0.7 single-facade window scatter; replaced by full-height atlas + denser quads.
- Cut 4th chimney glow ring duplication in Foundry; one emissive ring + steam reads better.
- Do not add per-window point lights, normal maps, or AO textures — headroom stays for workers/traffic.

## 7. Sources

- Local: `src/components/prototype/city.ts`, `src/components/prototype/CourtyardScene.tsx:300-473,776-846,1210-1235`, `src/components/prototype/agentModel.ts`, `plans/001-living-cosmic-city.md`, `plans/002-living-agents.md`, `docs/courtyard-prototype.md`.
- three.js examples index (instancing / performance patterns): https://threejs.org/examples/
- three.js manual (rendering, instancing, LOD concepts): https://threejs.org/manual/
- React Three Fiber docs (Instances, performance): https://docs.pmnd.rs/react-three-fiber/
- drei docs (`Instances`, `Html` label cost): https://github.com/pmndrs/drei
- Web attempts at live technique search were cancelled in this environment; patterns above use only instancing + canvas textures already in the repo's dependency-free budget.
