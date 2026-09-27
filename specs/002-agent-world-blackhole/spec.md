# Feature Specification: Agent Village and Black Hole Backdrop

**Feature branch**: `codex/agent-world-blackhole-plan`  
**Status**: Planning draft, 2026-09-27  
**Input**: Make the standalone agent command center feel like a lively strategy-game village, taking inspiration from Agent Office's visible workers. Add an Interstellar-inspired black hole in the background. Plan before implementing.

## Scope and assumptions

- Keep the existing Viking village and read-only command center. This is the agent visualization, not the IPAM platform UI.
- Treat Agent Office and Clash of Clans as visual and interaction references. Create original art and behavior; do not copy their assets or expand this feature into their agent runtime, multiplayer, voice, or terminal sharing.
- Use a real-time **visual approximation** of gravitational lensing: a dark center, bright accretion disk, bent-looking light and stars. The linked article describes geodesic ray tracing; this feature does not claim to solve those equations or reproduce the film's renderer.
- Place the effect in the distant sky behind the map, workers and labels. A dark cosmic treatment is the initial art direction. Keep the black hole visually subordinate to the agent work area.
- No new remote assets, provider calls, telemetry fields, write routes, or paid rendering service. Blender may be used offline later to author original props; it is not required to render this feature.

## User stories and acceptance

### P1 — Read the working village at a glance

1. A person opening the command center sees the seven existing districts, recognisable workers and their existing decorative chores without needing to zoom or hover first.
2. Active, waiting, needs-input, complete, failed, historical, unknown and stale states remain distinguishable through the existing labels, status marks, roster and inspector. Decorative movement does not change any record or count.
3. Clicking a worker still selects its roster detail. Orbit dragging does not select it. The live/simulation control, simulation watermark and stale-snapshot behavior remain unchanged.
4. The 842px-wide normal viewport keeps worker silhouettes, chore props, hall labels and selected worker legible against the new background.

### P1 — Black hole inspired backdrop

1. The visible sky contains an original black hole composition with a dark center, luminous disk/ring and apparent light bending. It stays behind the village and never covers a worker, district label, status mark or roster detail.
2. The effect is decorative and has no relationship to agent status or task progress. It is not described as a physically accurate ray tracer.
3. It uses the existing browser 3D renderer and locally bundled code or assets. No network fetch is required for the scene after local installation.
4. If reduced motion is requested, the composition stays legible and still. If the optional effect cannot run, the scene uses a static dark sky and the roster remains usable.

### P2 — Playful, original strategy-game character

1. Improve the existing scene's composition, color and lighting so its small village feels deliberate and lively while preserving the Viking setting, local glTF map, current worker identity and district meanings.
2. Reuse current worker/chore components before adding props. Any new decorative prop is bounded, original and independent of telemetry truth.
3. The visual treatment must avoid copied game characters, buildings, logos, audio or textures.

## Constraints

- `src/components/OperationsPanel.tsx` remains the accessible source of operational detail. The 3D scene is decorative and remains outside the accessibility tree.
- Server adapters, telemetry normalization, live/simulation selection, and the IPAM repository are outside this feature.
- Preserve the existing local map's attribution and license. Do not copy the article's image or Agent Office source without a separate asset/license decision.
- Use the current React Three Fiber, Three.js and Vite stack. A new dependency requires a demonstrated need in the plan.
- Bound GPU work and include an effect-off/static path. Exact frame time or device support claims require later measurement.
- This specification authorizes planning only. No implementation, tests, builds, browser checks or service startup are part of this planning pass.

## Success criteria for a later authorized implementation

- At the normal viewport, a reviewer can identify the village, workers, current status signals and the black hole composition from the default camera position.
- Agent records, counts, provider/model labels, timestamps and live/simulation/stale state are identical for the same telemetry input before and after the scene treatment.
- The effect remains readable with reduced motion and degrades to a static sky without hiding the roster.
- No new runtime dependency, remote request or copied third-party art is introduced for the first visual slice.

## Not in scope

- Agent Office feature parity: walkable avatar, shared terminals, hiring, task submission, multiplayer, voice, GitHub boards and notifications.
- A physically accurate Schwarzschild or Kerr geodesic ray tracer, film-quality path tracing, server GPU rendering, or an exact Interstellar replica.
- Replacing the existing map or reworking the IPAM platform UI.
- Blender asset production in the first implementation slice.

## Scope boundary for this plan

This feature covers the visual village and black-hole background. Walkable avatars and live terminals would be a separate interaction feature with a new plan because they change runtime and authority boundaries. The user can expand that scope before implementation; no such expansion is assumed here.
