// Long-range state theatre + age channels (plan 003, Wave 2 Lane 2A). Pure and
// deterministic: the only import is types, so plain Node tests can load it with
// `node --experimental-strip-types`. The frame loop in Workers.tsx owns the
// clocks; this module owns the rules. No Three.js, no DOM, no clocks; every
// function takes explicit inputs.
//
// Theatre reads from city zoom and plays only for fresh agents: thinking shows
// slow orbiting motes, talking shows an expanding ground ripple, tool work
// shows one oversized 2-3 unit sigil in the toolKind colour. Age channels are
// wall-clock: desaturation ramps fresh to stale by lastSignalAt, halo grows
// with startedAt capped at 30 min. Both freeze when paused, under reduced
// motion or when not fresh (the scene holds the last value, it never animates
// them per frame).

import type { CityAgent, Phase, ToolKind } from './agentModel.ts'
import { FRESH_MS, STALE_MS } from './agentModel.ts'

/** One additive instanced set carries every effect; overdraw stays bounded. */
export const THEATRE_MAX = 32

/** Work-duration halo caps here so a day-long session reads the same as 30 min. */
export const HALO_CAP_MS = 30 * 60_000

/** Tool-sigil palette by tool family (city-zoom read, 2-3 unit quad). */
export const TOOL_SIGIL_COLORS: Record<ToolKind, string> = {
  shell: '#ff9b47',
  edit: '#ff9b47',
  read: '#6fd8b8',
  search: '#6fd8b8',
  test: '#7fd0ff',
  web: '#7fd0ff',
  ship: '#d9b05a',
  delegate: '#b9a8ff',
  ask: '#b9a8ff',
  other: '#b9a8ff',
}

/** Fallback for agents between tools: a quiet violet, never unlit black. */
export const TOOL_SIGIL_FALLBACK = '#b9a8ff'

export function toolSigilColor(toolKind: ToolKind | undefined): string {
  if (!toolKind) return TOOL_SIGIL_FALLBACK
  return TOOL_SIGIL_COLORS[toolKind] ?? TOOL_SIGIL_FALLBACK
}

export type TheatreEffect = 'motes' | 'ripple' | 'sigil' | 'none'

export type TheatreAgent = Pick<CityAgent, 'phase' | 'freshness'>

/**
 * Phase to effect. Only fresh agents play: stale sits, historical idles, and
 * gap/idle phases hold no theatre so the city view stays quiet when nothing
 * is happening.
 */
export function effectForPhase(agent: TheatreAgent): TheatreEffect {
  if (agent.freshness !== 'fresh') return 'none'
  if (agent.phase === 'thinking') return 'motes'
  if (agent.phase === 'talking') return 'ripple'
  if (agent.phase === 'tool') return 'sigil'
  return 'none'
}

/**
 * Desaturation ramp 0 (fresh) to 1 (fully aged) from wall-clock signal age.
 * Mirrors the freshness windows: at or under FRESH_MS the figure reads full
 * colour, at or past STALE_MS it reads fully dimmed, linear between.
 * Non-finite or negative ages read 0 (never punish a missing clock).
 */
export function desaturationForAge(ageMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs <= FRESH_MS) return 0
  if (ageMs >= STALE_MS) return 1
  return (ageMs - FRESH_MS) / (STALE_MS - FRESH_MS)
}

/**
 * Halo fraction 0..1 from work duration, capped at 30 min. Missing, negative
 * or non-finite durations read 0 (no halo) so the scene hides the arc.
 */
export function haloFractionForDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0
  return Math.min(1, durationMs / HALO_CAP_MS)
}

/**
 * Pulse rate in Hz per phase: talking ripples fastest, thinking motes drift
 * slowest. Gap/idle share the slow rate so a held value still breathes.
 */
export function rateForPhase(phase: Phase): number {
  if (phase === 'talking') return 1.6
  if (phase === 'tool') return 1.2
  if (phase === 'thinking') return 0.8
  return 0.5
}

/** Footstep pool base diameter and stride swell (world units). */
export const FOOTSTEP_BASE = 1.6
export const FOOTSTEP_SWELL = 0.3

/**
 * Stride-pulsed disc scale from the walk stride angle (radians). Pure sine so
 * the scene stays in sync with the leg swing at STEP_FREQ without sharing a
 * clock: the caller passes `timeSec * STEP_FREQ + phase`.
 */
export function footstepScaleAt(stride: number): number {
  if (!Number.isFinite(stride)) return FOOTSTEP_BASE
  return FOOTSTEP_BASE + FOOTSTEP_SWELL * Math.sin(stride)
}

/** Talking ripple loop position 0..1 for a rate in Hz at a time in seconds. */
export function rippleFractionAt(timeSec: number, rateHz: number): number {
  if (!Number.isFinite(timeSec) || !Number.isFinite(rateHz) || rateHz <= 0) return 0
  const position = (timeSec * rateHz) % 1
  return position < 0 ? position + 1 : position
}

/** Ripple disc diameter grows 1 to 2.5 across one loop. */
export function rippleScaleFor(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0) return 1
  if (fraction >= 1) return 2.5
  return 1 + 1.5 * fraction
}

/** Thought-mote orbit radius (world units) and diameter at city zoom. */
export const MOTE_RADIUS = 1.2
export const MOTE_SIZE = 0.35
export const MOTE_COUNT = 3

/**
 * One mote's ground offset on the orbit at a time in seconds. Slot k of
 * MOTE_COUNT spreads evenly; the caller adds the worker position and head
 * height. Pure trig so tests pin the orbit without a renderer.
 */
export function moteOffsetAt(timeSec: number, rateHz: number, slot: number): [number, number] {
  const safe = Number.isFinite(timeSec) ? timeSec : 0
  const safeRate = Number.isFinite(rateHz) && rateHz > 0 ? rateHz : 0.8
  const angle = safe * safeRate * Math.PI * 2 + (slot / MOTE_COUNT) * Math.PI * 2
  return [Math.cos(angle) * MOTE_RADIUS, Math.sin(angle) * MOTE_RADIUS]
}
