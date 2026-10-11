// Shared contract for Mythic City agents (plan 002). Frozen: lanes consume it, the lead
// changes it. Pure and self-contained (no imports) so both the browser bundle and plain
// Node tests (`--experimental-strip-types`) can load it.
//
// Live adapters (server) and the simulation scenario both produce CityAgent records; the
// scene, HUD and roster only ever read CityAgent. Work state, freshness, phase and tool
// kind are separate axes and must never be collapsed into one "status".

export type AgentSource = 'live' | 'simulation'
export type Provider = 'codex' | 'opencode' | 'claude-code' | 'manual'

/** What the agent is doing, as far as the evidence says. */
export type WorkState = 'active' | 'needs-input' | 'waiting' | 'complete' | 'unknown'

/** How recent the evidence is. Stale is not dead; historical is not rendered in the city. */
export type Freshness = 'fresh' | 'stale' | 'historical'

/** The moment inside a turn. `gap` is the pause between tool calls. */
export type Phase = 'thinking' | 'tool' | 'talking' | 'gap' | 'idle'

/** Category of the latest tool. Classified inside the server; raw tool input never leaves it. */
export type ToolKind = 'shell' | 'test' | 'edit' | 'read' | 'search' | 'web' | 'ship' | 'delegate' | 'ask' | 'other'

/** Must stay identical to `DistrictId` in city.ts. */
export type DistrictId = 'citadel' | 'foundry' | 'archive' | 'observatory' | 'port' | 'gateway'

export interface CityAgent {
  /** Stable and provider-scoped: `${provider}:${nativeId}`. */
  id: string
  provider: Provider
  source: AgentSource
  /** CityAgent.id of the spawning agent, only when the provider reports it explicitly. */
  parentId?: string
  /** 0 = root agent, 1 = sub-agent, ... */
  depth: number
  /** Short display name (thread/session title or nickname), at most 40 chars. Never prompt text. */
  name: string
  /** Optional label such as a sub-agent type. Never prompt text. */
  role?: string
  /** Only when the provider reports it. */
  model?: string
  /** Folder basename of the agent's cwd (repo or worktree name). Never a full path. */
  workspace: string
  workState: WorkState
  freshness: Freshness
  phase: Phase
  /** Latest tool category; kept after the tool finishes so the worker stays at its spot. */
  toolKind?: ToolKind
  /** Epoch ms of the last observed write or event. */
  lastSignalAt: number
  startedAt?: number
}

export interface ProviderDiagnostic {
  provider: Provider
  state: 'connected' | 'limited' | 'error' | 'disconnected'
  /** Fixed, allowlisted text only. Never raw stderr or protocol errors. */
  message: string
  agents: number
}

export interface CitySnapshot {
  source: AgentSource
  generatedAt: number
  agents: CityAgent[]
  diagnostics: ProviderDiagnostic[]
}

/** Signal within this window => fresh. */
export const FRESH_MS = 90_000
/** Signal within this window (but not fresh) => stale; older => historical. */
export const STALE_MS = 20 * 60_000

/** A worker stays at a spot at least this long before walking elsewhere. */
export const DWELL_MIN_MS = 20_000
/** The target district is the dominant tool kind over this window. */
export const DOMINANCE_WINDOW_MS = 60_000
/** Walk duration is clamped into this range by scaling speed. */
export const TRIP_MIN_MS = 4_000
export const TRIP_MAX_MS = 10_000
/** Rendering cap; priority is needs-input, then fresh, then stale. The roster lists everyone. */
export const MAX_RENDERED_WORKERS = 24

export const TOOL_DISTRICT: Record<ToolKind, DistrictId> = {
  shell: 'foundry',
  edit: 'foundry',
  read: 'archive',
  search: 'archive',
  test: 'observatory',
  web: 'observatory',
  ship: 'port',
  delegate: 'citadel',
  ask: 'citadel',
  other: 'citadel',
}

/** Arrivals and departures always use the Gateway. */
export const ARRIVAL_DISTRICT: DistrictId = 'gateway'

export function deriveFreshness(lastSignalAt: number, now: number): Freshness {
  const age = now - lastSignalAt
  if (age <= FRESH_MS) return 'fresh'
  if (age <= STALE_MS) return 'stale'
  return 'historical'
}

/** Where the worker should be right now, before hysteresis is applied. */
export function preferredDistrict(agent: Pick<CityAgent, 'workState' | 'freshness' | 'toolKind'>): DistrictId {
  if (agent.freshness === 'historical') return ARRIVAL_DISTRICT
  if (agent.workState === 'needs-input') return 'citadel'
  return agent.toolKind ? TOOL_DISTRICT[agent.toolKind] : 'citadel'
}
