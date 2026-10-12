// Truth contract for Mythic City (Wave 1 Lane 1A). The single mapping table from
// CityAgent fields to visual channels. Scene, HUD and roster only read CityAgent;
// this module defines what each channel means, the rule, and how it degrades.
// Pure and self-contained (imports only the frozen agentModel contract) so both the
// browser bundle and plain Node tests (`--experimental-strip-types`) can load it.

import type { CityAgent, DistrictId } from './agentModel.ts'
import { preferredDistrict } from './agentModel.ts'

export type DatamapField = keyof CityAgent

export interface DatamapRow {
  /** Visual channel, e.g. "District window glow". */
  channel: string
  /** CityAgent field(s) that drive it. Every row must name at least one real field. */
  fields: DatamapField[]
  /** The rule that keeps the channel truthful. */
  rule: string
  /** How the channel degrades (pause, reduced motion, low tier, overflow). */
  degrades: string
}

/**
 * The frozen mapping table. HUD "How to read" renders directly from this array,
 * so editing copy here edits the legend. Pure scenery is intentionally absent:
 * scenery must never read as telemetry.
 */
export const DATAMAP_ROWS: readonly DatamapRow[] = [
  {
    channel: 'Worker position / district walk',
    fields: ['toolKind', 'workState', 'freshness'],
    rule: 'toolKind maps to a district by 60 s dominance plus 20 s dwell; fresh needs-input walks to the Citadel steps; historical leaves via the Gateway.',
    degrades: 'HUD flips instantly; the figure arrives 4-10 s later; frozen while paused or under reduced motion.',
  },
  {
    channel: 'Ground ring + pulse',
    fields: ['workState', 'freshness'],
    rule: 'Ring color comes from workState plus freshness; selection overrides everything.',
    degrades: 'waiting, complete and unknown read muted; pulse freezes while paused or under reduced motion.',
  },
  {
    channel: 'Needs-you beam + queue',
    fields: ['workState', 'freshness', 'lastSignalAt'],
    rule: 'Amber beam shows only when workState is needs-input and freshness is fresh; the queue is ordered by longest wait (oldest lastSignalAt first).',
    degrades: 'Beam holds static while paused; the camera never auto-moves.',
  },
  {
    channel: 'Pose / gesture',
    fields: ['phase', 'toolKind', 'freshness'],
    rule: 'Live phase plus toolKind drives the gesture; stale sits down and historical idles.',
    degrades: 'Pose freezes while paused or under reduced motion.',
  },
  {
    channel: 'Provider heraldry (trim / finial / ticks)',
    fields: ['provider', 'model', 'role', 'workspace'],
    rule: 'Provider sets hue plus silhouette, model sets 0-3 shoulder ticks, workspace basename sets the pennant; hue and shape both carry identity.',
    degrades: 'Full strings stay in the inspector and roster only; manual stays unlit.',
  },
  {
    channel: 'District window glow',
    fields: ['freshness', 'workState'],
    rule: 'Window lit ratio comes from the fresh-and-active count per district; glow shows N active (fresh) workers.',
    degrades: 'Eased over 1.5 s; static while paused; analytic glow only on the low tier.',
  },
  {
    channel: 'District label count',
    fields: ['freshness', 'workState', 'toolKind'],
    rule: 'District labels show assigned workers (all non-historical by preferred district), not the glow count.',
    degrades: 'Overflow reads "N shown +M more"; the roster still lists everyone.',
  },
  {
    channel: 'Age desaturation',
    fields: ['lastSignalAt', 'freshness'],
    rule: 'Wall-clock age (now minus lastSignalAt) ramps saturation from fresh to stale; staleness is never a work state.',
    degrades: 'Ramp frozen while paused or under reduced motion.',
  },
  {
    channel: 'Work-duration halo',
    fields: ['startedAt'],
    rule: 'Halo arc grows with now minus startedAt, capped at 30 min.',
    degrades: 'Static while paused; hidden when startedAt is missing.',
  },
  {
    channel: 'Family tether + scale',
    fields: ['parentId', 'depth', 'freshness'],
    rule: 'Explicit parentId links only, fresh to fresh; depth shrinks the child and pulls it closer.',
    degrades: 'Static line under reduced motion; ribbons capped per family.',
  },
  {
    channel: 'Ship freighter (one shot)',
    fields: ['id', 'toolKind', 'lastSignalAt'],
    rule: 'A fresh ship-tool transition keyed by id plus lastSignalAt sails once: dock, behind the pier, exit.',
    degrades: 'Holds docked while paused; hidden unless wired to a real transition.',
  },
  {
    channel: 'Tram lit cars + tint',
    fields: ['freshness', 'workState', 'provider'],
    rule: 'Lit cars equal min(5, max(1, cityCounts.working)); tint follows the majority provider; dim parked cars are scenery.',
    degrades: 'Counts freeze while paused; the split stays legible as a still.',
  },
  {
    channel: 'Roster / inspector / history',
    fields: ['id', 'name', 'source', 'workState', 'freshness', 'phase', 'toolKind', 'lastSignalAt', 'startedAt'],
    rule: 'Urgency-sorted with needs-input longest wait first; the inspector shows Doing, Where plus why, Since, Next.',
    degrades: 'HTML only; overflow reads "N shown +M more".',
  },
  {
    channel: 'Sky glow + spin',
    fields: ['freshness', 'workState'],
    rule: 'Aggregate fresh-and-active count only; eased over 1.5 s; legend reads "Glow = N active".',
    degrades: 'Stars and turbulence stay scenery and never encode agents.',
  },
]

/** Plan-text alias: the datamap report calls this table MAPPING_ROWS. */
export const MAPPING_ROWS: readonly DatamapRow[] = DATAMAP_ROWS

/** Scenery channels. They must never read as telemetry; kept out of the table. */
export const SCENERY_CHANNELS: readonly string[] = [
  'Black-hole turbulence, stars and horizon base',
  'Ground, roads, curbs, lamps and pools',
  'Harbor swell, foam, buoys and the ferry loop',
  'Parked tram cars, steam, dishes and cranes',
  'Grade, fog, vignette and grain',
]

export const DISTRICT_IDS: readonly DistrictId[] = [
  'citadel',
  'foundry',
  'archive',
  'observatory',
  'port',
  'gateway',
]

export const DISTRICT_LABEL: Record<DistrictId, string> = {
  citadel: 'Citadel',
  foundry: 'Foundry',
  archive: 'Archive',
  observatory: 'Observatory',
  port: 'Port',
  gateway: 'Gateway',
}

// --- Age copy (single definition; HUD reuses this, no local duplicate) ---------

export function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'unknown age'
  if (ageMs < 5_000) return 'just now'
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`
  return `${Math.floor(ageMs / 3_600_000)}h ago`
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 'unknown time'
  if (durationMs < 5_000) return 'just started'
  if (durationMs < 60_000) return `${Math.floor(durationMs / 1000)}s`
  if (durationMs < 3_600_000) return `${Math.floor(durationMs / 60_000)}m`
  return `${Math.floor(durationMs / 3_600_000)}h`
}

// --- Counts (single definition) -------------------------------------------------

export interface DistrictCount {
  /** All non-historical agents whose preferred district is this one. */
  assigned: number
  /** Fresh-and-active agents in this district (the glow count). */
  active: number
}

export interface CityCounts {
  /** Fresh plus active across the city. */
  working: number
  /** Fresh plus needs-input across the city. */
  needsYou: number
  /** Fresh plus complete (baseline outcomes, never events). */
  complete: number
  total: number
  byDistrict: Record<DistrictId, DistrictCount>
}

function emptyDistricts(): Record<DistrictId, DistrictCount> {
  return {
    citadel: { assigned: 0, active: 0 },
    foundry: { assigned: 0, active: 0 },
    archive: { assigned: 0, active: 0 },
    observatory: { assigned: 0, active: 0 },
    port: { assigned: 0, active: 0 },
    gateway: { assigned: 0, active: 0 },
  }
}

/**
 * Truthful counts over CityAgent records. Global working is fresh+active and
 * needsYou is fresh+needs-input; per district, assigned counts all
 * non-historical while active counts fresh+active only. That split is why a
 * label can read "3 workers" while the glow reads 0.
 */
export function cityCounts(agents: readonly CityAgent[]): CityCounts {
  let working = 0
  let needsYou = 0
  let complete = 0
  const byDistrict = emptyDistricts()
  for (const agent of agents) {
    const fresh = agent.freshness === 'fresh'
    if (fresh && agent.workState === 'active') working += 1
    if (fresh && agent.workState === 'needs-input') needsYou += 1
    if (fresh && agent.workState === 'complete') complete += 1
    if (agent.freshness !== 'historical') {
      const district = preferredDistrict(agent)
      byDistrict[district].assigned += 1
      if (fresh && agent.workState === 'active') byDistrict[district].active += 1
    }
  }
  return { working, needsYou, complete, total: agents.length, byDistrict }
}

// --- Urgency order ---------------------------------------------------------------

type UrgencyAgent = Pick<CityAgent, 'id' | 'workState' | 'freshness' | 'lastSignalAt'>

function urgencyRank(agent: Pick<UrgencyAgent, 'workState' | 'freshness'>): number {
  if (agent.freshness === 'fresh' && agent.workState === 'needs-input') return 0
  if (agent.freshness === 'fresh') return 1
  if (agent.freshness === 'stale') return 2
  return 3
}

/** Comparator: fresh needs-input first by longest wait, then fresh, then stale. */
export function compareUrgency(a: UrgencyAgent, b: UrgencyAgent): number {
  const rankA = urgencyRank(a)
  const rankB = urgencyRank(b)
  if (rankA !== rankB) return rankA - rankB
  if (a.lastSignalAt !== b.lastSignalAt) return a.lastSignalAt - b.lastSignalAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Urgency-sorted copy: fresh needs-input first with the longest waiter
 * (oldest lastSignalAt) first, then the rest of fresh, then stale, then
 * historical. Never mutates the input.
 */
export function urgencySort<T extends UrgencyAgent>(agents: readonly T[]): T[] {
  return [...agents].sort(compareUrgency)
}

// --- Overflow copy ----------------------------------------------------------------

/**
 * Honest overflow label, e.g. overflowLabel(3, 5) === "3 shown +2 more".
 * When nothing overflows it reads "N shown".
 */
export function overflowLabel(shown: number, total: number): string {
  const safeShown = Math.max(0, Math.floor(shown))
  const safeTotal = Math.max(0, Math.floor(total))
  if (safeTotal <= safeShown) return `${safeTotal} shown`
  return `${safeShown} shown +${safeTotal - safeShown} more`
}

// --- Truth card --------------------------------------------------------------------

export interface TruthCard {
  /** What the agent is doing, in words (workState plus phase plus toolKind). */
  doing: string
  /** Where they are plus why that district is truthful. */
  where: string
  /** Signal age plus work duration. */
  since: string
  /** The next human action, or why none is needed. */
  next: string
}

const TOOL_VERB: Record<NonNullable<CityAgent['toolKind']>, string> = {
  shell: 'running shell commands',
  test: 'running tests',
  edit: 'editing code',
  read: 'reading',
  search: 'searching',
  web: 'checking the web',
  ship: 'shipping',
  delegate: 'delegating',
  ask: 'asking for a call',
  other: 'working',
}

const PHASE_LABEL: Record<CityAgent['phase'], string> = {
  thinking: 'thinking',
  tool: 'using a tool',
  talking: 'talking',
  gap: 'between tool calls',
  idle: 'idle',
}

function workNoun(workState: CityAgent['workState']): string {
  switch (workState) {
    case 'active': return 'Working'
    case 'needs-input': return 'Needs you'
    case 'waiting': return 'Waiting'
    case 'complete': return 'Done'
    default: return 'Unknown'
  }
}

export type TruthCardAgent = Pick<
  CityAgent,
  'workState' | 'phase' | 'toolKind' | 'freshness' | 'lastSignalAt' | 'startedAt'
>

/**
 * Four-line inspector card derived from workState, phase, toolKind, freshness,
 * lastSignalAt and startedAt. Pure: pass `now` explicitly in tests.
 */
export function truthCard(agent: TruthCardAgent, now: number = Date.now()): TruthCard {
  const tool = agent.toolKind ? TOOL_VERB[agent.toolKind] : 'between tools'
  const phase = PHASE_LABEL[agent.phase]
  const age = now - agent.lastSignalAt
  const ageCopy = formatAge(age)

  const freshnessPrefix =
    agent.freshness === 'historical' ? 'Past · ' : agent.freshness === 'stale' ? 'Stale · ' : ''
  const doing = agent.workState === 'unknown'
    ? `${freshnessPrefix}Unknown — no heartbeat (${phase})`
    : `${freshnessPrefix}${workNoun(agent.workState)} — ${phase} (${tool})`

  const district = DISTRICT_LABEL[preferredDistrict(agent)]
  let why: string
  if (agent.freshness === 'historical') {
    why = 'walked out the Gateway; past work stays listed'
  } else if (agent.workState === 'needs-input' && agent.freshness === 'fresh') {
    why = 'waiting on the Citadel steps for your call'
  } else if (agent.toolKind) {
    why = `dominant ${agent.toolKind} work over the last 60 s keeps them here`
  } else {
    why = 'waiting at the Citadel; no tool signal yet'
  }
  const where = `${district} — ${why}`

  const started = agent.startedAt
  const durationCopy =
    started !== undefined && Number.isFinite(started) && started <= now
      ? ` · working ${formatDuration(now - started)}`
      : ''
  const since = `last signal ${ageCopy}${durationCopy}`

  let next: string
  if (agent.freshness === 'historical') {
    next = 'Nothing needed — archived.'
  } else if (agent.freshness === 'stale') {
    next = 'Nothing needed now — snapshot is stale; last known work is preserved.'
  } else if (agent.workState === 'needs-input') {
    next = `Give the call — blocked on you (waiting ${ageCopy}).`
  } else if (agent.workState === 'complete') {
    next = 'Nothing needed — filed.'
  } else if (agent.workState === 'waiting') {
    next = 'Nothing needed — waiting on its own work.'
  } else if (agent.workState === 'unknown') {
    next = 'Nothing needed — no heartbeat yet.'
  } else {
    next = 'Nothing needed — let them work.'
  }

  return { doing, where, since, next }
}
