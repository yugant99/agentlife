// Truthful vehicle helpers for Mythic City (Wave 2 Lane 2B). Pure and
// self-contained: only the frozen agentModel contract is imported, so plain
// Node tests can load this with `node --experimental-strip-types`. The scene
// stays thin over these helpers; no Three.js here.

import type { CityAgent, DistrictId, Provider } from './agentModel.ts'
import { preferredDistrict } from './agentModel.ts'

// --- Tram census ------------------------------------------------------------

export const TRAM_TOTAL = 5
export const TRAM_MIN_LIT = 1

/** Lit cars = min(5, max(1, working)). Single definition: working is cityCounts.working. */
export function tramLitCount(working: number): number {
  if (!Number.isFinite(working)) return TRAM_MIN_LIT
  return Math.min(TRAM_TOTAL, Math.max(TRAM_MIN_LIT, Math.floor(working)))
}

type ProviderAgent = Pick<CityAgent, 'provider' | 'freshness' | 'workState'>

const PROVIDER_ORDER: readonly Provider[] = ['codex', 'opencode', 'claude-code', 'manual']

/** Majority provider among fresh-active agents; falls back to fresh, then codex. */
export function majorityProvider(agents: readonly ProviderAgent[]): Provider {
  const countFor = (filterActive: boolean): Map<Provider, number> => {
    const map = new Map<Provider, number>()
    for (const agent of agents) {
      if (agent.freshness !== 'fresh') continue
      if (filterActive && agent.workState !== 'active') continue
      map.set(agent.provider, (map.get(agent.provider) ?? 0) + 1)
    }
    return map
  }
  let counts = countFor(true)
  if (counts.size === 0) counts = countFor(false)
  if (counts.size === 0) return 'codex'
  let best: Provider = PROVIDER_ORDER[0]
  let bestCount = -1
  for (const provider of PROVIDER_ORDER) {
    const count = counts.get(provider) ?? 0
    if (count > bestCount) {
      best = provider
      bestCount = count
    }
  }
  return best
}

// --- Ship ritual ------------------------------------------------------------

export type ShipAgent = Pick<CityAgent, 'id' | 'toolKind' | 'freshness' | 'lastSignalAt'>

/** Dedupe key: agent id + lastSignalAt, so re-delivered snapshots never double-fire. */
export function shipEventKey(agent: Pick<ShipAgent, 'id' | 'lastSignalAt'>): string {
  return `${agent.id}@${agent.lastSignalAt}`
}

export function isFreshShip(agent: ShipAgent): boolean {
  return agent.freshness === 'fresh' && agent.toolKind === 'ship'
}

/** Fresh ship keys in snapshot order that are not already in `seen`. Pure. */
export function newShipEvents(
  seen: ReadonlySet<string> | readonly string[],
  agents: readonly ShipAgent[],
): string[] {
  // Array.isArray does not narrow a readonly array union, so test for the Set shape.
  const seenSet: ReadonlySet<string> = seen instanceof Set ? seen : new Set(seen as readonly string[])
  const out: string[] = []
  const emitted = new Set<string>()
  for (const agent of agents) {
    if (!isFreshShip(agent)) continue
    const key = shipEventKey(agent)
    if (seenSet.has(key) || emitted.has(key)) continue
    emitted.add(key)
    out.push(key)
  }
  return out
}

// --- Courier handoffs -------------------------------------------------------

export type DelegateAgent = Pick<CityAgent, 'id' | 'toolKind' | 'freshness' | 'parentId' | 'lastSignalAt'>

export interface CourierHandoff {
  parentId: string
  childId: string
  /** One leg per spawn: parent id + child id + child signal. */
  key: string
}

/** First fresh delegate parent with a fresh child; oldest child signal first. */
export function selectCourierHandoff(agents: readonly DelegateAgent[]): CourierHandoff | null {
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const candidates: { parentId: string; childId: string; key: string; at: number }[] = []
  for (const child of agents) {
    if (!child.parentId || child.freshness !== 'fresh') continue
    const parent = byId.get(child.parentId)
    if (!parent || parent.freshness !== 'fresh' || parent.toolKind !== 'delegate') continue
    candidates.push({
      parentId: parent.id,
      childId: child.id,
      key: `${parent.id}>${child.id}@${child.lastSignalAt}`,
      at: child.lastSignalAt,
    })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const first = candidates[0]
  return { parentId: first.parentId, childId: first.childId, key: first.key }
}

// --- Mooring ----------------------------------------------------------------

export type PresenceAgent = Pick<CityAgent, 'freshness' | 'workState' | 'toolKind'>

/** Fresh presence in a district: any fresh agent whose preferred district matches. */
export function hasFreshPresence(agents: readonly PresenceAgent[], district: DistrictId): boolean {
  for (const agent of agents) {
    if (agent.freshness !== 'fresh') continue
    if (preferredDistrict(agent) === district) return true
  }
  return false
}

/** Canal boats sail only when their home district has fresh presence. */
export function shouldBoatSail(agents: readonly PresenceAgent[], homeDistrict: DistrictId): boolean {
  return hasFreshPresence(agents, homeDistrict)
}
