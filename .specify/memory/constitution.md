# Mythic Agent Command Center Constitution

## Core Principles

### I. Local, Read-Only Telemetry
The command center is a standalone, local-only, read-only visualization of agent telemetry. Adapters read already-authenticated local CLIs, bind to loopback, and never mutate provider state. Features MUST NOT add write routes, prompt submission, model execution, or any remote asset or network dependency; the app MUST remain fully usable offline once installed. Browser-visible data stays limited to safe metadata (no prompts, message bodies, tool input/output, or credentials).

### II. Live and Simulation Stay Separate
Live and simulation are distinct, explicit, and never blended. Simulation is opt-in and visibly watermarked; live reads never synthesize records and never mix demo data in; a failed refresh retains the last snapshot as stale rather than substituting synthetic data. Any feature MUST preserve this boundary and the labels that expose it.

### III. Visuals Are Never Evidence
Scene motion, chore activity, props, smoke, and hover markers are decorative staging only. They MUST NOT alter, imply, cause, prove, or override any provider-reported fact — status, activity, provider, model, id, timestamps, or history. A worker visibly chopping wood, drawing water, or cooking is NOT a claim that the underlying agent is performing that real task, and no visual may be presented as proof of verified model work. The roster and inspector remain the authoritative, labelled source of operational detail.

### IV. Reduced Motion Is Honored
When the user requests reduced motion, scene animation and CSS loops MUST stop or reduce to a static, fully legible pose. Information MUST remain available without motion; motion is never the only carrier of meaning.

### V. Small Scope, No New Weight
Prefer the simplest change inside the existing React Three Fiber / Three.js components. Reuse shared geometry and materials, bound the number of visible props, keep per-frame cost sensible for dozens of workers, and avoid a forest of duplicate assets. Do not add remote assets, CDN requests, or heavy animation/character dependencies. Keep the map static and locally bundled.

### VI. Verification Is Explicit (NON-NEGOTIABLE)
Per the user's AGENTS rule, tests, builds, typechecks, smoke tests, browser QA, and other verification commands MUST NOT be run unless the user explicitly requests them. Planning and implementation may proceed without running them. Do not invent or mandate a test pipeline, and do not treat an unrun command as a passing result. When commands are requested, report exactly what was run and what was observed.

## Additional Constraints

- **Preserved behaviors**: history placement (historical records ambient, stale records neutral), status labels and colours, click-to-select (with orbit-drag not selecting), the live/simulation source control, and the local-only boundary MUST remain accurate for the same inputs.
- **Accessibility**: the roster and inspector are the accessible source of detail; decorative scene elements stay out of the accessibility tree (`aria-hidden`), and hover markers never block pointer interaction with the scene.
- **Attribution**: redistributed map assets and fonts keep their AGPL-3.0 license text and local hosting.

## Development Workflow

Changes stay scoped to the smallest set of existing files that satisfies the feature. New modules are added only when they clearly reduce complexity. Visual changes are validated against the preserved-behavior list above, and any claim of success is limited to what was actually observed.

## Governance

This constitution supersedes ad-hoc practice for this project. Amendments require a written change to this file, an updated version number, and a note of what changed. Every plan and implementation review MUST verify compliance with these principles; a feature that cannot comply must be redesigned rather than granted an exception. Complexity beyond the simplest viable change must be justified in the plan's Complexity Tracking.

**Version**: 1.0.0 | **Ratified**: 2026-09-23 | **Last Amended**: 2026-09-23
