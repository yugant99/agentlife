# Sky & Space — 10x Layer Study (sky)

## 1. Audit

Today the sky is one file: `src/components/BlackHoleBackdrop.tsx:1-195`, instantiated once in `src/components/prototype/CourtyardScene.tsx:1230` as `<BlackHoleBackdrop size={0.8} brightness={1.05} direction={BLACK_HOLE_DIRECTION} />` with `BLACK_HOLE_DIRECTION=[0.03,0.21,-1.0]` (`CourtyardScene.tsx:42`). It is a single `THREE.ShaderMaterial` on a `SphereGeometry(400,32,24)` (`BlackHoleBackdrop.tsx:157`), `BackSide, depthWrite:false, depthTest:false, fog:false` (`BlackHoleBackdrop.tsx:147-150`), vertex-pinned to the far plane (`BlackHoleBackdrop.tsx:18-21`). Fragment does: vertical gradient (`BlackHoleBackdrop.tsx:40-44`), hash grid stars (`BlackHoleBackdrop.tsx:59-66`), then inside `if (cosA > cos(min(0.64*S,1.45)))` (`BlackHoleBackdrop.tsx:69`) a cool glow (`:78-79`), black shadow (`:82-83`), one-sided beam (`:86`), three Gaussian bands for near-disk / lensed arch / echo (`:89-98`), sinusoidal `flow` (`:101`), warm→hot mix (`:103-106`), photon rim (`:109-110`). CPU side follows the camera exactly — `node.position.copy(camera.position); node.quaternion.copy(camera.quaternion)` (`BlackHoleBackdrop.tsx:170-171`) — so the hole is screen-fixed. Time freezes to `STILL_TIME=1.7` under `prefers-reduced-motion` (`BlackHoleBackdrop.tsx:10,175-178`) wired from `src/prototype-main.tsx:60-62,100-105`, and freezes on `paused` (`BlackHoleBackdrop.tsx:180`). Scene fog is `fog('#0b1220',170,340)` over `background '#05070f'` (`CourtyardScene.tsx:1210-1211`); DPR `[1,1.6]` (`CourtyardScene.tsx:32`). The header comment is honest: "not a geodesic ray tracer and never reflects agent status" (`BlackHoleBackdrop.tsx:5-9`), repeated in `docs/courtyard-prototype.md:75-79`. Data contract available but unused by sky: `workState/freshness/phase/toolKind/lastSignalAt` in `src/components/prototype/agentModel.ts:13,15,18,22,49`.

**Weakness 1 — Sticker sky, no parallax.** Copying camera quaternion makes orbit unable to move the hole (`BlackHoleBackdrop.tsx:170-171`, comment `:167-169`). It reads as UI wallpaper, not space, and destroys any credible lensing/arch illusion at district/agent tilt. No moon, planet, Milky Way, nebula, aurora, weather, or horizon coupling — just gradient + ~1.4% white dots.

**Weakness 2 — Zero truthful encoding.** The most legible overhead canvas encodes nothing. `docs/courtyard-prototype.md:213-218` admits the planned `rate={1+min(active/10)*0.5}` patch never landed. District windows already ease with fresh-active count (`CourtyardScene.tsx:776-791`); sky has no equivalent aggregate channel.

**Weakness 3 — Disk looks geometric, not fluid.** Front/arch/echo are static Gaussians in `ux/uy` (`BlackHoleBackdrop.tsx:89-98`) with a single sine `flow`. No turbulence, no inner-hot temperature ramp, no Doppler asymmetry beyond a linear `beam`, no thin photon ring separation. Stars are one threshold (`step(0.986,sh)`, `:66`), no magnitudes, no band structure — cheap but flat.

## 2. 10x vision

Keep one draw call and the same silhouette, but make it feel like a living cosmos over a living city: a turbulent amber accretion disk with a white-hot inner edge and a razor photon rim bending over black, set in a violet-teal deep field with a faint Milky Way band and breathing horizon amber that answers the city below. When agents work, the disk breathes brighter and turns a touch faster; when someone needs you, a single slow gold flare crosses the rim — always labelled, never mistaken for traffic. Reduced motion keeps the full composition as a perfect still.

## 3. Ranked moves

1. **Turbulent accretion disk 2.0** — Impact 5, Effort M, Perf: +0 draws, ~+15 ALU/px inside disk mask only (≈8% of pixels), 0 MB. Data: scenery. Deps: lighting (match disk key tint), water (reuse shimmer palette).
2. **Aggregate-activity glow + spin** — Impact 5, Effort S, Perf: 2 uniforms, CPU lerp/frame, 0 draws. Data: `CityAgent.workState=='active' && freshness=='fresh'` count → `uBright`; same → `uRate`. Deps: datamap (counts), experience (legend chip).
3. **Needs-you rim flare (labelled, discrete)** — Impact 4, Effort S, Perf: 1 uniform, ~+5 ALU in mask when active. Data: `count(workState=='needs-input' && freshness!='historical')>0` → `uFlare 0..1` pulse. Deps: experience (HUD "sky flare = needs input" chip + beam stays primary), agents (beam remains ground truth).
4. **Deep field: Milky Way + nebula + magnitude stars** — Impact 4, Effort M, Perf: +~10 ALU full-sky (2-octave FBM at half precision ok), 0 draws, optional `uStarDensity` degrade. Data: scenery. Deps: none.
5. **World-lock + horizon atmosphere** — Impact 4, Effort M, Perf: ~+6 ALU full-sky, 0 draws. Data: scenery (horizon warmth biased by district glow count as ambient only). Deps: architecture (skyline silhouette), lighting (fog sync).
6. **Shepherd moon + one ringed planet** — Impact 3, Effort M, Perf: analytic SDF circles in-shader, 0 draws, 0 MB. Data: scenery (fixed ephemeris, never telemetry). Deps: none.
7. **High cirrus + faint aurora veil** — Impact 3, Effort M, Perf: +~8 ALU upper sky, toggleable `uWeather 0..1`. Data: scenery; optionally `uWeather` from wall-clock only, never agent fields. Deps: experience (reduced-motion off switch).
8. **Quality ladder + designed still** — Impact 3, Effort S, Perf: saves ~30-50% fragment cost on iGPU when degraded (octaves 3→1, stars 100%→40%, sphere 32×24→24×16). Data: `prefers-reduced-motion`, `paused`, DPR. Deps: experience (manual quality toggle).

Truthfulness guard (all encoding moves): only aggregate counts drive sky; per-agent identity never does. Brightness/rate changes are slow-eased (≥1.5 s, frozen on pause like `DistrictWindows`), flare is a distinct gold-white rim sweep + HUD text, visually unlike tram/boat/courier motion. Simulation source keeps "Synthetic scenario" disclosure; legend reads "Glow = N active (fresh)".

## 4. Signature moment

City view at default orbit: the amber disk and its lensed arch sit fully above the Citadel crown, Milky Way diagonal behind, horizon breathing warm over the harbor, tram mid-loop on the rail — and one frame catches the thin gold flare kissing the photon rim while the amber needs-you beam rises from the Citadel steps. That two-light rhyme (rim + beam) is the screenshot.

## 5. Build sketch for the top 3 moves

### A. Turbulent disk 2.0 (in `BlackHoleBackdrop.tsx`, ~110 new shader lines, ~25 TS lines)
Technique: keep mask/branch structure (`:69`). Inside, convert to polar: `r=ang/rs; th=atan(uy-frontY,ux)`. Streak noise: `n=f bm(vec2(th*2.5 - uTime*uRate*(1.5/r), r*6.0))` with 3-octave value noise (hash without textures). Disk light = `smoothstep` annulus `r in [1.05,3.2]` × `exp(-pow((uy-frontY)/w,2))` × `(0.6+0.6n)`; temperature ramp `mix(white, amber, smoothstep(1.0,3.0,r))`; Doppler `beam=1.0+0.9*smoothstep(0.2,-0.2,ux/r)` (left hotter, motivated by relativistic beaming, not computed). Arch/echo reuse same `n` at 0.5 gain. Rim: `exp(-pow((ang-rs)/(0.0035*S),2))` whiter/thinner than today. Files: `BlackHoleBackdrop.tsx` (fragment + `uRate,uFlare` uniforms), `CourtyardScene.tsx:1230` (pass-through only). LOC: ~135. Pitfalls: keep `acos` inside mask only; keep FBM ≤3 octaves and skip nebula FBM inside mask; clamp `S` so branch stays bounded; test at `size=0.8` and `1.0`.

### B. Aggregate glow + spin (scene → sky, ~40 lines)
Technique: in `CourtyardWorld` (near `glowCounts`, `CourtyardScene.tsx:1182-1191`) compute `active = agents.filter(a=>a.freshness==='fresh'&&a.workState==='active').length`. Ease in `useFrame`: `bright += (target-bright)*min(1,delta/1.5)` with `target=1.05*(1+0.06*min(active,12))`, `rate=1+min(active,10)*0.05` (the dormant `docs:213-218` idea, eased not snapped). Pass as `brightness` + new `rate` prop; shader multiplies `uTime` advance by `rate` and disk/glow by `uBright`. Freeze easing when `paused||reducedMotion`. Add HUD legend in `CourtyardHud.tsx`: "Hole glow · N active". Files: `BlackHoleBackdrop.tsx` (+`rate` prop, `time.current+=min(delta,0.06)*rate`), `CourtyardScene.tsx`, `CourtyardHud.tsx`. LOC: ~60. Pitfalls: no per-frame React state — refs only; historical/stale excluded; live vs simulation counts never mixed (reuse `agents` already selected in `prototype-main.tsx:84`).

### C. Deep field + horizon (`BlackHoleBackdrop.tsx` only, ~70 shader lines)
Technique: Milky Way: distance to great circle `abs(dot(d, bandN))` with 2-octave FBM breakup, gain 0.05 cool blue + dust lane darkening. Nebula: 2-octave FBM on `d.xz/d.y`, violet `#241a4a` / teal `#0e3a44` at 0.06 gain, masked off near hole (`starMask` reuse, `:64`). Stars: two thresholds (`0.986` faint + `0.997` bright with cross sparkle), magnitude-scaled size via `starDist` threshold, subtle `twinkle` only when `!reducedMotion`. Horizon: `hor=exp(-abs(d.y)*7.0)` amber-cyan mix `vec3(0.10,0.07,0.04)*hor` + city-side bias toward `-y`; set scene `fog` color to match horizon (`#0b1220` → sample at runtime, or hard-code `#0d1424`). Files: `BlackHoleBackdrop.tsx`. LOC: ~70. Pitfalls: full-screen FBM is the main iGPU cost — use 2 octaves, `mediump`-safe math, single `uDetail 0/1` switch for degrade; horizon must stay below skyline (test district view `maxPolarAngle 1.42`).

## 6. Cut list

- Cut screen-fixed orientation (`BlackHoleBackdrop.tsx:170-171` quaternion copy): keep position-follow, world-lock orientation so orbit parallaxes. Fixes "sticker" feel for free.
- Cut/merge `echo` band as separate Gaussian (`:97-98`): fold into noise-modulated arch at 0.4 gain — one less term, more fluid.
- Cut `SphereGeometry(400,32,24)` → `(400,24,16)`: sky needs no silhouette detail; saves ~1k tris, invisible.
- Cut single-threshold stars (`:66`): replaced by magnitude system above at same cost.
- Cut unguided `uBright` prop default drift: pin default `1.05` at city view, derive all variation from §5B so brightness always means activity.
- Do not add: postprocessing bloom, second sky mesh, texture assets, npm packages (no dependency earns its bytes here — `postprocessing` ~100 kB+ unnecessary; analytic glow + rim already read as bloom at DPR ≤1.6).

Reduced-motion still: `uTime=STILL_TIME`, `uRate` ignored, twinkle/flow/aurora/cirrus forced 0, but `uBright/uFlare` static levels + HUD text remain — readable without motion.

## 7. Sources

- three.js shader-sky + BackSide far-plane sky pattern: https://threejs.org/examples/ (webgl_shadersky family) and `ShaderMaterial` docs https://threejs.org/docs/#api/en/materials/ShaderMaterial
- Interstellar/Gargantua look (Doppler beaming, photon ring, arch over shadow — stylized, not ray-traced): https://en.wikipedia.org/wiki/Interstellar_(film) ; physics: https://en.wikipedia.org/wiki/Relativistic_beaming
- Procedural star/Milky-Way/noise-sky techniques (hash + value-noise FBM in-shader, no textures): https://www.shadertoy.com (search "starfield", "milky way" — study, do not copy; all code here is original)
- Aurora/cirrus veil approach (cheap upper-sky FBM bands): https://en.wikipedia.org/wiki/Aurora
- `prefers-reduced-motion` handling: https://developer.mozilla.org/en-US/docs/Web/API/Window/matchMedia
- Code audited: `src/components/BlackHoleBackdrop.tsx`, `src/components/prototype/CourtyardScene.tsx:42,1230,1210-1211`, `src/components/prototype/agentModel.ts`, `docs/courtyard-prototype.md:75-79,213-218`, `plans/001-living-cosmic-city.md:52`
