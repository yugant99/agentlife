// Attract tour + arrival glide math (Wave 3 Lane 3C). Pure: no DOM, no three.js,
// no React, so plain Node tests can load it. The shell owns timers and the
// `shot` prop; this module builds the stop queue, frames stops from city.ts
// centers, and exposes the skip/flag helpers. Queue order: needs-you districts
// first, then busy districts, then the city overview.

import type { CityAgent } from './agentModel.ts'
import { preferredDistrict } from './agentModel.ts'
import { DISTRICTS, WORK_SPOTS, districtById } from './city.ts'
import type { DistrictId } from './city.ts'
import { urgencySort } from './datamap.ts'
import type { CameraShot } from './sceneControl.ts'

/** Idle time with no input before the attract tour starts itself. */
export const ATTRACT_IDLE_MS = 60000
/** Time each tour stop holds before advancing. */
export const TOUR_SHOT_MS = 6000
/** Arrival glide: far framing eases home over this long. */
export const INTRO_DURATION_MS = 2800
/** Arrival glide starts this multiple of the default city distance out. */
export const INTRO_DISTANCE_FACTOR = 1.25

/** Minimal agent view the tour needs. CityAgent records satisfy it structurally. */
export type TourAgent = Pick<CityAgent, 'id' | 'workState' | 'freshness' | 'lastSignalAt' | 'toolKind'>

export type TourStop =
  | { kind: 'needs-you'; districtId: DistrictId; agentId: string }
  | { kind: 'district'; districtId: DistrictId }
  | { kind: 'city' }

/**
 * Build the stop queue: needs-you districts first (oldest waiter first, one stop
 * per district), then districts with fresh-active work (busiest first, ties keep
 * DISTRICTS order), then the city overview. Always ends with the city stop.
 */
export function buildTourQueue(agents: readonly TourAgent[]): TourStop[] {
  const stops: TourStop[] = []
  const visited = new Set<DistrictId>()

  const needy = urgencySort(
    agents.filter((agent) => agent.freshness === 'fresh' && agent.workState === 'needs-input'),
  )
  for (const agent of needy) {
    const districtId = preferredDistrict(agent)
    if (visited.has(districtId)) continue
    visited.add(districtId)
    stops.push({ kind: 'needs-you', districtId, agentId: agent.id })
  }

  const activeBy = new Map<DistrictId, number>()
  for (const agent of agents) {
    if (agent.freshness !== 'fresh' || agent.workState !== 'active') continue
    const districtId = preferredDistrict(agent)
    activeBy.set(districtId, (activeBy.get(districtId) ?? 0) + 1)
  }
  const busy = DISTRICTS.filter(
    (district) => (activeBy.get(district.id) ?? 0) > 0 && !visited.has(district.id),
  ).sort((a, b) => (activeBy.get(b.id) ?? 0) - (activeBy.get(a.id) ?? 0))
  for (const district of busy) {
    visited.add(district.id)
    stops.push({ kind: 'district', districtId: district.id })
  }

  stops.push({ kind: 'city' })
  return stops
}

// --- Framing -----------------------------------------------------------------

/** Scene city target (matches CourtyardScene CITY_TARGET). */
export const CITY_TARGET: [number, number, number] = [0, 8, 0]
/** Default city distance: FOV-40 fit of CITY_RADIUS x 1.05 (~190, matches CAMERA_CONFIG). */
export const CITY_DISTANCE = 190
/** District target height (matches the scene's district target). */
export const DISTRICT_TARGET_Y = 16
/** Needs-you stops frame the work spot up close. */
export const NEEDS_YOU_DISTANCE = 30
export const NEEDS_YOU_TARGET_Y = 2

/** Scene camera direction (matches CourtyardScene CAMERA_DIR), unit length. */
export const CAMERA_DIR: [number, number, number] = (() => {
  const x = 0.42
  const y = 0.5
  const z = 0.76
  const len = Math.hypot(x, y, z)
  return [x / len, y / len, z / len]
})()

const SIN_HALF_FOV = Math.sin((20 * Math.PI) / 180)

/** Landscape fit matching the scene: radius x 1.2 margin x 1.05 through FOV 40. */
export function distanceForDistrict(radius: number): number {
  return ((radius * 1.2) / SIN_HALF_FOV) * 1.05
}

export function targetForStop(stop: TourStop): [number, number, number] {
  if (stop.kind === 'city') return [...CITY_TARGET]
  if (stop.kind === 'needs-you') {
    const spot = WORK_SPOTS[stop.districtId]
    return [spot.center[0], NEEDS_YOU_TARGET_Y, spot.center[1]]
  }
  const district = districtById(stop.districtId)
  return [district.center[0], DISTRICT_TARGET_Y, district.center[1]]
}

export function distanceForStop(stop: TourStop): number {
  if (stop.kind === 'city') return CITY_DISTANCE
  if (stop.kind === 'needs-you') return NEEDS_YOU_DISTANCE
  return distanceForDistrict(districtById(stop.districtId).radius)
}

export function positionFor(target: [number, number, number], distance: number): [number, number, number] {
  return [
    target[0] + CAMERA_DIR[0] * distance,
    target[1] + CAMERA_DIR[1] * distance,
    target[2] + CAMERA_DIR[2] * distance,
  ]
}

function stopKey(stop: TourStop): string {
  if (stop.kind === 'city') return 'city'
  if (stop.kind === 'district') return stop.districtId
  return `${stop.districtId}-${stop.agentId}`
}

/** Frame one tour stop. seq must be fresh per stop: a new id starts a new move. */
export function shotForStop(stop: TourStop, seq: number): CameraShot {
  const target = targetForStop(stop)
  return {
    id: `tour-${seq}-${stopKey(stop)}`,
    position: positionFor(target, distanceForStop(stop)),
    target,
    durationMs: TOUR_SHOT_MS,
  }
}

/** First-frame snap ~1.25x out, so the arrival glide has somewhere to come from. */
export function introFromShot(): CameraShot {
  const target: [number, number, number] = [...CITY_TARGET]
  return {
    id: 'intro-from',
    position: positionFor(target, CITY_DISTANCE * INTRO_DISTANCE_FACTOR),
    target,
    durationMs: 1,
  }
}

/** The glide home: default framing over 2.8 s. The shell clears it to null after. */
export function introToShot(): CameraShot {
  const target: [number, number, number] = [...CITY_TARGET]
  return {
    id: 'intro',
    position: positionFor(target, CITY_DISTANCE),
    target,
    durationMs: INTRO_DURATION_MS,
  }
}

// --- Driver (tiny pure state machine; the shell owns the timers) --------------

export interface TourState {
  active: boolean
  stopIndex: number
}

export function startTourState(): TourState {
  return { active: true, stopIndex: 0 }
}

/** Yield: any user input stops the tour and the shell clears the shot to null. */
export function stopTourState(): TourState {
  return { active: false, stopIndex: 0 }
}

export function advanceTourState(state: TourState): TourState {
  return { active: true, stopIndex: state.stopIndex + 1 }
}

export function currentTourStop(queue: readonly TourStop[], state: TourState): TourStop {
  if (queue.length === 0) return { kind: 'city' }
  const index = ((state.stopIndex % queue.length) + queue.length) % queue.length
  return queue[index]
}

/** True once the user has been idle for at least idleMs. Pure. */
export function idleDue(lastActivityMs: number, nowMs: number, idleMs: number = ATTRACT_IDLE_MS): boolean {
  if (!Number.isFinite(lastActivityMs) || !Number.isFinite(nowMs) || !Number.isFinite(idleMs)) return false
  return nowMs - lastActivityMs >= idleMs
}

// --- Flags + session gate ------------------------------------------------------

/** `?attract=1` forces the tour without waiting for the idle timeout. */
export function parseAttractFlag(search: string): boolean {
  try {
    return new URLSearchParams(search).get('attract') === '1'
  } catch {
    return false
  }
}

/** Presence of `?noIntro` skips the arrival glide. */
export function parseNoIntroFlag(search: string): boolean {
  try {
    return new URLSearchParams(search).has('noIntro')
  } catch {
    return false
  }
}

export interface IntroSkipInput {
  search: string
  reducedMotion: boolean
  /** True once sessionStorage recorded a played intro this session. */
  seen: boolean
}

/** Skip the glide with ?noIntro, under reduced motion, or when seen this session. */
export function shouldSkipIntro(input: IntroSkipInput): boolean {
  if (input.reducedMotion || input.seen) return true
  return parseNoIntroFlag(input.search)
}

export const INTRO_SEEN_KEY = 'introSeen'

export function readIntroSeen(store: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    return store != null && store.getItem(INTRO_SEEN_KEY) != null
  } catch {
    return false
  }
}

export function markIntroSeen(store: Pick<Storage, 'setItem'> | null | undefined): void {
  try {
    store?.setItem(INTRO_SEEN_KEY, '1')
  } catch {
    // Private mode etc: the intro simply replays next session.
  }
}

export function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}
