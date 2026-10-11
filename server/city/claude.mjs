// Claude Code transcript feed for the city (plan 002, Lane A).
//
// Reads `~/.claude/projects/<encoded cwd>/<session>.jsonl` for in-scope cwds
// only (exact scope match). A `tool_use` without a following `tool_result` is
// phase tool. Sub-agents in `<session>/subagents/agent-*.jsonl` link to the
// parent session; `description` is never forwarded. Hook events in
// `~/.mythic/claude-events.jsonl` win over transcript inference:
// Notification -> needs-input, Stop -> waiting. Raw prompts, tool input and
// tool output never leave this module.

import { mkdir, open, readFile, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { toolKindForToolName } from './classify.mjs'
import { cwdInScopeSet, normalizePath, shortName, workspaceFor } from './scope.mjs'

export const FRESH_MS = 90_000
export const STALE_MS = 20 * 60_000
const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_HOOK_BYTES = 1024 * 1024
const READ_CONCURRENCY = 4
const MAX_SUBAGENTS_PER_SESSION = 20

const parseCache = new Map()
let hookCache = { mtimeMs: 0, size: 0, events: new Map() }

export function deriveFreshness(lastSignalAt, now) {
  const age = now - lastSignalAt
  if (age <= FRESH_MS) return 'fresh'
  if (age <= STALE_MS) return 'stale'
  return 'historical'
}

export function encodeProjectName(value) {
  return String(value).replace(/[^A-Za-z0-9]/g, '-')
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function commandFromInput(input) {
  if (typeof input === 'string') return input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  return firstString(input.command, input.cmd, input.code, input.script)
}

function asContentArray(entry) {
  const content = entry?.message?.content ?? entry?.content
  if (Array.isArray(content)) return content
  return []
}

/**
 * Parse a Claude transcript into display-safe metadata. Pure and defensive:
 * unknown line kinds are ignored, message bodies are never retained.
 */
export function parseClaudeTranscript(text, fallback = {}) {
  const result = {
    sessionId: typeof fallback.sessionId === 'string' ? fallback.sessionId : null,
    cwd: typeof fallback.cwd === 'string' ? fallback.cwd : null,
    customTitle: null,
    model: null,
    userTurns: 0,
    assistantTurns: 0,
    malformed: 0,
    firstAt: null,
    lastAt: null,
    phase: 'idle',
    toolKind: undefined,
    workState: 'unknown',
    lastToolName: null,
    lastCommand: '',
  }
  if (typeof text !== 'string' || !text) return result

  const pending = []
  let lastCompleted = null
  let lastAssistantKind = null
  let lastWasToolResult = false

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let entry
    try { entry = JSON.parse(line) } catch { result.malformed += 1; continue }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { result.malformed += 1; continue }

    if (result.sessionId === null && typeof entry.sessionId === 'string') result.sessionId = entry.sessionId
    if (result.sessionId === null && typeof entry.session_id === 'string') result.sessionId = entry.session_id
    if (result.cwd === null && typeof entry.cwd === 'string') result.cwd = entry.cwd

    const entryType = typeof entry.type === 'string' ? entry.type : ''
    if (entryType === 'custom-title' || entryType === 'custom_title') {
      const title = firstString(entry.customTitle, entry.custom_title, entry.title, entry.name, entry.text)
      if (title) result.customTitle = title
      continue
    }
    // agent-name / system lines carry no phase evidence; never forward their text.
    if (entryType === 'agent-name' || entryType === 'agent_name' || entryType === 'system') continue

    if (entryType === 'user' || entryType === 'assistant') {
      const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp)
        : (typeof entry.timestamp === 'number' ? (entry.timestamp < 10_000_000_000 ? entry.timestamp * 1000 : entry.timestamp) : NaN)
      if (Number.isFinite(at)) {
        if (result.firstAt === null || at < result.firstAt) result.firstAt = at
        if (result.lastAt === null || at > result.lastAt) result.lastAt = at
      }
      if (entryType === 'user') {
        result.userTurns += 1
        let sawResult = false
        for (const block of asContentArray(entry)) {
          if (!block || typeof block !== 'object') continue
          if (block.type === 'tool_result') {
            sawResult = true
            const ref = typeof block.tool_use_id === 'string' ? block.tool_use_id : null
            if (ref) {
              const index = pending.findIndex((item) => item.id === ref)
              if (index !== -1) {
                const [done] = pending.splice(index, 1)
                lastCompleted = { name: done.name, command: done.command }
              } else if (pending.length > 0) {
                const done = pending.shift()
                lastCompleted = { name: done.name, command: done.command }
              }
            } else if (pending.length > 0) {
              const done = pending.shift()
              lastCompleted = { name: done.name, command: done.command }
            }
          }
        }
        if (sawResult) lastWasToolResult = true
        continue
      }

      // assistant
      result.assistantTurns += 1
      const model = entry.message?.model
      if (typeof model === 'string' && model.trim()) result.model = model.trim().slice(0, 80)
      let sawToolUse = false
      let sawThinking = false
      let sawText = false
      for (const block of asContentArray(entry)) {
        if (!block || typeof block !== 'object') continue
        if (block.type === 'tool_use') {
          sawToolUse = true
          const name = typeof block.name === 'string' && block.name.trim() ? block.name.trim() : 'unknown'
          pending.push({ id: typeof block.id === 'string' ? block.id : null, name, command: commandFromInput(block.input) })
          lastWasToolResult = false
        } else if (block.type === 'thinking') {
          sawThinking = true
        } else if (block.type === 'text') {
          sawText = true
        }
      }
      if (sawToolUse) lastAssistantKind = 'tool_use'
      else if (sawThinking) lastAssistantKind = 'thinking'
      else if (sawText) lastAssistantKind = 'text'
      if (!sawToolUse && (sawThinking || sawText)) lastWasToolResult = false
    }
  }

  if (pending.length > 0) {
    const last = pending[pending.length - 1]
    result.lastToolName = last.name
    result.lastCommand = last.command
    result.toolKind = toolKindForToolName(last.name, last.command)
    if (last.name.toLowerCase() === 'askuserquestion') {
      result.workState = 'needs-input'
      result.phase = 'idle'
      result.toolKind = 'ask'
    } else {
      result.workState = 'active'
      result.phase = 'tool'
    }
    return result
  }

  if (lastCompleted) {
    result.lastToolName = lastCompleted.name
    result.lastCommand = lastCompleted.command
    result.toolKind = toolKindForToolName(lastCompleted.name, lastCompleted.command)
    if (lastCompleted.name.toLowerCase() === 'askuserquestion') {
      result.workState = 'needs-input'
      result.phase = 'idle'
      result.toolKind = 'ask'
      return result
    }
  }

  if (lastWasToolResult) {
    result.workState = 'active'
    result.phase = 'gap'
    return result
  }
  if (lastAssistantKind === 'thinking') {
    result.workState = 'active'
    result.phase = 'thinking'
    return result
  }
  if (lastAssistantKind === 'text') {
    result.workState = 'active'
    result.phase = 'talking'
    return result
  }
  if (result.userTurns === 0 && result.assistantTurns === 0) {
    result.workState = 'unknown'
    result.phase = 'idle'
    return result
  }
  result.workState = 'active'
  result.phase = 'gap'
  return result
}

/** Parse an `agent-*.meta.json` file. `description` is dropped, never returned. */
export function parseSubagentMeta(text) {
  let obj
  try { obj = JSON.parse(text) } catch { return null }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const agentType = typeof obj.agentType === 'string' && obj.agentType.trim() ? obj.agentType.trim().slice(0, 80) : undefined
  const toolUseId = typeof obj.toolUseId === 'string' && obj.toolUseId ? obj.toolUseId : undefined
  const spawnDepth = Number.isFinite(Number(obj.spawnDepth)) ? Number(obj.spawnDepth) : undefined
  const model = typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim().slice(0, 80) : undefined
  return { agentType, toolUseId, spawnDepth, model }
}

/** Parse hook events into session_id -> latest event. Pure. */
export function parseHookEvents(text) {
  const bySession = new Map()
  if (typeof text !== 'string' || !text) return bySession
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const sessionId = firstString(entry.session_id, entry.sessionId)
    const hookEvent = firstString(entry.hook_event_name, entry.hookEventName)
    if (!sessionId || !hookEvent) continue
    const toolName = typeof entry.tool_name === 'string' ? entry.tool_name : (typeof entry.toolName === 'string' ? entry.toolName : '')
    let ts = Number(entry.ts)
    if (!Number.isFinite(ts)) {
      const parsed = Date.parse(String(entry.ts ?? ''))
      ts = Number.isFinite(parsed) ? parsed : 0
    }
    // Keep the latest event per session by ts, falling back to file order.
    const prior = bySession.get(sessionId)
    if (!prior || ts >= prior.ts) bySession.set(sessionId, { sessionId, hookEvent, toolName, ts })
  }
  return bySession
}

/**
 * Hook override for a session. Returns null when the transcript stands.
 * Notification -> needs-input, Stop -> waiting, Pre/PostToolUse -> tool/gap.
 */
export function hookOverride(hookEvent) {
  if (!hookEvent || typeof hookEvent.hookEvent !== 'string') return null
  const name = hookEvent.hookEvent.toLowerCase()
  if (name === 'notification') return { workState: 'needs-input', phase: 'idle', toolKind: 'ask' }
  if (name === 'stop') return { workState: 'waiting', phase: 'idle', toolKind: undefined }
  if (name === 'pretooluse') {
    return { workState: 'active', phase: 'tool', toolKind: toolKindForToolName(hookEvent.toolName || 'unknown', '') }
  }
  if (name === 'posttooluse') {
    return { workState: 'active', phase: 'gap', toolKind: toolKindForToolName(hookEvent.toolName || 'unknown', '') }
  }
  return null
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

async function readHookEvents() {
  const hookFile = path.join(os.homedir(), '.mythic', 'claude-events.jsonl')
  let stats
  try { stats = await stat(hookFile) } catch { return new Map() }
  if (hookCache.mtimeMs === stats.mtimeMs && hookCache.size === stats.size) return hookCache.events
  try {
    let text
    if (stats.size > MAX_HOOK_BYTES) {
      const handle = await open(hookFile, 'r')
      try {
        const buffer = Buffer.alloc(MAX_HOOK_BYTES)
        await handle.read(buffer, 0, MAX_HOOK_BYTES, Math.max(0, stats.size - MAX_HOOK_BYTES))
        text = buffer.toString('utf8')
      } finally { await handle.close().catch(() => {}) }
    } else {
      text = await readFile(hookFile, 'utf8')
    }
    const events = parseHookEvents(text)
    hookCache = { mtimeMs: stats.mtimeMs, size: stats.size, events }
    return events
  } catch {
    return new Map()
  }
}

function subagentCandidates(transcriptFile, sessionId) {
  const dir = path.dirname(transcriptFile)
  const base = path.basename(transcriptFile, '.jsonl')
  const candidates = [
    path.join(dir, base, 'subagents'),
    path.join(dir, sessionId, 'subagents'),
  ]
  return [...new Set(candidates)]
}

async function readSubagents(transcriptFile, sessionId, parentCwd, parentWorkspace, now, hookEvents) {
  const agents = []
  for (const subDir of subagentCandidates(transcriptFile, sessionId)) {
    let files
    try { files = await readdir(subDir, { withFileTypes: true }) } catch { continue }
    const agentFiles = files
      .filter((entry) => entry.isFile() && entry.name.startsWith('agent-') && entry.name.endsWith('.jsonl'))
      .slice(0, MAX_SUBAGENTS_PER_SESSION)
    for (const file of agentFiles) {
      const agentPath = path.join(subDir, file.name)
      const agentBase = path.basename(file.name, '.jsonl')
      let stats
      try { stats = await stat(agentPath) } catch { continue }
      if (stats.size > MAX_FILE_BYTES) continue
      let meta = null
      const metaPath = path.join(subDir, `${agentBase}.meta.json`)
      try { meta = parseSubagentMeta(await readFile(metaPath, 'utf8')) } catch { meta = null }
      let parsed
      try {
        const text = await readFile(agentPath, 'utf8')
        parsed = parseClaudeTranscript(text, { sessionId: `${sessionId}/${agentBase}`, cwd: parentCwd })
      } catch { continue }
      const subId = `${sessionId}/${agentBase}`
      const hookKey = [...hookEvents.keys()].find((key) => key === subId || key === agentBase)
      const override = hookKey ? hookOverride(hookEvents.get(hookKey)) : null
      const hookTs = hookKey ? (hookEvents.get(hookKey).ts || 0) : 0
      const lastSignalAt = Math.floor(Math.max(stats.mtimeMs, parsed.lastAt ?? 0, hookTs))
      agents.push({
        id: `claude-code:${subId}`,
        provider: 'claude-code',
        source: 'live',
        parentId: `claude-code:${sessionId}`,
        depth: Number.isFinite(meta?.spawnDepth) && meta.spawnDepth >= 1 ? Math.min(5, Math.floor(meta.spawnDepth)) : 1,
        name: shortName(agentBase, agentBase).slice(0, 40),
        role: meta?.agentType,
        model: meta?.model,
        workspace: parentWorkspace,
        workState: override?.workState ?? parsed.workState,
        freshness: deriveFreshness(lastSignalAt, now),
        phase: override?.phase ?? parsed.phase,
        toolKind: override?.toolKind !== undefined ? override.toolKind : parsed.toolKind,
        lastSignalAt,
        startedAt: parsed.firstAt ?? Math.floor(stats.birthtimeMs || stats.mtimeMs),
      })
    }
    if (agents.length > 0) break
  }
  return agents
}

function cityDiagnostic(state, message, agents) {
  return { provider: 'claude-code', state, message, agents }
}

export async function readClaudeCity(scopeSet, options = {}) {
  const now = options.now ?? Date.now()
  if (!scopeSet || scopeSet.size === 0) {
    return { agents: [], diagnostic: cityDiagnostic('disconnected', 'Claude Code scope is not configured.', 0) }
  }
  const projectsRoot = options.projectsRoot ?? path.join(os.homedir(), '.claude', 'projects')
  const scopePaths = options.scopePaths ?? [...scopeSet]
  const encodedScopes = new Set()
  const encodedBases = new Set()
  for (const scopePath of scopePaths) {
    encodedScopes.add(encodeProjectName(scopePath))
    const base = encodeProjectName(path.basename(normalizePath(scopePath)))
    if (base.length > 1) encodedBases.add(base)
  }

  let entries
  try { entries = await readdir(projectsRoot, { withFileTypes: true }) } catch (error) {
    if (error?.code === 'ENOENT') {
      return { agents: [], diagnostic: cityDiagnostic('disconnected', 'No local Claude Code sessions were found.', 0) }
    }
    return { agents: [], diagnostic: cityDiagnostic('error', 'Claude Code session read failed.', 0) }
  }
  const matchedDirs = entries
    .filter((entry) => entry.isDirectory() && (encodedScopes.has(entry.name)
      || [...encodedBases].some((base) => entry.name.endsWith(`-${base}`))))
    .map((entry) => path.join(projectsRoot, entry.name))

  const candidates = []
  for (const dir of matchedDirs) {
    let files
    try { files = await readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const file of files) {
      if (file.isFile() && file.name.endsWith('.jsonl') && !file.name.startsWith('agent-')) {
        candidates.push(path.join(dir, file.name))
      }
    }
  }

  const listLimit = Math.min(500, Math.max(1, Number(process.env.TELEMETRY_LIST_LIMIT || 200) || 200))
  const statted = []
  for (const file of candidates) {
    try { statted.push({ file, stats: await stat(file) }) } catch { /* skip unreadable */ }
  }
  statted.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)
  const selected = statted.slice(0, listLimit)
  const retentionMinutes = Number(process.env.TELEMETRY_RETENTION_MINUTES || 10_080)
  const cutoff = now - retentionMinutes * 60_000

  const parsed = await mapLimit(selected, READ_CONCURRENCY, async (item) => {
    if (item.stats.size > MAX_FILE_BYTES) return { ...item, meta: null, oversized: true }
    const cached = parseCache.get(item.file)
    if (cached && cached.mtimeMs === item.stats.mtimeMs && cached.size === item.stats.size) {
      return { ...item, meta: cached.meta }
    }
    try {
      const text = await readFile(item.file, 'utf8')
      const fallbackId = path.basename(item.file, '.jsonl')
      const meta = parseClaudeTranscript(text, { sessionId: fallbackId })
      parseCache.set(item.file, { mtimeMs: item.stats.mtimeMs, size: item.stats.size, meta })
      return { ...item, meta }
    } catch {
      return { ...item, meta: null, unreadable: true }
    }
  })

  const candidateSet = new Set(candidates)
  for (const key of parseCache.keys()) if (!candidateSet.has(key)) parseCache.delete(key)

  const hookEvents = options.hookEvents ?? await readHookEvents().catch(() => new Map())
  const agents = []
  let limited = parsed.some((item) => item.oversized || item.unreadable)
  for (const item of parsed) {
    if (!item.meta || item.oversized || item.unreadable) continue
    const meta = item.meta
    if (meta.userTurns === 0 && meta.assistantTurns === 0) continue
    if (!cwdInScopeSet(meta.cwd, scopeSet)) continue
    const sessionId = meta.sessionId || path.basename(item.file, '.jsonl')
    const updatedMs = Math.max(meta.lastAt ?? 0, item.stats.mtimeMs)
    if (updatedMs < cutoff) continue
    const hook = hookEvents.get(sessionId)
    const override = hook ? hookOverride(hook) : null
    if (hook && !override) {
      // Unknown hook kinds never override the transcript.
    }
    const hookTs = hook && Number.isFinite(hook.ts) ? hook.ts : 0
    const lastSignalAt = Math.floor(Math.max(item.stats.mtimeMs, meta.lastAt ?? 0, hookTs))
    const workspace = workspaceFor(meta.cwd)
    const slug = workspace
    agents.push({
      id: `claude-code:${sessionId}`,
      provider: 'claude-code',
      source: 'live',
      parentId: undefined,
      depth: 0,
      name: shortName(meta.customTitle, `${slug} ${sessionId.slice(0, 8)}`),
      model: meta.model ?? undefined,
      workspace,
      workState: override?.workState ?? meta.workState,
      freshness: deriveFreshness(lastSignalAt, now),
      phase: override?.phase ?? meta.phase,
      toolKind: override?.toolKind !== undefined ? override.toolKind : meta.toolKind,
      lastSignalAt,
      startedAt: meta.firstAt ?? Math.floor(item.stats.birthtimeMs || item.stats.mtimeMs),
    })
    if (!options.skipSubagents) {
      try {
        const children = await readSubagents(item.file, sessionId, meta.cwd, workspace, now, hookEvents)
        agents.push(...children.filter((child) => child.lastSignalAt >= cutoff))
      } catch { limited = true }
    }
  }

  // Ensure the hook cache dir exists for the documented hook path (best effort).
  try { await mkdir(path.join(os.homedir(), '.mythic'), { recursive: true }) } catch { /* ignore */ }

  return {
    agents,
    diagnostic: cityDiagnostic(
      limited ? 'limited' : 'connected',
      limited ? 'Claude Code session snapshot read with skipped files.' : 'Claude Code session snapshot read.',
      agents.length,
    ),
  }
}
