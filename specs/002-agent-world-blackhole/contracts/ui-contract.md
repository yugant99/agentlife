# UI Contract: Agent Village and Black Hole Backdrop

**Authority**: `src/components/OperationsPanel.tsx` (roster + inspector) is the accessible source of operational detail. The 3D scene, including the black-hole backdrop, is decorative and stays `aria-hidden` (`src/components/WorldScene.tsx:1251`, `src/App.tsx:60-64` pattern).

## Invariants (must hold before and after)

1. **Telemetry truth untouched**: records, counts, provider/model labels, timestamps, `SourceMode`, `stale`/`historical`/`reportedStatus` semantics identical for the same input. Backdrop reads no telemetry field and writes none.
2. **Live/simulation boundary**: source control, `SIMULATION` watermark, `STALE SNAPSHOT` / `PARTIAL LIVE` / `LOCAL LIVE` labels, and stale-retains-last-snapshot behavior unchanged. Backdrop looks identical in live and simulation; it never signals which mode is active.
3. **Visuals are never evidence**: the hole, disk, glow, and any lighting shift MUST NOT imply status, activity, progress, or verified work. No tooltip, label, or legend ties the backdrop to agent facts.
4. **Occlusion**: a camera-relative backdrop stays behind map, workers, hall labels, status marks and hover markers at the default camera (`[10,12.5,21]`, fov 42) and during orbit. It never covers roster/inspector DOM.
5. **Selection**: click-to-select a worker still selects roster detail; orbit-drag does not select. Backdrop meshes are non-interactive (no pointer handlers, no hit-test blocking).
6. **Legibility at 842px normal viewport**: worker silhouettes, chore props, hall labels, and selected-worker highlight remain distinguishable against the new sky without zoom/hover.
7. **Reduced motion**: with `prefers-reduced-motion`, disk rotation and glow loops freeze to a static legible pose; all information remains available.
8. **Fallback**: `?sky=off` in an otherwise working Canvas shows a static sky and keeps the village interactive. This is a manual recovery switch, not automatic shader-failure detection. If WebGL is unavailable, show the Canvas fallback and CSS sky; the 3D village is unavailable, but the roster/inspector remain usable. No graphics error is labelled as telemetry failure; no synthetic data appears.
9. **Accessibility**: backdrop contributes no DOM nodes to the accessibility tree; hover markers never block scene pointer interaction (preserved behaviors).
10. **Offline/original art**: no new runtime dependency, remote request, CDN asset, or copied third-party art/characters/textures in the first slice. AGPL map attribution and `public/models/LICENSE` retained.

## Props / wiring contract (unchanged signatures)

- `WorldScene({ records, selectedId, reducedMotion, onSelect })` — backdrop receives only `reducedMotion`; it does not accept records or selection.
- `App` continues to own `reducedMotion` via `matchMedia` and the simulation watermark overlay outside the canvas.
- `VillageWorld` background/fog/lights (`WorldScene.tsx:1200-1216`) receive a coherent dark-cosmic grade with the new sky surface; the camera, controls, DPR cap, and shadow policy stay as-is unless a later measured need justifies change.

## Out of contract (not promised in slice one)

- Exact frame-time, device-support, or film-accuracy claims (require later measurement; spec forbids asserting them now).
- App-shell reskin, postprocessing, dense star fields, or Blender-authored props (later optional polish only).
