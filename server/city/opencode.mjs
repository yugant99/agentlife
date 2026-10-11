// OpenCode city feed (plan 002, Lane A).
//
// Runs the existing `session.list` read for the scope and for each worktree
// path, bounded to 4 concurrent reads. Existing event types map to phase and
// toolKind: tool.execute.before -> tool, tool.execute.after -> gap,
// session.idle / session.error -> idle, session.status -> gap. Raw tool input
// and command text never leave this module.

import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { classifyCommand, toolKindForToolName } from './classify.mjs'
import { normalizePath, shortName, workspaceFor } from './scope.mjs'

const execFileAsync = promisify(execFile)
const READ_CONCURRENCY = 4

export const FRESH_MS = 90_000
export const STALE_MS = 20 * 60_000

export function deriveFreshness(lastSignalAt, now) {
  const age = now - lastSignalAt
  if (age <= FRESH_MS) return 'fresh'
  if (age <= STALE_MS) return 'stale'
  return 'historical'
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index])
    }
  }
  const workers = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: workers }, run))
  return results
}

async function listSessions(directory) {
  const args = ['api', 'session.list']
  if (directory) args.push('--param', `directory=${directory}`)
  const { stdout } = await execFileAsync(process.env.OPENCODE_BIN || 'opencode', args, {
    timeout: 4500,
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  })
  const payload = JSON.parse(stdout)
  const data = payload.data || payload.result?.data || []
  return Array.isArray(data) ? data : []
}

/** Map an event type (+ optional tool) to phase/toolKind. Pure. */
export function mapOpenCodeEvent(eventType, toolName, command) {
  if (typeof eventType !== 'string') return { phase: 'gap', toolKind: undefined }
  const type = eventType.trim()
  if (type === 'tool.execute.before') {
    return { phase: 'tool', toolKind: toolName ? toolKindForToolName(toolName, command ?? '') : undefined }
  }
  if (type === 'tool.execute.after') {
    return { phase: 'gap', toolKind: toolName ? toolKindForToolName(toolName, command ?? '') : undefined }
  }
  if (type === 'session.idle' || type === 'session.error') return { phase: 'idle', toolKind: undefined }
  if (type === 'session.status' || type === 'session.updated') return { phase: 'gap', toolKind: undefined }
  return { phase: 'gap', toolKind: undefined }
}

function parseTimeMs(value, fallback) {
  if (value === undefined || value === null) return fallback
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return Math.floor(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

function toolNameFromSession(session) {
  const candidates = [
    session?.tool, session?.toolName, session?.lastTool, session?.activeTool,
    session?.event?.tool, session?.lastEvent?.tool,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (candidate && typeof candidate === 'object') {
      const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : null
      if (name) return name
    }
  }
  return null
}

function commandFromSession(session) {
  const candidates = [
    session?.command, session?.cmd,
    session?.tool?.command, session?.tool?.input?.command,
    session?.lastEvent?.command, session?.event?.command,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return ''
}

function eventTypeFromSession(session) {
  const candidates = [session?.event?.type, session?.lastEvent?.type, session?.lastEventType]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

/** Map an OpenCode session to a work state. Never guesses from recency. */
export function workStateForSession(session) {
  if (!session || typeof session !== 'object') return 'unknown'
  if (session.outcome === 'failed') return 'unknown'
  if (session.outcome === 'succeeded') return 'complete'
  if (session.outcome === 'cancelled') return 'waiting'
  if (session.time?.idle) return 'waiting'
  const status = String(session.status ?? '').trim().toLowerCase()
  if (['active', 'running', 'busy', 'working', 'inprogress', 'in-progress', 'in_progress'].includes(status)) return 'active'
  if (['waiting', 'idle'].includes(status)) return 'waiting'
  if (['complete', 'completed', 'succeeded'].includes(status)) return 'complete'
  if (['needs-input', 'needs_input', 'needsinput', 'blocked'].includes(status)) return 'needs-input'
  return 'unknown'
}

function modelFromSession(session) {
  const model = session?.model
  if (typeof model === 'string' && model.trim()) return model.trim().slice(0, 80)
  if (model && typeof model === 'object') {
    const base = [model.providerID || model.provider, model.id || model.modelID].filter(Boolean).join('/')
    if (!base) return undefined
    const named = model.variant ? `${base}#${model.variant}` : base
    return named.slice(0, 80)
  }
  return undefined
}

/**
 * Map one session to a CityAgent, or null when out of scope. Pure (except
 * Date.now fallback) so tests can use synthetic sessions.
 */
export function mapOpenCodeSession(session, scopeSet, now = Date.now()) {
  if (!session || typeof session !== 'object' || typeof session.id !== 'string' || !session.id) return null
  const directory = session.location?.directory || session.directory || ''
  if (scopeSet && scopeSet.size > 0) {
    if (typeof directory !== 'string' || !directory || !scopeSet.has(normalizePath(directory))) return null
  }
  const workState = workStateForSession(session)
  const toolName = toolNameFromSession(session)
  const command = commandFromSession(session)
  const eventType = eventTypeFromSession(session)
  let phase
  let toolKind
  if (eventType) {
    const mapped = mapOpenCodeEvent(eventType, toolName, command)
    phase = mapped.phase
    toolKind = mapped.toolKind
  } else if (toolName) {
    toolKind = toolName.toLowerCase() === 'bash'
      ? classifyCommand(command)
      : toolKindForToolName(toolName, command)
    phase = workState === 'active' ? 'tool' : 'idle'
  } else {
    // Active work with no tool evidence reads as between tools, never frozen.
    phase = workState === 'active' ? 'gap' : 'idle'
    toolKind = undefined
  }
  // Waiting/completed sessions never advertise a tool in progress.
  if (workState === 'waiting' || workState === 'complete' || workState === 'unknown') {
    if (phase === 'tool') phase = 'idle'
  }
  if (workState === 'needs-input' && toolKind === undefined) toolKind = 'ask'

  const updatedMs = parseTimeMs(session.time?.updated ?? session.time?.created, now)
  const createdMs = parseTimeMs(session.time?.created, updatedMs)
  return {
    id: `opencode:${session.id}`,
    provider: 'opencode',
    source: 'live',
    parentId: typeof session.parentID === 'string' && session.parentID ? `opencode:${session.parentID}` : undefined,
    depth: 0,
    name: shortName(typeof session.title === 'string' ? session.title : '', `OpenCode ${String(session.id).slice(-6)}`),
    model: modelFromSession(session),
    workspace: workspaceFor(directory || process.env.COMMAND_CENTER_SCOPE_CWD || 'unknown'),
    workState,
    freshness: deriveFreshness(updatedMs, now),
    phase,
    toolKind,
    lastSignalAt: Math.floor(updatedMs),
    startedAt: Math.floor(createdMs),
  }
}

function withDepth(agents) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  for (const agent of agents) {
    if (!agent.parentId || !byId.has(agent.parentId)) {
      agent.depth = 0
      continue
    }
    let depth = 0
    let cursor = agent
    const seen = new Set([agent.id])
    while (cursor.parentId && byId.has(cursor.parentId) && depth < 5) {
      if (seen.has(cursor.parentId)) break
      seen.add(cursor.parentId)
      depth += 1
      cursor = byId.get(cursor.parentId)
    }
    agent.depth = Math.min(5, depth)
  }
  return agents
}

function cityDiagnostic(state, message, agents) {
  return { provider: 'opencode', state, message, agents }
}

// One `opencode api session.list` spawn per scope path is expensive with many worktrees,
// so a full read is reused for this long. Freshness is re-derived from lastSignalAt by
// the snapshot builder on every call, so a cached read never looks fresher than it is.
const READ_CACHE_TTL_MS = 60_000
let readCache = null

export async function readOpenCodeCity(scopeSet, options = {}) {
  const now = options.now ?? Date.now()
  const list = options.listSessions ?? listSessions
  const scopePaths = options.scopePaths ?? (scopeSet ? [...scopeSet] : [])
  if (!scopePaths || scopePaths.length === 0) {
    return { agents: [], diagnostic: cityDiagnostic('disconnected', 'OpenCode scope is not configured.', 0) }
  }
  const cacheable = !options.listSessions && !options.scopePaths
  const cacheKey = scopePaths.slice().sort().join('\n')
  if (cacheable && readCache && readCache.key === cacheKey && readCache.expiresAt > now) return readCache.result
  const result = await readOpenCodeScopes(scopeSet, scopePaths, list, now)
  // Never pin a failed read; the next call retries.
  if (cacheable && result.diagnostic.state !== 'error') readCache = { key: cacheKey, expiresAt: now + READ_CACHE_TTL_MS, result }
  return result
}

async function readOpenCodeScopes(scopeSet, scopePaths, list, now) {
  const batches = await mapLimit(scopePaths, READ_CONCURRENCY, async (scopePath) => {
    try {
      return { sessions: await list(scopePath), failed: false }
    } catch {
      return { sessions: [], failed: true }
    }
  })
  const failed = batches.filter((batch) => batch.failed).length
  const unique = [...new Map(batches.flatMap((batch) => batch.sessions)
    .filter((session) => session && typeof session.id === 'string')
    .map((session) => [session.id, session])).values()]
  const agents = withDepth(unique
    .map((session) => mapOpenCodeSession(session, scopeSet, now))
    .filter(Boolean))
  if (agents.length === 0 && failed === batches.length) {
    return { agents: [], diagnostic: cityDiagnostic('error', 'OpenCode session read failed.', 0) }
  }
  return {
    agents,
    diagnostic: cityDiagnostic(
      failed > 0 ? 'limited' : 'connected',
      failed > 0 ? 'OpenCode session snapshot read with skipped scopes.' : 'OpenCode session snapshot read.',
      agents.length,
    ),
  }
}
