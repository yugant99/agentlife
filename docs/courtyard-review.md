# Courtyard prototype — lead review

Reviewed 2026-09-28. Implementer: OpenCode, opencode-go/deepseek-v4.1-flash. Lead role: direction, source review, browser QA, corrections, and checkpoint. All application code was written by the implementer.

## Result

A separate playable visual prototype at /prototype.html. Five synthetic workers, three workstations, focus/overview camera, keyboard roster, attention selection, and a deterministic scenario. The original app and telemetry source are unchanged. No dependencies added.

This is a visual and interaction checkpoint, not a live-agent release or the final art-quality bar. Keep React, TypeScript, Vite, React Three Fiber, Drei, and Three.js. A framework migration is not justified by this slice.

## Evidence on the final source candidate

- npm run build passed. Original main bundle filenames unchanged: index-axkDe7kC.js and index-QUdF1Do_.css.
- Scenario helper tests: 7/7 passed. Telemetry safety tests: 2/2 passed.
- Separate production build with Rollup input prototype.html passed. Default npm run build intentionally excludes the prototype entry.
- Prototype output: prototype-Cx6rHcNY.js, 1,178.93 kB / 324.55 kB gzip; prototype-C6_oku7O.css, 11.48 kB / 2.70 kB gzip. Vite reports its large-chunk warning.
- Production preview reviewed at http://127.0.0.1:5176/prototype.html, 1280×720. Overview, Needs you → Astrid, inspector provenance, and close-to-overview verified. Fresh preview tab had no captured warning/error logs.
- Dev UI verified all nine manual transitions and their counts, stale/recovery behavior, end-of-scenario Step disabled, Replay/Pause, roster ArrowDown + Enter selection, and Escape clearing selection.
- Mobile 390×844: after scoped border-box correction, counts and inspector measured x=10..380; close button x=343..365. Persistent simulation disclosure remains visible.
- Reduced-motion media emulation activated successfully and the selected scene rendered in the still-pose mode. Detailed animation timing was not instrumented.
- Five-agent dev sample at 1280×720 reported roughly 217–222 draw calls and 16.7–23.4 ms average frame intervals in brief snapshots. These are observations on this host, not a benchmark or performance guarantee.

## Review corrections applied by DeepSeek

1. Replaced the overpowering reused black-hole backdrop with a restrained dusk environment; brought camera and lighting toward the figures.
2. Enlarged and reoriented characters; gave the three stations clearer silhouettes and functional props.
3. Fixed close/Escape/overview selection clearing and hid unrelated station labels during focus.
4. Made source literally simulation, with provider displayed separately as an example; removed fabricated model IDs.
5. Made pause preserve celebration progress and added reduced-motion handling.
6. Added WebGL capability/error handling and bounded loading behavior.
7. Fixed buried pavers, moss, paths, and feet by establishing the walking surface at y=0 and lowering the platform/outer terrain coherently.
8. Fixed mobile panel clipping with scoped border-box sizing.

## Remaining gates

- No live event bridge or real-agent control. All displayed work is synthetic and explicitly labeled.
- Art is still a procedural blockout. More authored character silhouettes, task-specific tool contact, stronger material treatment, and coherent animation cycles are needed to reach the reference's visual character.
- On narrow screens, an expanded roster can cover part of the inspector. Collapse the roster to inspect; resolve this interaction before integrating the UI as the default application.
- WebGL-unavailable fallback was source-reviewed, not fault-injection verified: the browser tool did not support adding the startup interception script. Context-loss recovery was not exercised.
- 20-agent stress/performance and precise rendered character pixel heights were not measured. Do not promote camera math targets to measured results.
- No remote is configured, so this is a local checkpoint only.

## Next bounded implementation assignment

Keep the current application running. First resolve the narrow-screen roster/inspector interaction. Then connect one real OpenCode session to a small event adapter with stable agent/run IDs, event IDs, source timestamp, work state, and freshness. Preserve unknown and stale states; never infer work merely from process existence. Keep simulation an explicit separate mode. Review actual event evidence and the rendered animation together before expanding to more providers or replacing the main entry.
