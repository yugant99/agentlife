// Showcase mode (`?showcase=1`): a recording-friendly city. Pure: no DOM, no
// three.js, no React, so plain Node tests can load it. The shell hides the HUD,
// pins a steady quality tier, stays on the simulated day (no live workspace
// names on screen) and drives a slow camera reel between skyline poses that put
// the black hole in frame. Any user input releases the camera; the reel resumes
// after a short idle.

import type { CameraShot, QualityTier } from './sceneControl.ts'

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
