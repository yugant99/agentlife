// Codex rollout feed for the city (plan 002, Lane A).
//
// Reads `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`: only files modified in
// the last 24 h, at most 80 files newest first. Line 1 is `session_meta`
// (id, cwd, explicit parent only); the bounded tail (<= 256 KB) carries
// `event_msg` / `response_item` records. Parse defensively, ignore unknown
// kinds. The file mtime is the heartbeat. Raw command text never leaves here.

import { open, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { classifyCommand, toolKindForCodexItem } from './classify.mjs'
import { getCodexThreadTitles } from './codexTitles.mjs'
import { cwdInScopeSet, shortName, workspaceFor } from './scope.mjs'

export const FRESH_MS = 90_000
export const STALE_MS = 20 * 60_000
const RECENT_MS = 24 * 3600_000
const MAX_FILES = 80
const MAX_TAIL_BYTES = 256 * 1024
// Real session_meta lines embed the base instructions and run to tens of KB.
const MAX_FIRST_BYTES = 128 * 1024

const parseCache = new Map()

export function deriveFreshness(lastSignalAt, now) {
  const age = now - lastSignalAt
  if (age <= FRESH_MS) return 'fresh'
  if (age <= STALE_MS) return 'stale'
  return 'historical'
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
    if (Array.isArray(value) && value.length > 0) {
      const joined = value.filter((entry) => typeof entry === 'string').join(' ').trim()
      if (joined) return joined
    }
  }
  return ''
}

function extractCommand(item, payload, obj) {
  const input = item?.input ?? payload?.input ?? obj?.input
  const inputCommand = typeof input === 'string'
    ? input
    : firstString(input?.command, input?.cmd, input?.code, input?.script)
  return firstString(
    item?.command, item?.cmd, item?.code, item?.script,
    payload?.command, payload?.cmd,
    obj?.command, obj?.cmd,
    inputCommand,
  )
}

/** True when any type field mentions approval_request (case-insensitive). */
export function isApprovalEvent(obj, payload, item) {
  const candidates = [
    obj?.type, obj?.kind, obj?.eventType,
    payload?.type, payload?.kind, payload?.eventType,
    item?.type, item?.itemType, item?.kind,
  ]
  return candidates.some((entry) => typeof entry === 'string' && entry.toLowerCase().includes('approval_request'))
}

/** Extract session_meta fields defensively. Never throws. */
// When the first line is cut off at MAX_FIRST_BYTES, recover the leading scalar fields
// (id, cwd, timestamp precede the long instructions) instead of dropping the session.
function salvageMeta(prefix) {
  const field = (key) => {
    const match = prefix.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))
    if (!match) return undefined
    try { return JSON.parse(`"${match[1]}"`) } catch { return undefined }
  }
  const id = field('id') ?? field('session_id')
  if (!id) return null
  return { type: 'session_meta', payload: { id, cwd: field('cwd'), timestamp: field('timestamp') } }
}

export function parseCodexMeta(firstLine, fallbackId = '') {
  let obj = null
  try { obj = JSON.parse(firstLine) } catch { obj = salvageMeta(firstLine) }
  if (!obj) return null
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const meta = obj.session_meta && typeof obj.session_meta === 'object' && !Array.isArray(obj.session_meta)
    ? obj.session_meta
    : (obj.type === 'session_meta' ? (obj.payload && typeof obj.payload === 'object' ? obj.payload : obj) : obj)
  const id = firstString(meta.id, meta.session_id, meta.sessionId, meta.threadId, fallbackId)
  if (!id) return null
  const cwd = typeof meta.cwd === 'string' && meta.cwd
    ? meta.cwd
    : firstString(meta.workdir, meta.directory)
  const parent = firstString(
    meta.parentId, meta.parent_id, meta.parentThreadId, meta.parent_thread_id,
    meta.ancestorId, meta.ancestor_id, meta.parentSessionId, meta.parent_session_id,
    typeof meta.parent === 'string' ? meta.parent : meta.parent?.id,
    typeof meta.ancestor === 'string' ? meta.ancestor : meta.ancestor?.id,
  )
  const model = typeof meta.model === 'string' && meta.model.trim() ? meta.model.trim().slice(0, 80) : undefined
  let startedAt
  const stamp = meta.timestamp ?? meta.createdAt ?? meta.created_at
  if (stamp !== undefined) {
    const numeric = Number(stamp)
    const ms = Number.isFinite(numeric) ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric) : Date.parse(String(stamp))
    if (Number.isFinite(ms)) startedAt = ms
  }
  return { id: String(id), cwd: cwd || null, parentId: parent || null, model, startedAt }
}

/**
 * Parse a bounded tail into work state. Defensive: unknown kinds are ignored,
 * last state-changing event wins, approval_request latches to needs-input
 * until a later tool event or task_complete overrides it in order.
 */
export function parseCodexTail(tailText) {
  let workState = 'unknown'
  let phase = 'idle'
  let toolKind
  let seenEvents = 0
  if (typeof tailText !== 'string' || !tailText) return { workState, phase, toolKind, seenEvents }

  for (const line of tailText.split('\n')) {
    if (!line.trim()) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue
    if (obj.session_meta || obj.type === 'session_meta') continue

    const isEventMsg = obj.type === 'event_msg'
    const isResponseItem = obj.type === 'response_item'
    const payload = isEventMsg
      ? (obj.payload && typeof obj.payload === 'object' ? obj.payload : {})
      : (isResponseItem
        ? (obj.payload && typeof obj.payload === 'object' ? obj.payload
          : (obj.item && typeof obj.item === 'object' ? obj.item : {}))
        : null)
    const item = payload && typeof payload.item === 'object' && payload.item !== null
      ? payload.item
      : (payload && typeof payload.payload === 'object' && payload.payload !== null ? payload.payload : null)

    if (isApprovalEvent(obj, payload, item)) {
      workState = 'needs-input'
      toolKind = 'ask'
      phase = 'idle'
      seenEvents += 1
      continue
    }
    if (!isEventMsg && !isResponseItem) continue

    if (isEventMsg) {
      const ptype = String(payload.type ?? '').toLowerCase()
      if (ptype === 'task_started') {
        if (workState === 'unknown') workState = 'active'
        seenEvents += 1
        continue
      }
      if (ptype === 'task_complete') {
        workState = 'waiting'
        phase = 'idle'
        seenEvents += 1
        continue
      }
      if (ptype === 'token_count') {
        if (workState === 'unknown') { workState = 'active'; phase = 'gap' }
        seenEvents += 1
        continue
      }
      if (ptype === 'item_started' || ptype === 'item_completed') {
        if (!item) { seenEvents += 1; continue }
        const itype = String(item.type ?? item.itemType ?? item.kind ?? '').toLowerCase()
        const command = extractCommand(item, payload, obj)
        const hint = firstString(item.tool, item.name, item.toolName, payload.tool)
        const kind = toolKindForCodexItem(itype, command, hint)
        const finished = ptype === 'item_completed'
        if (itype === 'reasoning') {
          workState = 'active'
          phase = 'thinking'
        } else if (itype === 'agentmessage' || itype === 'message') {
          workState = 'active'
          phase = 'talking'
        } else if (itype === 'usermessage' || itype === 'user_message') {
          workState = 'active'
          phase = 'talking'
        } else if (kind !== undefined) {
          workState = 'active'
          toolKind = kind
          phase = finished ? 'gap' : 'tool'
        }
        seenEvents += 1
        continue
      }
      continue
    }

    // response_item
    const rtype = String(payload.type ?? '').toLowerCase()
    if (rtype === 'custom_tool_call') {
      const name = String(payload.name ?? '').toLowerCase()
      const command = extractCommand(payload, payload, obj)
      toolKind = name === 'exec' ? classifyCommand(command) : 'other'
      workState = 'active'
      phase = 'tool'
      seenEvents += 1
    } else if (rtype === 'function_call' || rtype === 'functioncall') {
      toolKind = 'other'
      workState = 'active'
      phase = 'tool'
      seenEvents += 1
    } else if (rtype === 'message') {
      workState = 'active'
      phase = 'talking'
      seenEvents += 1
    } else if (rtype === 'reasoning') {
      workState = 'active'
      phase = 'thinking'
      seenEvents += 1
    }
  }
  return { workState, phase, toolKind, seenEvents }
}

async function readFirstLineAndTail(filePath, size) {
  const handle = await open(filePath, 'r')
  try {
    const firstLength = Math.min(size, MAX_FIRST_BYTES)
    const firstBuffer = Buffer.alloc(Math.max(1, firstLength))
    const firstRead = size > 0 ? await handle.read(firstBuffer, 0, firstLength, 0) : { bytesRead: 0 }
    const firstChunk = firstBuffer.subarray(0, firstRead.bytesRead).toString('utf8')
    const newline = firstChunk.indexOf('\n')
    const firstLine = newline === -1 ? firstChunk : firstChunk.slice(0, newline)

    const tailLength = Math.min(size, MAX_TAIL_BYTES)
    const tailBuffer = Buffer.alloc(Math.max(1, tailLength))
    const position = Math.max(0, size - tailLength)
    const tailRead = size > 0 ? await handle.read(tailBuffer, 0, tailLength, position) : { bytesRead: 0 }
    const tailText = tailBuffer.subarray(0, tailRead.bytesRead).toString('utf8')
    return { firstLine, tailText }
  } finally {
    await handle.close().catch(() => {})
  }
}

async function collectRolloutFiles(root, now) {
  const collected = []
  let years
  try { years = await readdir(root, { withFileTypes: true }) } catch { return [] }
  for (const year of years) {
    if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue
    let months
    try { months = await readdir(path.join(root, year.name), { withFileTypes: true }) } catch { continue }
    for (const month of months) {
      if (!month.isDirectory() || !/^\d{2}$/.test(month.name)) continue
      let days
      try { days = await readdir(path.join(root, year.name, month.name), { withFileTypes: true }) } catch { continue }
      for (const day of days) {
        if (!day.isDirectory() || !/^\d{2}$/.test(day.name)) continue
        const dir = path.join(root, year.name, month.name, day.name)
        let files
        try { files = await readdir(dir, { withFileTypes: true }) } catch { continue }
        for (const file of files) {
          if (!file.isFile() || !file.name.startsWith('rollout-') || !file.name.endsWith('.jsonl')) continue
          const full = path.join(dir, file.name)
          let stats
          try { stats = await stat(full) } catch { continue }
          if (!Number.isFinite(stats.mtimeMs)) continue
          if (stats.mtimeMs > now + 60_000 || now - stats.mtimeMs > RECENT_MS) continue
          collected.push({ file: full, stats })
        }
      }
    }
  }
  collected.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)
  return collected.slice(0, MAX_FILES)
}

function cityDiagnostic(state, message, agents) {
  return { provider: 'codex', state, message, agents }
}

export async function readCodexCity(scopeSet, options = {}) {
  const now = options.now ?? Date.now()
  if (!scopeSet || scopeSet.size === 0) {
    return { agents: [], diagnostic: cityDiagnostic('disconnected', 'Codex scope is not configured.', 0) }
  }
  const sessionsRoot = options.sessionsRoot ?? path.join(os.homedir(), '.codex', 'sessions')
  let files
  try {
    files = await collectRolloutFiles(sessionsRoot, now)
  } catch {
    return { agents: [], diagnostic: cityDiagnostic('error', 'Codex session read failed.', 0) }
  }
  if (files.length === 0) {
    return { agents: [], diagnostic: cityDiagnostic('disconnected', 'No recent Codex sessions were found.', 0) }
  }

  let titles = options.titles
  if (!titles) {
    try { titles = await getCodexThreadTitles() } catch { titles = new Map() }
  }

  const agents = []
  let skipped = 0
  for (const { file, stats } of files) {
    const cached = parseCache.get(file)
    let parsed
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      parsed = cached.parsed
    } else {
      try {
        const { firstLine, tailText } = await readFirstLineAndTail(file, stats.size)
        const base = path.basename(file, '.jsonl')
        const meta = parseCodexMeta(firstLine, base)
        if (!meta) { skipped += 1; continue }
        const tail = parseCodexTail(tailText)
        parsed = { meta, tail }
        parseCache.set(file, { mtimeMs: stats.mtimeMs, size: stats.size, parsed })
      } catch {
        skipped += 1
        continue
      }
    }
    if (!parsed.meta.cwd || !cwdInScopeSet(parsed.meta.cwd, scopeSet)) continue
    const nativeId = parsed.meta.id
    const title = titles instanceof Map ? titles.get(nativeId) : undefined
    const agent = {
      id: `codex:${nativeId}`,
      provider: 'codex',
      source: 'live',
      parentId: parsed.meta.parentId ? `codex:${parsed.meta.parentId}` : undefined,
      depth: parsed.meta.parentId ? 1 : 0,
      name: shortName(title, `Codex ${String(nativeId).slice(-6)}`),
      model: parsed.meta.model,
      workspace: workspaceFor(parsed.meta.cwd),
      workState: parsed.tail.workState,
      freshness: deriveFreshness(stats.mtimeMs, now),
      phase: parsed.tail.phase,
      toolKind: parsed.tail.toolKind,
      lastSignalAt: Math.floor(stats.mtimeMs),
      startedAt: parsed.meta.startedAt ?? Math.floor(stats.birthtimeMs || stats.mtimeMs),
    }
    if (agent.parentId === agent.id) { agent.parentId = undefined; agent.depth = 0 }
    agents.push(agent)
  }

  // Keep the parse cache bounded to this scan.
  const liveFiles = new Set(files.map((entry) => entry.file))
  for (const key of parseCache.keys()) if (!liveFiles.has(key)) parseCache.delete(key)

  const limited = skipped > 0
  return {
    agents,
    diagnostic: cityDiagnostic(
      limited ? 'limited' : 'connected',
      limited ? 'Codex session snapshot read with skipped files.' : 'Codex session snapshot read.',
      agents.length,
    ),
  }
}
