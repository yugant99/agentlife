# Experience — camera, interaction, sound

## 1. Audit

Today the layer is a competent viewer, not an experience. `CourtyardScene.tsx:84-184` (`CameraRig`) eases city/district in 0.65 s and agent in 0.42 s with smoothstep, retargeting from the current pose; `reducedMotion` snaps (`140-151`). Config is fixed: FOV 40, `CAMERA_DIR (0.42,0.5,0.76)`, city target `(0,8,0)`, first frame already at `[79.8,103,144.4]` (`27-31`) so there is deliberately no intro drift. Controls are bare `OrbitControls` (`1277-1286`): `enablePan=false`, damping, distance 5–420, polar 0.22–1.42. DPR is capped `[1,1.6]` (`32`), one shadow light (`1215-1228`).

Navigation lives in `prototype-main.tsx:120-186`: `goCity/goDistrict/selectAgent` bump `focusRevision`, `Escape` backs one level (agent→district→city), `needsYou` cycles `nextAttentionCity` (`scenarioBridge.ts:109-114`). HUD (`CourtyardHud.tsx:291-428`) has City / Districts / Needs-you / Roster / Pause, plus a one-line hint (`401`: "Pick a district or a figure…"). Roster rows have arrow/Home/End keys (`142-153`); figures click with drag-reject `delta>6` (`CourtyardCharacter.tsx:444-459`); district labels are drei `Html` buttons (`CourtyardScene.tsx:1139-1149`) forced below HUD (`prototype.css:75-76`). Loading is a veil ("Preparing the city…", `prototype-main.tsx:107-110`, `prototype.css:61-71`). There is no tour, no follow-cam, no touch-specific handling, no sound, no Notification/share path, no first-run legend.

Three biggest weaknesses:

1. **First 10 s teach nothing.** Static wide shot + veil + tiny hint. A newcomer never learns tool→district mapping (`agentModel.ts:84-95`), what amber means, or that click/Escape/N exist. Glance test fails: feels pretty, learns nothing.
2. **"Needs you" is easy to miss and easy to resent.** The beam (`Workers.tsx:464-484`) exists, but the camera jump-cuts to it with no off-screen indicator, no queue UI when 2+ agents need input (`cityCounts` in `scenarioBridge.ts:88-98`), and no guard against yanking the camera mid-orbit. No audio or title-badge fallback when the tab is hidden.
3. **No passive or social story.** No idle attract loop for a second monitor, no opt-in ambient bed, no screenshot/share preset, keyboard is Escape-only plus hidden roster keys, mobile is only a bottom-sheet fallback (`prototype.css:412-448`). Reduced-motion handling is good (snap + frozen clocks) and must be preserved.

## 2. 10x vision

Mythic City should feel like a night-harbor mission control that notices you: it opens with a slow 3-second harbor-to-citadel glide that lands on live work, it nudges — never grabs — your eye when a human is truly needed, it hums quietly if you ask it to, and it idles beautifully on a side monitor. Art direction: warm tungsten work-light vs. cold abyss sky, one amber "needs-you" accent, soft depth-of-field-free legibility, everything else stays dark and quiet.

## 3. Ranked moves

**M1 — Needs-you director (never annoying).** Impact 5, Effort M. Perf: 0 extra draw calls; 1 Html wedge + 1 toast div; <0.1 ms/frame. Data hook: `workState==='needs-input' && freshness==='fresh'` (`cityAttentionQueue`); count from `cityCounts.needsYou`. Dependencies: agents (keep beam as ground truth), lighting (don't restyle beam here). Behavior: pressing Needs-you (or `N`) flies to next in queue with "2 of 3" pill; if target is off-screen, show a screen-edge amber wedge pointing toward its projection instead of moving; suppress auto-move within 3 s of user orbit input; when tab hidden, bump `document.title` ("● 2 need you") and optional Notification only on fresh transition.

**M2 — First-10-seconds arrival.** Impact 5, Effort S/M. Perf: reuses existing `CameraRig` lerp; legend is 4 HTML chips; 0 draw calls. Data hook: scenery + live `cityCounts` for legend numbers. Dependencies: datamap (district names), agents (slot clarity). Behavior: on first ready, 2.8 s dolly from 1.25× distance to default, then fade in legend chips (Foundry=build, Archive=read, Observatory=check, Port=ship, Citadel=you) with live counts; "Follow a worker ▸" button picks a fresh-active agent; dismiss on any input; skipped entirely under `prefers-reduced-motion`.

**M3 — Opt-in synthesized sound bed (no assets).** Impact 4, Effort S. Perf: ~4 Oscillator/Noise nodes + 2 Biquad + Gain; <1% CPU, 0 draw calls; suspends when tab hidden. Data hook: `phase`/`toolKind`/`workState` transitions only. Dependencies: none (pure WebAudio). Tasteful rules: default OFF with speaker toggle (`M`); master −24 dB, lowpass harbor noise + slow fifth-pad; one-shot cues only — soft pluck (arrival), two-note amber chime (needs-input, max 1/8 s), woodblock tick (ship `shipCount` change), muted thump (complete); no loop tied to movement; honors reduced-motion by staying off until explicitly enabled.

**M4 — Attract/screensaver tour for second monitors.** Impact 4, Effort M. Perf: same scene, DPR drops to 1.0 in tour, captions are 1 div; pauses when hidden. Data hook: scenery + `cityCounts`/`preferredDistrict` for captions ("Foundry — 3 building"). Dependencies: sky/water/streets (keep landmarks framed, don't redesign). Behavior: 60 s idle (no pointer/key/orbit) → slow 24 s/orbit drift at district height visiting 3 districts + harbor, lower-third caption per stop; any input or needs-input chime exits to prior view; `?attract=1` forces it; disabled under reduced-motion (static captioned still instead).

**M5 — Follow-cam + district chapters.** Impact 4, Effort M. Perf: reuses `agentPositions`; +1 lerp/frame. Data hook: `agentPositions` (from `layoutTargets`), `phase`/`toolKind` for caption. Dependencies: agents (keep walk speed truthful). Behavior: in agent view, toggle Follow (key `F`) keeps camera glued at 14-unit offset while worker walks; district view gains chapter tabs (Forge/Steps/Terrace/Quay) that frame the work-spot ring, not the district centroid.

**M6 — Keyboard/touch power controls + cheat sheet.** Impact 3, Effort S. Perf: DOM only. Data hook: scenery (view state) + attention queue for `N`. Dependencies: HUD (add `?` sheet). Keys: `C` city, `1-6` districts, `N` next needs-you, `F` follow, `S` screenshot, `Space` pause, `Esc` back, `?` sheet; touch: horizontal two-finger swipe cycles attention, long-press figure selects; all buttons ≥40 px, focus-visible already in CSS (`prototype.css:406-407`).

**M7 — Share-a-shot + background nudge.** Impact 3, Effort S. Perf: one `canvas.toDataURL` on demand only. Data hook: `cityCounts` stamped into caption. Dependencies: none. `S` captures 1080p PNG (temporarily set DPR 2, restore), copies "Mythic City — 3 working, 1 needs you [PNG]" markdown; title-badge + optional Notification cover hidden-tab needs-input; never auto-request permission — ask once from the Needs-you button.

## 4. Signature moment

The amber summons: city at night, tram crossing the rail loop, and a single 40-unit amber beam rising from the Citadel steps while the camera sits low over the harbor — water, canal and rail leading the eye to it, lower-third reading "Citadel — Ada needs you · shell→Foundry walk". One frame tells the whole product: agents work, one needs a human, the city knows where. Pressing `S` there is the postcard.

## 5. Build sketch for the top 3 moves

**M1 Director.** Technique: project each queued agent to NDC each 250 ms (`Vector3.project`), place 4 edge wedges (rotated divs); fly with existing `CameraRig` but replace smoothstep with `easeInOutCubic` and 0.9 s city→agent, interruptible (store `fromPos` on each `revision`). Files: `prototype-main.tsx` (+60 lines: wedge state, idle-guard, title badge), `CourtyardScene.tsx` (+40: ease fn, `followAgent` prop), new `AttentionWedge.tsx` (~70 lines). LOC ~170. Pitfalls: don't fight OrbitControls — disable during flight then re-enable (`controls.enabled=false` pattern already at `160`); don't loop transitions — diff queue ids, chime only on new id; wedge must hide when target on-screen (dot with camera dir >0.9).

**M2 Arrival.** Technique: `introDone` ref in `PrototypeApp`; on `onReady`, set `view` to a synthetic `{scale:'city'}` with `introFrom=pos*1.25+up12`, animate 2.8 s `easeOutCubic` once; legend chips are HUD divs reading `cityCounts(agents)`; "Follow" calls existing `selectAgent` on first fresh-active. Files: `prototype-main.tsx` (+50), `CourtyardHud.tsx` (+60 legend + button), `prototype.css` (+40 fade). LOC ~150. Pitfalls: must not refire on source switch or StrictMode double-mount — gate on `sessionStorage.introSeen`; reduced-motion and `?noIntro` skip to final pose; ensure `focusRevision` bump doesn't retrigger tour.

**M3 Sound.** Technique: lazy `AudioContext` on first toggle; graph: `noiseBuffer(2s)→lowpass(400Hz)→bedGain(0.05)` + `2×Osc(sine 110/165Hz)→padGain(0.02)→lowpass`; cues via `oscillator + gainEnvelope(0.001/0.6s)`; subscribe to `agents` diff in `prototype-main` effect (compare `workState` by id). Files: new `citySound.ts` (~140 lines, no deps), `CourtyardHud.tsx` (+25 toggle), `prototype-main.tsx` (+30 cue wiring). LOC ~195. Pitfalls: autoplay policy — create/resume only in click handler; iOS requires `webkitAudioContext` fallback; never store audio in React state (refs only); test with `?debug=1` showing "sound: on/off" without extra renders.

## 6. Cut list

- Cut the 6 s fallback veil (`prototype-main.tsx:107-110`) once `onReady` is reliable — it guarantees a dead first impression; keep the error fallback only.
- Cut pixel-perfect agent framing (`pixelDist` 150 px at `CourtyardScene.tsx:132-133`) as the sole rule — replace with ring-aware framing (M5) so crowds don't clip.
- Don't add: camera shake, DOF/bloom postprocessing, minimap, voice, or per-district music stems — each costs GPU/memory and fights the "one amber accent" direction; achieve depth with fog + existing window glow.
- Don't auto-enable sound, notifications, or attract motion — all three default off / still under reduced-motion.

## 7. Sources

- https://docs.pmnd.rs/react-three-fiber/getting-started/introduction — R3F render-loop + ref-driven animation pattern (no state per frame).
- https://threejs.org/examples/ — orbit/camera transition references; OrbitControls damping limits used here.
- https://threejs.org/docs/index.html#api/en/controls/OrbitControls — enable/disable during flights, polar/distance clamps.
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API — AudioContext graph, Gain/Envelope, autoplay-resume pattern for the synth bed.
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion — snap/no-tour/no-auto-sound rules.
- Game attention-direction pattern (edge wedges + interruptible flights, no camera yank) informed by the above camera docs and standard mission-control UX; no copied code or assets — all procedural.
