// Simulation scenario -> CityAgent bridge (plan 002, Lane B). The scene, HUD and
// roster only ever read CityAgent; this module is the simulation's producer of
// CityAgent snapshots (Lane A will add the live producer later). Pure: the caller
// passes `now` explicitly, so tests stay deterministic and this file stays free of
// clocks, telemetry and network.

import type { CityAgent, CitySnapshot, WorkState } from './agentModel.ts'
import { cityCounts as datamapCounts, urgencySort } from './datamap.ts'
import type { CityCounts } from './datamap.ts'
import { DWELL_MS } from './scenario.ts'
import type { ScenarioAgent, ScenarioState } from './scenario.ts'

// Synthetic signal ages chosen inside the contract thresholds: fresh within
// FRESH_MS (90 s), stale within STALE_MS (20 min), historical older.
const FRESH_AGE_MS = 10_000
const STALE_AGE_MS = 5 * 60_000
const HISTORICAL_AGE_MS = 30 * 60_000

export function signalAgeFor(freshness: ScenarioAgent['freshness']): number {
  if (freshness === 'fresh') return FRESH_AGE_MS
  if (freshness === 'stale') return STALE_AGE_MS
  return HISTORICAL_AGE_MS
}

/** Contract ids are provider-scoped: `${provider}:${nativeId}`. */
export function cityIdFor(provider: ScenarioAgent['provider'], nativeId: string): string {
  return `${provider}:${nativeId}`
}

export function toCityAgents(state: ScenarioState, now: number): CityAgent[] {
  const byNativeId = new Map(state.agents.map((agent) => [agent.id, agent]))
  return state.agents.map((agent) => {
    const parent = agent.parentId ? byNativeId.get(agent.parentId) : undefined
    return {
      id: cityIdFor(agent.provider, agent.id),
      provider: agent.provider,
      source: 'simulation' as const,
      parentId: agent.parentId
        ? cityIdFor(parent?.provider ?? agent.provider, agent.parentId)
        : undefined,
      depth: agent.depth ?? 0,
      name: agent.name.slice(0, 40),
      role: agent.role,
      workspace: agent.workspace ?? 'mythic-city',
      workState: agent.workState,
      freshness: agent.freshness,
      phase: agent.phase ?? 'idle',
      toolKind: agent.toolKind,
      lastSignalAt: now - signalAgeFor(agent.freshness),
      startedAt: now - state.step * DWELL_MS,
    }
  })
}

export function toCitySnapshot(state: ScenarioState, now: number): CitySnapshot {
  return {
    source: 'simulation',
    generatedAt: now,
    agents: toCityAgents(state, now),
    diagnostics: [],
  }
}

export function cityWorkLabel(workState: WorkState): string {
  switch (workState) {
    case 'active': return 'Active'
    case 'needs-input': return 'Needs you'
    case 'complete': return 'Complete'
    case 'waiting': return 'Waiting'
    default: return 'Unknown'
  }
}

/** Explicit, non-colour status copy that keeps work state and freshness apart. */
export function cityStatusLabel(agent: Pick<CityAgent, 'workState' | 'freshness'>): string {
  if (agent.workState === 'unknown') return 'Unknown · no heartbeat'
  if (agent.freshness === 'historical') return 'Past · walked out the gate'
  if (agent.freshness === 'stale') return `Stale snapshot · last ${cityWorkLabel(agent.workState).toLowerCase()}`
  return cityWorkLabel(agent.workState)
}

export type { CityCounts } from './datamap.ts'

/** Truthful roster counts over CityAgent records. Single definition lives in datamap.ts. */
export function cityCounts(agents: CityAgent[]): CityCounts {
  return datamapCounts(agents)
}

/** Fresh agents that need a human, urgency-sorted: longest waiter first. */
export function cityAttentionQueue(agents: CityAgent[]): CityAgent[] {
  return urgencySort(agents).filter((agent) => agent.freshness === 'fresh' && agent.workState === 'needs-input')
}

/**
 * The next eligible attention agent after `currentId`, wrapping around. Returns
 * undefined when nothing needs attention. Deterministic given the same snapshot.
 */
export function nextAttentionCity(agents: CityAgent[], currentId?: string | null): string | undefined {
  const queue = cityAttentionQueue(agents)
  if (queue.length === 0) return undefined
  const index = currentId ? queue.findIndex((agent) => agent.id === currentId) : -1
  return queue[(index + 1) % queue.length].id
}
