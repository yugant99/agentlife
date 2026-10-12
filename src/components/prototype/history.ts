// History ribbon helpers (Wave 3 Lane 3B). Pure: snapshot diffs to per-minute
// event ticks, minute bucketing and a 60-entry ring buffer. No DOM, no canvas,
// no clocks; the HUD owns refs and the 1 Hz redraw. Only type-imports the
// frozen agentModel contract so plain Node tests can load it.

import type { CityAgent } from './agentModel.ts'

/** The ribbon covers the last hour, one bucket per minute. */
export const HISTORY_MINUTES = 60
export const MINUTE_MS = 60_000

export interface HistorySnapshot {
  id: string
  workState: CityAgent['workState']
  freshness: CityAgent['freshness']
  toolKind?: CityAgent['toolKind']
  lastSignalAt: number
}

export type HistoryAgentInput = Pick<CityAgent, 'id' | 'workState' | 'freshness' | 'toolKind' | 'lastSignalAt'>

/** Map a live agent record to the minimal diff shape. */
export function toHistorySnapshot(agent: HistoryAgentInput): HistorySnapshot {
  return {
    id: agent.id,
    workState: agent.workState,
    freshness: agent.freshness,
    toolKind: agent.toolKind,
    lastSignalAt: agent.lastSignalAt,
  }
}

export interface HistoryEvents {
  ships: string[]
  tests: string[]
  needs: string[]
  arrivals: string[]
}

/**
 * Diff snapshots by id + lastSignalAt. A re-render with the same
 * lastSignalAt never double-counts. Ship/test/needs ticks need a fresh
 * signal; arrivals are brand-new non-historical ids only.
 */
export function diffHistoryEvents(
  prev: readonly HistorySnapshot[],
  next: readonly HistorySnapshot[],
): HistoryEvents {
  const before = new Map<string, HistorySnapshot>()
  for (const agent of prev) before.set(agent.id, agent)
  const ships: string[] = []
  const tests: string[] = []
  const needs: string[] = []
  const arrivals: string[] = []
  for (const agent of next) {
    const prior = before.get(agent.id)
    if (!prior) {
      if (agent.freshness !== 'historical') arrivals.push(agent.id)
      if (agent.freshness !== 'fresh') continue
      if (agent.toolKind === 'ship') ships.push(agent.id)
      if (agent.toolKind === 'test') tests.push(agent.id)
      if (agent.workState === 'needs-input') needs.push(agent.id)
      continue
    }
    if (prior.lastSignalAt === agent.lastSignalAt) continue
    if (agent.freshness !== 'fresh') continue
    if (agent.toolKind === 'ship') ships.push(agent.id)
    if (agent.toolKind === 'test') tests.push(agent.id)
    if (agent.workState === 'needs-input') needs.push(agent.id)
  }
  return { ships, tests, needs, arrivals }
}

/** Minute-aligned bucket start for a timestamp; non-finite reads 0. */
export function minuteStartFor(timestamp: number): number {
  if (!Number.isFinite(timestamp)) return 0
  return Math.floor(timestamp / MINUTE_MS) * MINUTE_MS
}

export interface HistoryBucket {
  start: number
  ships: number
  tests: number
  needs: number
  arrivals: number
}

/** Empty ring buffer. */
export function emptyHistory(): HistoryBucket[] {
  return []
}

/**
 * Record one diff into the minute bucket for `now`. Buckets merge within the
 * minute, roll over per minute, drop minutes older than the 60-minute window
 * and cap at 60 entries sorted oldest first. Never mutates the input.
 */
export function recordHistoryMinute(
  buffer: readonly HistoryBucket[],
  now: number,
  events: HistoryEvents,
): HistoryBucket[] {
  const start = minuteStartFor(now)
  const windowStart = start - (HISTORY_MINUTES - 1) * MINUTE_MS
  const next: HistoryBucket[] = []
  let merged = false
  for (const bucket of buffer) {
    if (!Number.isFinite(bucket.start) || bucket.start < windowStart) continue
    if (bucket.start === start) {
      next.push({
        start,
        ships: bucket.ships + events.ships.length,
        tests: bucket.tests + events.tests.length,
        needs: bucket.needs + events.needs.length,
        arrivals: bucket.arrivals + events.arrivals.length,
      })
      merged = true
    } else {
      next.push({ ...bucket })
    }
  }
  if (!merged) {
    next.push({
      start,
      ships: events.ships.length,
      tests: events.tests.length,
      needs: events.needs.length,
      arrivals: events.arrivals.length,
    })
  }
  next.sort((a, b) => a.start - b.start)
  while (next.length > HISTORY_MINUTES) next.shift()
  return next
}
