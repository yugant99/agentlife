// Showcase mode (`?showcase=1`): a recording-friendly city. Pure: no DOM, no
// three.js, no React, so plain Node tests can load it. The shell hides the HUD,
// pins a steady quality tier and stays on the simulated day (no live workspace
// names on screen). On load it plays a ~45 s story once (STORY_BEATS: skyline,
// the Toronto waterfront as a ship leaves the Port, an agent needing you, the
// dashboard), then settles into a slow camera drift between skyline
// poses that put the black hole in frame. Any user input releases the camera
// and ends the story; the drift resumes after a short idle. Reload to replay.

import type { CameraShot, QualityTier } from './sceneControl.ts'
import type { ScenarioAgent } from './scenario.ts'
import { distanceForStop, positionFor, targetForStop } from './tour.ts'

/** Vertical field of view of the scene camera, in degrees. */
export const SCENE_FOV_DEG = 40

/** World-locked direction of the black hole in the sky (decorative). */
export const BLACK_HOLE_DIRECTION: [number, number, number] = [0.03, 0.21, -1.0]

// On-screen extent of the hole at the scene's backdrop size (0.8), in degrees
// from its centre, measured from a medium-tier render. The lensed arcs are much
// wider than they are tall, so a square crop clips their tips; the hole and its
// inner ring (the core) always fit.
/** Half-width of the lensed arcs (left/right of the hole centre). */
export const BLACK_HOLE_ARC_HALF_WIDTH_DEG = 19
/** Half-height of the lensed arcs (above/below the hole centre). */
export const BLACK_HOLE_ARC_HALF_HEIGHT_DEG = 9
/** Radius of the hole plus its bright inner ring. */
export const BLACK_HOLE_CORE_DEG = 5

/** Normal orbit limit: the camera always looks at least ~9 degrees down. */
export const DEFAULT_MAX_POLAR = 1.42
/** Showcase orbit limit (~94.5 degrees): lets a skyline shot look slightly up. */
export const SHOWCASE_MAX_POLAR = 1.65

/** Tier used when showcase is on and `?quality=` does not pin one. */
export const SHOWCASE_DEFAULT_QUALITY: QualityTier = 'medium'

/** First move: from wherever the camera is to the first pose. */
export const SHOWCASE_FIRST_SHOT_MS = 5000
/** Each later move between poses (slow drift; eased in and out). */
export const SHOWCASE_SHOT_MS = 24000
/** Idle time after user input before the reel takes the camera back. */
export const SHOWCASE_RESUME_MS = 8000

/** View-change camera moves (district, agent, city) run this much slower in showcase. */
export const SHOWCASE_TRAVEL_SCALE = 5

export interface ShowcasePose {
  position: [number, number, number]
  target: [number, number, number]
}

// Skyline poses from the south (+z) looking north, aimed straight at the hole
// (yaw ~1.7 degrees east) and pitched two degrees up so the arcs clear the top
// edge with margin. The camera sits well west of centre so the two tall towers,
// the CN Tower (-17, 45) and the hero needle (15, 15), stand to the right of
// the hole against its arc instead of cutting through it. The drift is a slow
// dolly in and down.
export const SHOWCASE_POSES: readonly ShowcasePose[] = [
  { position: [-40, 45, 170], target: [-35.5, 50.24, 20.16] },
  { position: [-36, 36, 150], target: [-31.5, 41.24, 0.16] },
]

/** `?showcase=1` turns showcase mode on. */
export function parseShowcaseFlag(search: string): boolean {
  try {
    return new URLSearchParams(search).get('showcase') === '1'
  } catch {
    return false
  }
}

/** An explicit `?quality=` always wins; showcase otherwise pins its default. */
export function showcaseQuality(pinned: QualityTier | null, showcase: boolean): QualityTier | null {
  if (pinned) return pinned
  return showcase ? SHOWCASE_DEFAULT_QUALITY : null
}

/** The reel's shot for a step: poses alternate; the first move is quicker. */
export function showcaseShot(step: number, seq: number): CameraShot {
  const safeStep = Number.isFinite(step) && step > 0 ? Math.floor(step) : 0
  const pose = SHOWCASE_POSES[safeStep % SHOWCASE_POSES.length]
  return {
    id: `showcase-${seq}`,
    position: [...pose.position],
    target: [...pose.target],
    durationMs: safeStep === 0 ? SHOWCASE_FIRST_SHOT_MS : SHOWCASE_SHOT_MS,
  }
}

// --- Framing math (used by tests to keep the hole in frame) -------------------

function normalize(v: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2])
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 0]
}

/** OrbitControls polar angle of a pose: angle between (camera - target) and +y. */
export function polarAngle(pose: ShowcasePose): number {
  const offset = normalize([
    pose.position[0] - pose.target[0],
    pose.position[1] - pose.target[1],
    pose.position[2] - pose.target[2],
  ])
  return Math.acos(Math.max(-1, Math.min(1, offset[1])))
}

/**
 * Where a world direction lands relative to the pose's view centre, in degrees:
 * `up` is elevation above the centre line, `right` is yaw to the right of it.
 */
export function directionInView(pose: ShowcasePose, direction: readonly [number, number, number]): { up: number; right: number } {
  const view = normalize([
    pose.target[0] - pose.position[0],
    pose.target[1] - pose.position[1],
    pose.target[2] - pose.position[2],
  ])
  const dir = normalize(direction)
  const deg = 180 / Math.PI
  const elevation = (v: [number, number, number]) => Math.asin(v[1]) * deg
  const yaw = (v: [number, number, number]) => Math.atan2(v[0], -v[2]) * deg
  return { up: elevation(dir) - elevation(view), right: yaw(dir) - yaw(view) }
}

// --- Story (plays once on load) -----------------------------------------------

/**
 * The story starts the simulated day at this step, so its scripted arc lands on
 * cue (one step per DWELL_MS = 5.2 s): Bjorn walks Foundry -> Observatory at
 * ~5 s, Yrsa arrives through the Gateway at ~10 s, Astrid ships (a freighter
 * leaves the Port) at ~16 s, Sigrid needs a human call at ~26 s.
 */
export const STORY_START_STEP = 9

export interface StoryBeat {
  name: 'skyline' | 'skyline-drift' | 'ship' | 'rise' | 'needs-you' | 'dashboard'
  /** Camera move for the beat (glide length is durationMs). */
  shot: Omit<CameraShot, 'id'>
  /** Time from this beat's start to the next beat's start. */
  holdMs: number
  /** HUD and district tags visible during the beat. */
  hud: boolean
  /**
   * 'needs-you': hand the camera to the scene's agent view for the agent waiting
   * on you as soon as one exists (the inspector says why while the HUD is up).
   */
  follow: 'none' | 'needs-you'
}

function stopShot(stop: Parameters<typeof targetForStop>[0], durationMs: number): Omit<CameraShot, 'id'> {
  const target = targetForStop(stop)
  return { position: positionFor(target, distanceForStop(stop)), target, durationMs }
}

// Port beat: the waterfront from south-west of the harbor looking north-east:
// piers, the departing freighter (dock -54,44 -> exit -69,58), Rogers Centre and
// the CN Tower. Far enough south that glides into and out of it stay clear of
// the CN Tower.
const SHIP_SHOT: Omit<CameraShot, 'id'> = { position: [-80, 28, 112], target: [-55, 8, 45], durationMs: 3000 }

// Rise beat: the camera lifts high over the city before diving to the Citadel,
// so the glide from the harbor never cuts through roofs (moves are straight
// lines between poses).
const RISE_SHOT: Omit<CameraShot, 'id'> = { position: [0, 70, 75], target: [0, 2, 20], durationMs: 2000 }

// Needs-you beat: hold the rise pose until an agent needs you, then the shell
// hands the camera to the scene's agent view, which flies (at
// SHOWCASE_TRAVEL_SCALE) to that agent's Citadel slot as they walk in under the
// beam. A fixed shot can't do this: the agent's slot is only known in the scene.

export const STORY_BEATS: readonly StoryBeat[] = [
  { name: 'skyline', shot: { ...SHOWCASE_POSES[0], durationMs: 4500 }, holdMs: 4500, hud: false, follow: 'none' },
  { name: 'skyline-drift', shot: { ...SHOWCASE_POSES[1], durationMs: 8000 }, holdMs: 8000, hud: false, follow: 'none' },
  { name: 'ship', shot: SHIP_SHOT, holdMs: 11300, hud: false, follow: 'none' },
  { name: 'rise', shot: RISE_SHOT, holdMs: 2000, hud: false, follow: 'none' },
  { name: 'needs-you', shot: { ...RISE_SHOT, durationMs: 400 }, holdMs: 12500, hud: true, follow: 'needs-you' },
  { name: 'dashboard', shot: stopShot({ kind: 'city' }, 3500), holdMs: 6500, hud: true, follow: 'none' },
]

/** Total story length before the skyline drift takes over. */
export const STORY_TOTAL_MS = STORY_BEATS.reduce((sum, beat) => sum + beat.holdMs, 0)

/** Start time of each beat from the story start. */
export function storyBeatStarts(): number[] {
  const starts: number[] = []
  let at = 0
  for (const beat of STORY_BEATS) {
    starts.push(at)
    at += beat.holdMs
  }
  return starts
}

/** Camera shot for a story beat; seq must be fresh per beat. Copies the arrays. */
export function storyShot(index: number, seq: number): CameraShot {
  const beat = STORY_BEATS[Math.max(0, Math.min(STORY_BEATS.length - 1, Math.floor(index) || 0))]
  return {
    id: `showcase-story-${seq}-${beat.name}`,
    position: [...beat.shot.position],
    target: [...beat.shot.target],
    durationMs: beat.shot.durationMs,
  }
}

// --- Showcase cast ------------------------------------------------------------
//
// The simulated day ships with a mythic cast (Sigrid, Bjorn, ...) on purpose, but
// a recording should show what the city is for: Claude Code, Codex and OpenCode
// agents. In showcase the shell relabels the simulated agents and the event line
// before they reach the scene and HUD. Still synthetic data: no live sessions,
// no real workspace names. Scenario mechanics (who walks where, when) are
// unchanged; only names, roles, providers and wording change.

export interface ShowcaseCastEntry {
  name: string
  role: string
  provider: ScenarioAgent['provider']
}

export const SHOWCASE_WORKSPACE = 'mythic-city'

export const SHOWCASE_CAST: Readonly<Record<string, ShowcaseCastEntry>> = {
  sigrid: { name: 'Claude Code', role: 'Schema migration', provider: 'claude-code' },
  astrid: { name: 'Claude Code · release', role: 'Release notes', provider: 'claude-code' },
  bjorn: { name: 'Codex', role: 'Test runner', provider: 'codex' },
  loom: { name: 'Codex sub-agent', role: 'Fixture search', provider: 'codex' },
  halvard: { name: 'Codex · old run', role: 'Archived run', provider: 'codex' },
  eirik: { name: 'OpenCode', role: 'Parser refactor', provider: 'opencode' },
  yrsa: { name: 'OpenCode · docs', role: 'Docs sweep', provider: 'opencode' },
}

export const SHOWCASE_EVENT_LABELS: Readonly<Record<string, string>> = {
  'Scenario started — five agents checked in.': 'Five agents checked in: Claude Code, Codex and OpenCode.',
  'Astrid received the human call and raised the banner.': 'Claude Code (release) got your answer and resumed.',
  'Astrid paused the run — a second decision is needed.': 'Claude Code (release) paused — it needs a second decision.',
  'Astrid resumed after the call was made.': 'Claude Code (release) resumed after your call.',
  'Astrid completed the banner run.': 'Claude Code (release) finished the release notes.',
  'Eirik checked in and asks for a schema call.': 'OpenCode checked in and asks about the parser API.',
  'Eirik received the call and started forging.': 'OpenCode got your answer and started refactoring.',
  "Eirik's snapshot went stale — work is paused, not counted.": 'OpenCode went quiet — paused, not counted.',
  "Eirik's snapshot recovered and work resumed.": 'OpenCode is back and refactoring again.',
  'Sigrid completed the planning pass.': 'Claude Code finished reading the schema.',
  'Bjorn switched to the test bench — walking to the Observatory.': 'Codex started the test suite — walking to the Observatory.',
  'Yrsa arrived through the Gateway arch.': 'OpenCode (docs) arrived through the Gateway.',
  'Astrid shipped the banner run — a boat leaves the Port.': 'Claude Code (release) shipped v0.3 — a boat leaves the Port.',
  'Bjorn looped in a sub-agent beside the bench.': 'Codex spun up a sub-agent to search fixtures.',
  'Sigrid needs a human call — waiting on the Citadel steps.': 'Claude Code needs you: approve the schema migration?',
  "Eirik's snapshot went stale — sitting down.": 'OpenCode went quiet — sitting down.',
  'Halvard archived to past — walking out the Gateway.': 'An old Codex run was archived — walking out the Gateway.',
}

/** Relabel the simulated day for showcase (names, roles, providers, event line). */
export function showcaseCastState<S extends { agents: readonly ScenarioAgent[]; lastEvent: string }>(state: S): S {
  return {
    ...state,
    agents: state.agents.map((agent) => {
      const cast = SHOWCASE_CAST[agent.id]
      return cast ? { ...agent, ...cast, workspace: SHOWCASE_WORKSPACE } : agent
    }),
    lastEvent: SHOWCASE_EVENT_LABELS[state.lastEvent] ?? state.lastEvent,
  }
}
