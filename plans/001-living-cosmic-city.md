# 001 — Build a living cosmic city with three viewing scales

- Status: IN PROGRESS
- Commit: 6c477e1
- Severity: HIGH
- Category: Missed opportunities, spatial continuity, scene composition
- Scope: prototype entry, prototype components, optional backward-compatible sky controls; original app behavior stays intact.
- Implementer: OpenCode / opencode-go/deepseek-v4.1-flash. Lead supplies direction and reviews; all application code belongs to the implementer.

## User direction

The user explicitly rejected the small courtyard and no longer requires the old village. Build an ambitious, substantially larger city. Retain the black-hole sky requested in the prior message. Blender is allowed if useful, but city geometry and real-time motion can be authored directly in the current Three.js/R3F stack. Do not turn this into a static concept image.

## Current problem and conventions

The scene at src/components/prototype/CourtyardScene.tsx:121 contains only two background halls; its overview at lines 128–132 uses radius 8.6 and a 420ms camera travel. This reads as a tiny arena.
Current excerpt:
    const OVERVIEW_RADIUS = 8.6
    const CAMERA_TRAVEL_SECONDS = 0.42
The existing character clock at src/components/prototype/CourtyardCharacter.tsx:283–321 correctly accumulates animation time only while playing and preserves paused poses. Extend this convention to traffic.
Keep source='simulation', separate freshness/work state, unknown/stale nonworking, transition-only celebration, keyboard roster, and explicit simulation disclosure.

## Visual target — Mythic City

A cinematic, inhabited harbor city under a spectacular black-hole sky. Midnight slate and oxidized copper architecture, warm amber windows, jade-blue canals. Architecture has setbacks, arcades, rooftop machinery, terraces, and spires. Use six distinct neighborhoods with roughly 80–120 visible buildings across a footprint several times larger than the old plaza. Density, silhouette, elevation changes, and connected streets matter more than the nominal count.

Arrange an asymmetric city: a tall stepped central citadel, an industrial foundry with cranes/chimneys, an archive quarter with a rotunda and courtyards, an observatory with dish/telescope silhouettes, a waterside port with piers/boats, and a transit gateway. Connect them with bridges, a canal, lit boulevards, and an elevated rail loop. No giant empty circular slab. Frame layers from foreground waterfront through medium-height blocks to distant towers. Reserve a visible sky band above the skyline for the black hole.

Keep five main synthetic workers, placed in open work plazas within occupied districts. Other buildings and transport are scenery, never fabricated agent telemetry. Preserve truthful roster counts.

## Three scales

1. City overview: whole connected urban composition, visible skyline and black hole. District labels show meaningful names and actual assigned-worker counts.
2. District focus: choosing a district from the map or a compact HTML navigator moves into its work plaza; associated workers can be selected. Unassigned districts clearly state no workers assigned.
3. Agent focus: current inspector, readable figure and task-specific animation. City and district return controls are reliable. Escape backs out one useful level or returns to city with no stuck inspector.

The city should fill most of the browser; labels/controls occupy quiet edges. Do not put product descriptions or renderer implementation details in the main UI. Short real controls: City, Districts, Needs you, Roster. Debug stats remain opt-in. Title: Mythic City.

## Motion direction

- Camera travel: 650ms for the rare city-to-district explanatory journey, 420ms for agent focus; smoothstep or existing ease-in-out math; retarget from current position when interrupted. Never reset orbit on unrelated HUD updates. Reduced motion snaps directly.
- Transit: one articulated 3-car tram loops along elevated tracks in about 35 seconds, oriented to the tangent. Boats follow canals in 40–60 seconds. Sparse street couriers follow actual roads with different deterministic phases. Constant route movement is linear in time; do not float randomly through buildings.
- Architecture: slow 24s observatory dish rotation and bounded foundry machinery motion. Small chimney steam if economical.
- Active work: tool gestures happen only for fresh active workers. Paused/unknown/stale workers must not simulate work. One-shot completion remains bounded and does not replay on render.
- Pause freezes scene movement, including traffic/ambient scenery. Reduced motion keeps readable still poses and static traffic. Skip hidden-tab animation deltas and clamp resumption deltas.
- HUD press feedback: transform scale(.97), 160ms ease-out. Panel transitions <=200ms with cubic-bezier(0.23,1,0.32,1). Keyboard roster movement is immediate. No perpetual blinking HUD.

## Implementation boundaries

Use the existing React19/TypeScript/Vite/R3F/Drei/Three stack and installed Phosphor icons. No unnecessary dependency or framework change.
Put deterministic city layout and repeated architecture into small prototype-local modules. Share/instance roofs, walls, windows, lamps and traffic geometry. Reuse vectors/matrices inside frame loops and avoid React state per frame. Keep one main shadow light; most background buildings receive shadows without hundreds of shadow casters. Cap DPR sensibly. Do not implement physics, procedural terrain engines, or pathfinding frameworks.
Restore BlackHoleBackdrop; original source honestly calls it a stylized shader, not actual ray tracing. If composition needs size/position controls, only add backward-compatible optional props with unchanged defaults, and pass explicit city settings. Do not silently change original app rendering.
Original source entry, telemetry and provider integrations stay untouched. Existing public assets may be reused if useful; original village restoration is CANCELLED.
Files: prototype.html, src/prototype-main.tsx, src/components/prototype/*, optional src/components/BlackHoleBackdrop.tsx, docs/courtyard-prototype.md. Lead owns this plan and review report.

## Verification and acceptance

Run npm run build, the focused scenario tests and npm run test:telemetry after final edits. Lead also builds prototype.html as a separate Rollup input and verifies the production preview.
Lead must SEE a dense connected city and black hole in the default frame. District buttons, district map labels, worker focus, return/escape, scenario attention, pause/replay must work. Check fresh console, mobile panel bounds, source labeling, and animation stops for pause/reduced motion.
Never report target frame rate or building count as measured unless verified. Capture the actual built result. A bigger disk, duplicate huts, static picture, or inaccessible city backdrop fails the brief.
