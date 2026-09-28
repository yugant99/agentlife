// Deterministic synthetic scenario for the Command Courtyard prototype.
//
// This file is intentionally self-contained and pure: no telemetry, no network, no
// clocks, no Three.js. Every value is authored so the timeline is reproducible and
// replayable byte-for-byte. It is imported both by the browser prototype and by a
// plain Node `*.test.mjs` (via `--experimental-strip-types`), so it must stay free of
// runtime-only TypeScript and of type imports from other modules.
//
// Provenance is explicit: every fixture agent has `source === 'simulation'`. The
// `provider` field is only a synthetic example attribution (which adapter a real record
// might have come from); it is never live data and there are no model identifiers.
//
// Three ideas are deliberately kept separate and must not be collapsed into one
// "status": `provider` (example attribution), `workState` (what the agent is doing)
// and `freshness` (whether the snapshot is current). Staleness is a freshness, never a
// work state.

export type SourceKind = 'simulation'
export type ProviderExample = 'codex' | 'opencode' | 'claude-code' | 'manual'
export type WorkState = 'active' | 'needs-input' | 'unknown' | 'complete' | 'waiting'
export type Freshness = 'fresh' | 'stale'
export type StationId = 'forge' | 'planning-table' | 'signal-post'

export interface ScenarioAgent {
  id: string
  name: string
  role: string
  station: StationId
  /** Always 'simulation': this is authored fixture data, never a live record. */
  source: SourceKind
  /** Synthetic example attribution only. Not a live adapter reading. */
  provider: ProviderExample
  workState: WorkState
  freshness: Freshness
  task: string
  /** Synthetic, deterministic recency label (never a wall-clock read). */
  updated: string
}

export interface Celebration {
  id: number
  agentId: string
  name: string
}

export interface ScenarioState {
  step: number
  agents: ScenarioAgent[]
  /** Append-only within a run; cleared by reset. Empty means "nothing to celebrate". */
  celebrations: Celebration[]
  /** Monotonic id source. Restarts at 0 on reset, so consumers must also reset. */
  eventId: number
  lastEvent: string
}

export interface ScenarioStep {
  label: string
  changes: ReadonlyArray<{
    id: string
    workState?: WorkState
    freshness?: Freshness
    task?: string
    updated?: string
  }>
}

export const STATION_META: Record<StationId, { name: string; caption: string }> = {
  forge: { name: 'Forge', caption: 'Delivery · hammer and anvil' },
  'planning-table': { name: 'Planning Table', caption: 'Design · maps and scrolls' },
  'signal-post': { name: 'Signal Post', caption: 'Coordination · banners and watch' },
}

export const PROVIDER_LABEL: Record<ProviderExample, string> = {
  codex: 'Codex',
  opencode: 'OpenCode',
  'claude-code': 'Claude Code',
  manual: 'Manual',
}

/** How long each timeline step dwells before the next one. */
export const DWELL_MS = 5200

// Initial cast: two active, one needs-input, one unknown, one completed. The completed
// agent is a baseline outcome, not a fresh event, so it never triggers a celebration.
const INITIAL_AGENTS: ScenarioAgent[] = [
  {
    id: 'bjorn', name: 'Bjorn', role: 'Forge lead', station: 'forge', source: 'simulation', provider: 'codex',
    workState: 'active', freshness: 'fresh', task: 'Hammering the adapter bracket', updated: '2m ago',
  },
  {
    id: 'eirik', name: 'Eirik', role: 'Forge hand', station: 'forge', source: 'simulation', provider: 'opencode',
    workState: 'unknown', freshness: 'fresh', task: 'No heartbeat reported', updated: '11m ago',
  },
  {
    id: 'sigrid', name: 'Sigrid', role: 'Planner', station: 'planning-table', source: 'simulation', provider: 'codex',
    workState: 'active', freshness: 'fresh', task: 'Reading the survey scroll', updated: '1m ago',
  },
  {
    id: 'halvard', name: 'Halvard', role: 'Planner', station: 'planning-table', source: 'simulation', provider: 'manual',
    workState: 'complete', freshness: 'fresh', task: 'Filed the district ledger', updated: '26m ago',
  },
  {
    id: 'astrid', name: 'Astrid', role: 'Signaller', station: 'signal-post', source: 'simulation', provider: 'opencode',
    workState: 'needs-input', freshness: 'fresh', task: 'Holds the banner for a human call', updated: '4m ago',
  },
]

// The scripted arc:
//   step 1-4  Astrid goes active -> needs-input -> active -> complete (one celebration)
//   step 5-8  Eirik goes unknown -> needs-input -> active -> stale -> fresh
//   step 9    Sigrid completes (one celebration)
// Completion only ever fires on a real transition into `complete`, and never for the
// baseline completed agent, so an unchanged step or a reload cannot replay it.
export const SCENARIO_STEPS: ScenarioStep[] = [
  { label: 'Scenario started — five agents checked in.', changes: [] },
  { label: 'Astrid received the human call and raised the banner.', changes: [{ id: 'astrid', workState: 'active', task: 'Hoisting the signal banner', updated: 'now' }] },
  { label: 'Astrid paused the run — a second decision is needed.', changes: [{ id: 'astrid', workState: 'needs-input', task: 'Asks for a wave plan decision', updated: 'now' }] },
  { label: 'Astrid resumed after the call was made.', changes: [{ id: 'astrid', workState: 'active', task: 'Hoisting the signal banner', updated: 'now' }] },
  { label: 'Astrid completed the banner run.', changes: [{ id: 'astrid', workState: 'complete', task: 'Banner run logged', updated: 'now' }] },
  { label: 'Eirik checked in and asks for a schema call.', changes: [{ id: 'eirik', workState: 'needs-input', task: 'Asks for a schema decision', updated: 'now' }] },
  { label: 'Eirik received the call and started forging.', changes: [{ id: 'eirik', workState: 'active', task: 'Forging the joinery', updated: 'now' }] },
  { label: "Eirik's snapshot went stale — work is paused, not counted.", changes: [{ id: 'eirik', freshness: 'stale', task: 'Last known: forging the joinery' }] },
  { label: "Eirik's snapshot recovered and work resumed.", changes: [{ id: 'eirik', freshness: 'fresh', workState: 'active', task: 'Forging the joinery', updated: 'now' }] },
  { label: 'Sigrid completed the planning pass.', changes: [{ id: 'sigrid', workState: 'complete', task: 'Planning pass filed', updated: 'now' }] },
]

const cloneAgents = (agents: ScenarioAgent[]): ScenarioAgent[] => agents.map((agent) => ({ ...agent }))

/** A deterministic fresh start. The completed baseline agent is not celebrated. */
export function createScenario(): ScenarioState {
  return {
    step: 0,
    agents: cloneAgents(INITIAL_AGENTS),
    celebrations: [],
    eventId: 0,
    lastEvent: SCENARIO_STEPS[0].label,
  }
}

/**
 * Apply one indexed step on top of the current state. Pure and idempotent for the
 * celebration log: re-applying a step the agents already reflect cannot emit a second
 * celebration, because the transition is determined from the agent's current workState.
 */
export function applyStep(state: ScenarioState, index: number): ScenarioState {
  const step = SCENARIO_STEPS[index]
  if (!step) return state
  let eventId = state.eventId
  const celebrations = state.celebrations.slice()
  const agents = state.agents.map((agent) => {
    const change = step.changes.find((entry) => entry.id === agent.id)
    if (!change) return agent
    const next: ScenarioAgent = { ...agent }
    if (change.workState !== undefined) next.workState = change.workState
    if (change.freshness !== undefined) next.freshness = change.freshness
    if (change.task !== undefined) next.task = change.task
    if (change.updated !== undefined) next.updated = change.updated
    // A celebration is a real transition into completion. The baseline step (index 0)
    // is never a transition, and an agent already complete is not a transition again.
    if (index > 0 && next.workState === 'complete' && agent.workState !== 'complete') {
      eventId += 1
      celebrations.push({ id: eventId, agentId: agent.id, name: agent.name })
    }
    return next
  })
  return { step: index, agents, celebrations, eventId, lastEvent: step.label }
}

export function scenarioLength(): number {
  return SCENARIO_STEPS.length
}

export function isFinished(state: ScenarioState): boolean {
  return state.step >= SCENARIO_STEPS.length - 1
}

/** Advance exactly one step; at the end this is a no-op returning the same state. */
export function advanceScenario(state: ScenarioState): ScenarioState {
  if (isFinished(state)) return state
  return applyStep(state, state.step + 1)
}

/** Replay: identical to a fresh create, by construction. */
export function resetScenario(): ScenarioState {
  return createScenario()
}

// --- Derived, pure selectors -------------------------------------------------

/** Only a fresh, active agent may perform a work gesture. Stale pauses; unknown rests. */
export function canPerformWork(agent: ScenarioAgent): boolean {
  return agent.freshness === 'fresh' && agent.workState === 'active'
}

export function needsAttention(agent: ScenarioAgent): boolean {
  return agent.freshness === 'fresh' && agent.workState === 'needs-input'
}

export type Gesture = 'hammer' | 'read' | 'flag' | 'idle'

/** The steady gesture for a scene character. Never a work gesture unless active+fresh. */
export function gestureFor(agent: ScenarioAgent): Gesture {
  if (!canPerformWork(agent)) return 'idle'
  if (agent.station === 'forge') return 'hammer'
  if (agent.station === 'planning-table') return 'read'
  return 'flag'
}

export function workLabel(workState: WorkState): string {
  switch (workState) {
    case 'active': return 'Active'
    case 'needs-input': return 'Needs you'
    case 'complete': return 'Complete'
    case 'waiting': return 'Waiting'
    default: return 'Unknown'
  }
}

/** Explicit, non-colour status copy that keeps work state and freshness legible apart. */
export function statusLabel(agent: ScenarioAgent): string {
  if (agent.workState === 'unknown') return 'Unknown · no heartbeat'
  if (agent.freshness === 'stale') return `Stale snapshot · last ${workLabel(agent.workState).toLowerCase()}`
  return workLabel(agent.workState)
}

export interface ScenarioCounts {
  working: number
  needsYou: number
  complete: number
  total: number
}

export function scenarioCounts(state: ScenarioState): ScenarioCounts {
  let working = 0
  let needsYou = 0
  let complete = 0
  for (const agent of state.agents) {
    if (canPerformWork(agent)) working += 1
    if (needsAttention(agent)) needsYou += 1
    if (agent.freshness === 'fresh' && agent.workState === 'complete') complete += 1
  }
  return { working, needsYou, complete, total: state.agents.length }
}

/** Needs-input agents in stable cast order. Used by the "Needs you" cycle. */
export function attentionQueue(state: ScenarioState): ScenarioAgent[] {
  return state.agents.filter(needsAttention)
}

/**
 * The next eligible attention agent after `currentId`, wrapping around. Returns
 * undefined when nothing needs attention. Deterministic given the same state.
 */
export function selectNextAttention(state: ScenarioState, currentId?: string | null): string | undefined {
  const queue = attentionQueue(state)
  if (queue.length === 0) return undefined
  const index = currentId ? queue.findIndex((agent) => agent.id === currentId) : -1
  return queue[(index + 1) % queue.length].id
}
