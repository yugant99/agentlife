// Lifecycle transitions for walking workers (plan 002, Lane B). Pure helpers: which
// phase a worker is in, when a tether joins child and parent, and how departures
// fade. The frame loop in Workers.tsx owns the clocks; this module owns the rules.

import type { CityAgent, Freshness } from './agentModel.ts'

export type LifecyclePhase = 'arriving' | 'at-work' | 'seated' | 'leaving'

/**
 * New agents arrive (roots through the Gateway arch, children beside their
 * parent). Stale agents sit down; historical agents walk back out the Gateway.
 */
export function lifecycleFor(freshness: Freshness, known: boolean): LifecyclePhase {
  if (!known) return 'arriving'
  if (freshness === 'historical') return 'leaving'
  if (freshness === 'stale') return 'seated'
  return 'at-work'
}

/** Departures fade over about 8 s while walking out. */
export const DEPARTURE_FADE_MS = 8000

/** Arrivals fade in quickly at the Gateway arch. */
export const ARRIVAL_FADE_MS = 1000

export function departureOpacity(elapsedMs: number): number {
  if (elapsedMs <= 0) return 1
  return Math.max(0, 1 - elapsedMs / DEPARTURE_FADE_MS)
}

export function arrivalOpacity(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0
  return Math.min(1, elapsedMs / ARRIVAL_FADE_MS)
}

type TetherAgent = Pick<CityAgent, 'id' | 'freshness'>

/** A thin light tether joins child and parent while both are fresh. */
export function shouldTether(
  child: TetherAgent & { parentId?: string },
  parent: TetherAgent,
): boolean {
  return child.parentId === parent.id && child.freshness === 'fresh' && parent.freshness === 'fresh'
}
