// Waterfront-icons signal rules (Toronto lane T1). Pure and self-contained: no
// three.js, no React, no clocks; the scene owns the frame loop and calls into
// here. Node tests load this directly with `node --experimental-strip-types`.
//
// - CN Tower LEDs read amber with a slow pulse while anyone fresh needs you
//   (needsYou > 0), otherwise a cool white-blue glow scaled by the fresh-active
//   working count, dim at rest.
// - Rogers Centre field lights read warm white while tests are running
//   (testsRunning > 0), otherwise off.
// - Every animated channel eases toward its target over at least EASE_SECONDS
//   (linear-approach step shared with the sky lane), freezes while paused, and
//   snaps to target under reduced motion so the still frame stays truthful.
// - Aviation beacons are scenery: a fixed-period red blink, never telemetry.

/** Minimum ease time for LED and field-light changes (seconds). */
export const LANDMARK_EASE_SECONDS = 1.5

/** Amber tungsten accent while someone needs you (city art direction). */
export const TOWER_LED_AMBER = '#ff9b47'
/** Cool white-blue glow scaled by the working count. */
export const TOWER_LED_COOL = '#bcd6ff'

/** Amber pulse rate (Hz): slow enough to read as a beacon, not a strobe. */
export const TOWER_PULSE_HZ = 0.6
/** Pulse depth around the eased level (multiplier swings 1-depth..1). */
export const TOWER_PULSE_DEPTH = 0.18

/** LED emissive level while needsYou > 0 (blooms above 1.0). */
export const TOWER_AMBER_LEVEL = 2.4
/** LED emissive floor at rest (dim but never black). */
export const TOWER_DIM_LEVEL = 0.25
/** LED base once anyone is working; the count adds up to WORKING_HEADROOM. */
export const TOWER_WORKING_BASE = 0.6
export const TOWER_WORKING_HEADROOM = 1.4
/** Working counts saturate here so a crowd reads the same as a full house. */
export const TOWER_WORKING_CAP = 12

/** Warm-white field-light colour for the stadium rim. */
export const STADIUM_LIGHT_WARM = '#fff1d6'
/** Field-light emissive level while tests run (blooms above 1.0). */
export const STADIUM_ON_LEVEL = 2.2
/** Field lights read fully off at rest. */
export const STADIUM_OFF_LEVEL = 0

/** Aviation beacon period (seconds) and on-fraction per period. */
export const AVIATION_PERIOD_SEC = 1.6
export const AVIATION_DUTY = 0.15
/** Steady level for beacons on a reduced-motion still frame. */
export const AVIATION_STEADY_LEVEL = 2.0

function cleanCount(value: number | undefined): number {
  if (!Number.isFinite(value as number)) return 0
  return Math.max(0, Math.floor(value as number))
}

export interface LedTarget {
  color: string
  intensity: number
}

/**
 * Truthful LED target from aggregate counts. Amber wins while anyone needs
 * you; otherwise cool white-blue scaled by working; dim at rest.
 */
export function ledTargetFor(needsYou: number, working: number): LedTarget {
  if (cleanCount(needsYou) > 0) {
    return { color: TOWER_LED_AMBER, intensity: TOWER_AMBER_LEVEL }
  }
  const active = cleanCount(working)
  if (active <= 0) return { color: TOWER_LED_COOL, intensity: TOWER_DIM_LEVEL }
  const capped = Math.min(active, TOWER_WORKING_CAP) / TOWER_WORKING_CAP
  return { color: TOWER_LED_COOL, intensity: TOWER_WORKING_BASE + TOWER_WORKING_HEADROOM * capped }
}

/**
 * Slow pulse multiplier for the amber state (0..1 time in seconds). Stays in
 * 1-depth..1 so the LEDs never dip toward off mid-pulse.
 */
export function ledPulseAt(timeSec: number): number {
  const t = Number.isFinite(timeSec) ? timeSec : 0
  const wave = 0.5 - 0.5 * Math.cos(t * TOWER_PULSE_HZ * Math.PI * 2)
  return 1 - TOWER_PULSE_DEPTH * wave
}

/** Field-light target level: on while tests run, off otherwise. */
export function stadiumTargetFor(testsRunning: number): number {
  return cleanCount(testsRunning) > 0 ? STADIUM_ON_LEVEL : STADIUM_OFF_LEVEL
}

/**
 * One linear-approach ease step: moves current toward target by deltaSec /
 * LANDMARK_EASE_SECONDS of the remaining gap, so small changes settle fast
 * and full swings take at least ~1.5 s to mostly arrive. Non-finite inputs
 * hold current (never flash); non-positive deltas hold.
 */
export function stepEased(current: number, target: number, deltaSec: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return current
  if (!Number.isFinite(deltaSec) || deltaSec <= 0) return current
  const k = Math.min(1, deltaSec / LANDMARK_EASE_SECONDS)
  return current + (target - current) * k
}

/**
 * Frame-rule wrapper: paused freezes (holds current), reduced motion snaps
 * to target for a truthful still, otherwise steps the ease.
 */
export function resolveEased(
  current: number,
  target: number,
  deltaSec: number,
  opts: { paused: boolean; reducedMotion: boolean },
): number {
  if (opts.paused) return current
  if (opts.reducedMotion) return target
  return stepEased(current, target, deltaSec)
}

/**
 * Aviation blink phase 0..1 for scenery beacons at a time in seconds, with an
 * optional per-beacon offset so masts do not flash in lockstep.
 */
export function aviationPhaseAt(timeSec: number, offsetSec = 0): number {
  const t = Number.isFinite(timeSec) ? timeSec : 0
  const off = Number.isFinite(offsetSec) ? offsetSec : 0
  const raw = ((t + off) % AVIATION_PERIOD_SEC + AVIATION_PERIOD_SEC) % AVIATION_PERIOD_SEC
  return raw / AVIATION_PERIOD_SEC
}

/** True while the beacon is lit in its blink period. */
export function aviationOnAt(timeSec: number, offsetSec = 0): boolean {
  return aviationPhaseAt(timeSec, offsetSec) < AVIATION_DUTY
}
