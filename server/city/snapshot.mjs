// City snapshot builder (plan 002, Lane A).
//
// Merges the Codex, Claude Code and OpenCode city feeds into one
// CitySnapshot. Only CityAgent fields ever leave the server; raw command
// text, prompts, messages, tool input/output, descriptions and full paths
// are dropped by construction (allowlisted pick, never spread).

import { readClaudeCity } from './claude.mjs'
import { readCodexCity } from './codex.mjs'
import { readOpenCodeCity } from './opencode.mjs'
import { getScopeSet } from './scope.mjs'

export const FRESH_MS = 90_000
export const STALE_MS = 20 * 60_000

export function deriveFreshness(lastSignalAt, now) {
  const age = now - lastSignalAt
  if (age <= FRESH_MS) return 'fresh'
  if (age <= STALE_MS) return 'stale'
  return 'historical'
}

const VALID_WORK_STATES = new Set(['active', 'needs-input', 'waiting', 'complete', 'unknown'])
const VALID_PHASES = new Set(['thinking', 'tool', 'talking', 'gap', 'idle'])
const VALID_TOOL_KINDS = new Set(['shell', 'test', 'edit', 'read', 'search', 'web', 'ship', 'delegate', 'ask', 'other'])
const VALID_PROVIDERS = new Set(['codex', 'opencode', 'claude-code'])

/** Allowlisted pick: drop everything that is not a CityAgent field. */
export function sanitizeAgent(agent, now) {
  if (!agent || typeof agent !== 'object') return null
  if (!VALID_PROVIDERS.has(agent.provider)) return null
  if (typeof agent.id !== 'string' || !agent.id.startsWith(`${agent.provider}:`)) return null
  const workState = VALID_WORK_STATES.has(agent.workState) ? agent.workState : 'unknown'
  const phase = VALID_PHASES.has(agent.phase) ? agent.phase : 'idle'
  const toolKind = agent.toolKind === undefined ? undefined : (VALID_TOOL_KINDS.has(agent.toolKind) ? agent.toolKind : undefined)
  const lastSignalAt = Number(agent.lastSignalAt)
  if (!Number.isFinite(lastSignalAt)) return null
  const name = typeof agent.name === 'string' && agent.name.trim()
    ? agent.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40)
    : 'Agent'
  const workspace = typeof agent.workspace === 'string' && agent.workspace.trim()
    ? agent.workspace.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80) || 'unknown'
    : 'unknown'
  // Workspace is a folder basename: it must never contain a path separator.
  if (workspace.includes('/') || workspace.includes('\\')) return null

  const clean = {
    id: agent.id.slice(0, 160),
    provider: agent.provider,
    source: 'live',
    depth: Number.isFinite(Number(agent.depth)) ? Math.min(5, Math.max(0, Math.floor(Number(agent.depth)))) : 0,
    name,
    workspace,
    workState,
    freshness: deriveFreshness(lastSignalAt, now),
    phase,
    lastSignalAt: Math.floor(lastSignalAt),
  }
  if (typeof agent.parentId === 'string' && agent.parentId && agent.parentId !== clean.id) {
    clean.parentId = agent.parentId.slice(0, 160)
  }
  if (typeof agent.role === 'string' && agent.role.trim()) {
    clean.role = agent.role.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80)
  }
  if (typeof agent.model === 'string' && agent.model.trim()) {
    clean.model = agent.model.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80)
  }
  if (toolKind !== undefined) clean.toolKind = toolKind
  const startedAt = Number(agent.startedAt)
  if (Number.isFinite(startedAt)) clean.startedAt = Math.floor(startedAt)
  return clean
}

function sanitizeDiagnostic(diagnostic, agents) {
  const provider = diagnostic?.provider
  if (!VALID_PROVIDERS.has(provider)) return null
  const state = ['connected', 'limited', 'error', 'disconnected'].includes(diagnostic.state)
    ? diagnostic.state
    : 'error'
  const message = typeof diagnostic.message === 'string' && diagnostic.message
    ? diagnostic.message.slice(0, 160)
    : 'City feed read failed.'
  return { provider, state, message, agents: Number.isFinite(agents) ? agents : 0 }
}

/** Merge per-provider feeds into a CitySnapshot. Pure for tests. */
export function mergeCitySnapshot(feeds, now = Date.now()) {
  const agents = []
  const diagnostics = []
  for (const feed of feeds) {
    const list = Array.isArray(feed?.agents) ? feed.agents : []
    for (const agent of list) {
      const clean = sanitizeAgent(agent, now)
      if (clean) agents.push(clean)
    }
    const diagnostic = sanitizeDiagnostic(feed?.diagnostic, list.length)
    if (diagnostic) diagnostics.push(diagnostic)
  }
  agents.sort((a, b) => b.lastSignalAt - a.lastSignalAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { source: 'live', generatedAt: Math.floor(now), agents, diagnostics }
}

export async function buildCitySnapshot(options = {}) {
  const now = options.now ?? Date.now()
  const scopeSet = options.scopeSet ?? await getScopeSet().catch(() => new Set())
  const readers = options.readers ?? [
    readCodexCity(scopeSet, options),
    readClaudeCity(scopeSet, options),
    readOpenCodeCity(scopeSet, options),
  ]
  const settled = await Promise.allSettled(readers)
  const feeds = settled.map((entry, index) => {
    const provider = ['codex', 'claude-code', 'opencode'][index]
    if (entry.status === 'fulfilled' && entry.value) return entry.value
    return { agents: [], diagnostic: { provider, state: 'error', message: 'City feed read failed.', agents: 0 } }
  })
  return mergeCitySnapshot(feeds, now)
}
