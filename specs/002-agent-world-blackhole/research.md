# Research: Agent Village and Black Hole Backdrop

**Feature**: `specs/002-agent-world-blackhole/spec.md` | **Date**: 2026-09-27 | **Status**: Planning only, no runtime verification

> Muse drafted this from local source excerpts. The references below were then checked against the linked article, the Agent Office repository, and official rendering documentation. No tests, builds, smoke checks, or browser QA were run or authorized (constitution VI).

## Unknown 1 — Reusable current scene

- **Decision**: Reuse `src/components/WorldScene.tsx` (`VillageWorld` + `WorldScene`), `src/App.tsx` wiring (`records`, `selectedId`, `reducedMotion`, `onSelect`), and `src/types.ts` (`AgentRecord`, `DistrictId`) unchanged. Add the backdrop within the existing Canvas behind map/workers/labels. Put shader code in a small `BlackHoleBackdrop.tsx` component because `WorldScene.tsx` already exceeds 1,200 lines.
- **Rationale**: `WorldScene.tsx` (1257 lines) already owns the bounded pattern this feature needs: `Canvas shadows dpr={[1,1.65]}`, `powerPreference: 'high-performance'`, single `GLTFLoader` map load, `useMemo` per snapshot (chores, walkers, grouping) instead of per frame, map meshes set to `receiveShadow` only, and `reducedMotion` threaded through flames/smoke/workers. `App.tsx:62` already passes `reducedMotion` and keeps the simulation watermark outside the canvas. Reuse satisfies constitution V (small scope, no new weight).
- **Alternatives**: New separate scene/route for the backdrop — rejected: duplicates loader, camera, controls, and selection logic. Fork `VillageWorld` — rejected: doubles maintenance for a decorative addition.
- **Sources**: `src/components/WorldScene.tsx:1115-1257` (VillageWorld background/lights/Canvas); `src/App.tsx:8-63`; `src/types.ts:15-57`; `package.json` (`@react-three/fiber ^9.4.0`, `three ^0.180.0`).

## Unknown 2 — Agent Office source uses Three.js with no Blender runtime

- **Decision**: Treat Agent Office / Clash of Clans as visual/interaction references only. No Agent Office source is copied, no runtime/terminal/multiplayer/voice parity is planned, and Blender is not a runtime dependency. Blender may author original props offline later; it is out of the first slice.
- **Rationale**: Agent Office's `package.json` includes `three` and its client constructs `THREE.WebGLRenderer`; Blender is absent from its runtime dependencies. Our app already uses React Three Fiber / Three.js, so the missing difference is designed scene and interaction behavior. The current feature stays within the user's requested visual scope.
- **Alternatives**: Port Agent Office interaction model — deferred as a separate feature because it expands scope to write routes and live sharing outside the current read-only constitution. Blender-rendered runtime — rejected because Blender is an offline authoring tool and the existing browser renderer already runs the scene.
- **Sources**: `specs/002-agent-world-blackhole/spec.md`; local `package.json`; [Agent Office package](https://github.com/AgentSystemLabs/agent-office/blob/main/package.json), [client renderer](https://github.com/AgentSystemLabs/agent-office/blob/main/src/client/main.ts), [MIT license](https://github.com/AgentSystemLabs/agent-office/blob/main/LICENSE).

## Unknown 3 — Browser/WebGL cost and local GPU use

- **Decision**: Keep rendering client-side in the existing `Canvas`; bound cost by retaining the DPR cap, using one shader surface with no shadow casting, and avoiding per-frame allocations or extra render passes. No server GPU, paid rendering service, or new runtime dependency is needed for the first slice. Actual frame cost remains unknown until measured.
- **Rationale**: Current scene is already tuned this way: map does not cast shadows (`WorldScene.tsx:1173-1183`), per-snapshot `useMemo` avoids per-frame work, `powerPreference: 'high-performance'` with capped DPR. Constitution V requires sensible per-frame cost for dozens of workers and no remote/CDN weight. Exact frame-time or device-support claims require later measurement (spec constraint).
- **Alternatives**: Server-side or cloud render stream — rejected: breaks local-only/offline (constitution I) and adds cost/dependency. Uncapped particle/star fields or postprocessing chain — rejected: unbounded GPU cost; deferred to optional later polish with explicit budget.
- **Sources**: `src/components/WorldScene.tsx:47-56,132-137,1200-1216,1249-1255`; `specs/002-agent-world-blackhole/spec.md`; `.specify/memory/constitution.md` principles I, V; [MDN WebGL overview](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API), [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html).

## Unknown 4 — Visual black-hole shader versus physical geodesic tracing (finite-intelligence article)

- **Decision**: Implement a real-time **visual approximation** on one shader surface: dark center, luminous tilted disk, apparent lensing and glow. Do not solve geodesic equations, reproduce the film renderer, or describe the result as physically accurate.
- **Rationale**: The linked article traces light paths using the Schwarzschild metric and numerical integration. That is a different per-pixel computation from a stylized shader. A Three.js `ShaderMaterial` supports the latter in the existing renderer without adding a library; the true tracer's interactive cost has not been measured here.
- **Alternatives**: CPU/GPU geodesic integrator — rejected: heavy, unmeasured, contradicts spec not-in-scope. Copying the article's image or film assets — rejected: license/original-art violation (spec constraints).
- **Sources**: `specs/002-agent-world-blackhole/spec.md`; [Finding shortest paths and simulating black holes](https://finite-intelligence.com/blog/shortest-paths-and-black-holes/); [Three.js ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html).

## Unknown 5 — Composition / fog / contrast

- **Decision**: Use a camera-relative sky surface so the composition remains visible during orbit and renders behind village geometry. Give the sky, scene fog, and key lighting a bounded dark-cosmic grade together; retain contrast on workers, labels, and status marks. Keep the hole off the visual center of the worker cluster at the default camera.
- **Rationale**: A fixed world-space object can leave the view as the camera orbits. The current pale background and fog would wash a dark hole into a daylight scene. Matching fog and lighting to the new sky is part of making the requested composition coherent; later visual inspection must settle exact values.
- **Alternatives**: Fixed distant world-space object — rejected because orbit may hide it. Full app-shell redesign — deferred because the roster's operational styling does not need to change. Foreground hole — rejected because it would cover workers.
- **Sources**: `src/components/WorldScene.tsx:30-56,1200-1201,1244,1249-1255`; `specs/002-agent-world-blackhole/spec.md` (P1 stories, constraints).

## Unknown 6 — Reduced motion and WebGL/static fallback

- **Decision**: Thread the existing `reducedMotion` boolean into the backdrop (static legible pose; no meaning carried by motion). Use React Three Fiber's `Canvas` fallback and the `.scene-shell` CSS background when WebGL is unavailable: the 3D village cannot render then, but the roster and inspector remain usable. Within a working Canvas, provide a simple effect-off/static-sky path for the shader; never substitute synthetic telemetry.
- **Rationale**: Constitution IV (reduced motion → static legible pose) and existing precedent (`HearthFlames`/`HearthSmoke` early-return on `reducedMotion`, `App.tsx` `matchMedia('(prefers-reduced-motion: reduce)')`). Constitution II requires failed refresh to retain last snapshot, never synthetic data; the same applies to a graphics fallback. Spec acceptance: "stays legible and still" + "static dark sky and the roster remains usable".
- **Alternatives**: Claim the 3D village works without WebGL — rejected because it cannot. Animated fallback — rejected: violates reduced-motion rule.
- **Sources**: `src/components/WorldScene.tsx:516-552,754-793`; `src/App.tsx:16-22,60-64`; `.specify/memory/constitution.md` principles II, IV; [React Three Fiber Canvas fallback](https://r3f.docs.pmnd.rs/next/api/canvas) (also present in the installed v9 Canvas type).

## Unknown 7 — Existing AGPL map and original art

- **Decision**: Keep the `andrinr/villages` glTF map, local Draco decoder, and self-hosted font as-is with attribution and `public/models/LICENSE` retained. All black-hole and polish art is original and locally bundled; no copied game characters/buildings/logos/audio/textures, no article image, no Agent Office assets, no remote fetches.
- **Rationale**: `README.md` attribution section and constitution attribution rule require AGPL-3.0 text retention and local hosting. Spec constraints forbid copied third-party art and new remote assets; constitution I/V require fully offline-usable installs.
- **Alternatives**: Replace the map or pull skybox/CDN textures — rejected: re-licensing risk, network dependency, scope growth.
- **Sources**: `README.md:60-62`; `public/models/LICENSE`; `src/components/WorldScene.tsx:10-13,32-33`; `.specify/memory/constitution.md` (principle I, attribution constraint).

## Source-link index (verified, no guessing)

- Local: `.specify/memory/constitution.md`, `specs/002-agent-world-blackhole/spec.md`, `package.json`, `src/components/WorldScene.tsx`, `src/components/OperationsPanel.tsx`, `src/App.tsx`, `src/types.ts`, `src/hooks/useTelemetry.ts`, `README.md`, `public/models/LICENSE`
- External checked in this session: [Agent Office](https://github.com/AgentSystemLabs/agent-office), [black-hole article](https://finite-intelligence.com/blog/shortest-paths-and-black-holes/), [Three.js renderer](https://threejs.org/docs/pages/WebGLRenderer.html), [Three.js shader material](https://threejs.org/docs/pages/ShaderMaterial.html), [MDN WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API), [Blender license](https://www.blender.org/about/license/), and the existing [Villages map](https://github.com/andrinr/villages).
