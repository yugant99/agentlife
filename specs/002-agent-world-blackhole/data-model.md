# Data Model: Agent Village and Black Hole Backdrop

**Status**: Planning only. No code changes, no migrations, no runtime checks run.

## Principle

`AgentRecord` and telemetry truth are **unchanged**. The black-hole backdrop introduces **scene-only visual state** that is decorative, derived at render time, and never persisted, never sent to any adapter, and never read back as data. This enforces constitution III (visuals are never evidence).

## Unchanged: authoritative telemetry entities

| Entity | Shape (existing) | Ownership | Notes |
|---|---|---|---|
| `AgentRecord` | `src/types.ts:15-47` — `id, provider, model, title, status, activity, updatedAt, district, stale?, historical?, reportedStatus?, ...` | Server adapters + `useTelemetry` | No new fields. No backdrop input reads `title/activity/model/usage`. |
| `TelemetryResponse` | `src/types.ts:58-65` — `mode, records, providers, diagnostics, fetchedAt` | Server | Backdrop never alters mode, counts, or timestamps. |
| `DistrictId` | Seven fixed ids (`great-hall … dock`) | `src/types.ts:49-57` + `src/data/demo` | Backdrop placement must not move anchors or rename districts. |
| `SourceMode` | `'live' \| 'simulation'` | `src/App.tsx`, `useTelemetry` | Backdrop identical in both modes; watermark/stale behavior untouched. |

## New/adjusted: scene-only visual state (not telemetry)

| Entity | Fields | Lifecycle | Constraints |
|---|---|---|---|
| `BackdropPlacement` | camera-relative direction/size, `depthWrite: false`, background render order | Stable relative to the camera during orbit | Must remain behind village geometry and labels; never casts/receives shadows or blocks pointer hits. |
| `BlackHoleVisualParams` | `innerRadius`, `diskInner/OuterRadius`, `diskTilt`, `glowIntensity`, `skyTint` | Static defaults; tuned constants only | No binding to status/counts/progress. Same values for live and simulation. |
| `BackdropMotionState` | `diskRotationSpeed`, `pulseAmplitude`, `frozen: boolean` | `frozen = reducedMotion \|\| effectDisabled` | When frozen, render one legible still; motion never carries meaning. |
| `GraphicsFallbackState` | `webglAvailable: boolean`, `effectEnabled: boolean` | WebGL absent → Canvas fallback and CSS sky; optional shader disabled → simple static sky within Canvas | Without WebGL the 3D village is unavailable, while roster/inspector remain usable; no synthetic records substituted. |

## Relationships

- `VillageWorld` renders `BackdropPlacement + BlackHoleVisualParams` **independently** of `AgentRecord[]`; records flow only to `District → Worker` overlays as today.
- `reducedMotion: boolean` (from `App.tsx` media query) drives `BackdropMotionState.frozen`; the effect does not infer device capability or telemetry state from agent records.
- No foreign keys from visual state back into telemetry; no visual state stored in `AgentRecord`, `TelemetryResponse`, or any adapter payload.

## Explicit non-goals

- No new tables, files-as-storage, telemetry fields, or persisted settings.
- No per-agent visual encoding (color/size/position of the hole never reflects status, provider, or counts).
- No animation clips or edits to the existing AGPL map.
