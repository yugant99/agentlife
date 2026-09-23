import { readFile, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { classifyFailure, isoTime, safeActivity } from '../safety.mjs'

// Claude Code writes one JSONL transcript per session under ~/.claude/projects,
// in a directory named after the session's working directory. This adapter parses
// those local files, but extracts and forwards only an allowlisted set of metadata
// fields. Prompt text, message bodies, tool arguments and tool output are never
// used, stored, or forwarded, and no local path is sent to the browser.
const PROVIDER = 'claude-code'
const PROJECTS_DIRNAME = 'projects'
const TRANSCRIPT_EXTENSION = '.jsonl'

// A single transcript is read at most this large. Anything larger is skipped and
// reported as a limitation rather than being streamed without bound.
const MAX_FILE_BYTES = 12 * 1024 * 1024
// Bounded parallelism for file reads so a large history cannot open an unbounded
// number of file descriptors at once.
const READ_CONCURRENCY = 4

// Parsed metadata is cached by file mtime and size because the client polls every
// 15 seconds; an unchanged transcript is never re-read. The cache stores only
// derived metadata, never transcript content, and is pruned to the current scan.
const parseCache = new Map()

/**
 * Claude Code names each project directory by replacing every character that is
 * not alphanumeric with a dash (for example
 * /Users/me/Downloads/Ip_inventory -> -Users-me-Downloads-Ip-inventory).
 */
function encodeProjectName(value) {
  return String(value).replace(/[^A-Za-z0-9]/g, '-')
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

/**
 * Parses each local JSONL line, but extracts only the metadata fields this adapter
 * needs: the line type, session id, cwd, and an assistant line's model. A chat
 * turn's timestamp is tracked only for real user/assistant turns, so system, queue
 * or cost lines cannot move a session's updated time. Message content is never used
 * or forwarded.
 */
async function scanFile(filePath) {
  const text = await readFile(filePath, 'utf8')
  const meta = {
    userTurns: 0, assistantTurns: 0, malformed: 0,
    models: new Set(), sessionId: null, cwd: null, firstAt: null, lastAt: null,
  }
  for (const line of text.split('\n')) {
    if (!line) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      meta.malformed += 1
      continue
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      meta.malformed += 1
      continue
    }
    if (meta.sessionId === null && typeof entry.sessionId === 'string') meta.sessionId = entry.sessionId
    if (meta.cwd === null && typeof entry.cwd === 'string') meta.cwd = entry.cwd
    if (entry.type === 'user' || entry.type === 'assistant') {
      if (entry.type === 'user') meta.userTurns += 1
      else {
        meta.assistantTurns += 1
        const model = entry.message?.model
        if (typeof model === 'string' && model) meta.models.add(model)
      }
      const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
      if (Number.isFinite(at)) {
        if (meta.firstAt === null || at < meta.firstAt) meta.firstAt = at
        if (meta.lastAt === null || at > meta.lastAt) meta.lastAt = at
      }
    }
  }
  return meta
}

async function readCached(filePath, stats) {
  const cached = parseCache.get(filePath)
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached.meta
  const meta = await scanFile(filePath)
  parseCache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, meta })
  return meta
}

// A neutral, short workspace/task slug: the scope's own basename for the main
// project, or the containing task folder for a matching-basename worktree. Only a
// folder name is ever used, never a full local path.
function slugFor(cwd, scope) {
  const scopeBase = path.basename(path.normalize(scope))
  if (!cwd) return scopeBase
  const normalized = path.normalize(cwd)
  if (normalized === path.normalize(scope)) return scopeBase
  if (path.basename(normalized) === scopeBase) {
    const parent = path.basename(path.dirname(normalized))
    if (parent && parent !== path.basename(path.dirname(path.normalize(scope)))) return parent
  }
  return path.basename(normalized) || scopeBase
}

// A matched encoded directory suffix can also belong to an unrelated same-named
// project. The transcript's own cwd is the deciding evidence: it must be exactly the
// configured scope, or a matching-basename worktree under ~/.codex/worktrees.
// Anything else is skipped rather than mis-attributed. Only the check uses the path;
// no full path is forwarded.
function cwdMatchesScope(cwd, scope) {
  if (typeof cwd !== 'string' || !cwd) return false
  const normalizedCwd = path.normalize(cwd)
  const normalizedScope = path.normalize(scope)
  if (normalizedCwd === normalizedScope) return true
  if (path.basename(normalizedCwd) !== path.basename(normalizedScope)) return false
  const worktreesRoot = path.join(os.homedir(), '.codex', 'worktrees')
  const relative = path.relative(worktreesRoot, normalizedCwd)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function unavailable(message, limitation) {
  return {
    connected: false, limited: false, message, records: [],
    diagnostic: {
      provider: PROVIDER, state: 'disconnected', adapter: 'Claude Code local session metadata',
      endpoint: '~/.claude/projects/<scoped>/*.jsonl', recordsReceived: 0, limitation,
    },
  }
}

export async function readClaudeCode() {
  const startedAt = new Date().toISOString()
  const scope = process.env.COMMAND_CENTER_SCOPE_CWD
  // Without a scope there is no bounded way to attribute transcripts to one
  // project; scanning every project directory would be an unbounded home-directory
  // read, so the adapter stays disconnected until one is configured.
  if (!scope) {
    return unavailable(
      'Claude Code scope is not configured.',
      'Set COMMAND_CENTER_SCOPE_CWD to read the scoped project\'s Claude Code session metadata.',
    )
  }

  const projectsRoot = path.join(os.homedir(), '.claude', PROJECTS_DIRNAME)
  const encodedScope = encodeProjectName(scope)
  const encodedBase = encodeProjectName(path.basename(path.normalize(scope)))

  let entries
  try {
    entries = await readdir(projectsRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return unavailable(
        'No local Claude Code project directory was found.',
        'Claude Code has not written any local project transcripts on this machine.',
      )
    }
    return {
      connected: false, limited: false, message: 'Claude Code project directory could not be read.', records: [],
      diagnostic: {
        provider: PROVIDER, state: 'error', adapter: 'Claude Code local session metadata',
        endpoint: '~/.claude/projects/<scoped>/*.jsonl', recordsReceived: 0, failureReason: classifyFailure(error),
      },
    }
  }

  // Narrow the scan to the scoped project directory and directories sharing the
  // scope's basename; each transcript's own cwd is verified before it becomes a
  // record, so an unrelated same-named project is skipped.
  const matchedDirs = entries
    .filter((entry) => entry.isDirectory() && (
      entry.name === encodedScope || (encodedBase.length > 1 && entry.name.endsWith(`-${encodedBase}`))
    ))
    .map((entry) => path.join(projectsRoot, entry.name))

  let unreadableDirs = 0
  const candidates = []
  for (const dir of matchedDirs) {
    let files
    try {
      files = await readdir(dir, { withFileTypes: true })
    } catch {
      unreadableDirs += 1
      continue
    }
    for (const file of files) {
      if (file.isFile() && file.name.endsWith(TRANSCRIPT_EXTENSION)) candidates.push(path.join(dir, file.name))
    }
  }

  const listLimit = Math.min(500, Math.max(1, Number(process.env.TELEMETRY_LIST_LIMIT || 200) || 200))
  let unreadableFiles = 0
  const statted = []
  for (const file of candidates) {
    try {
      statted.push({ file, stats: await stat(file) })
    } catch {
      unreadableFiles += 1
    }
  }
  // Freshest transcripts first, capped by the same finite list limit the other
  // adapters use, so this is never an unbounded scanner.
  statted.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)
  const selected = statted.slice(0, listLimit)

  const retentionMinutes = Number(process.env.TELEMETRY_RETENTION_MINUTES || 10_080)
  const cutoff = Date.now() - retentionMinutes * 60_000

  let oversizedFiles = 0
  const parsed = await mapLimit(selected, READ_CONCURRENCY, async (item) => {
    if (item.stats.size > MAX_FILE_BYTES) return { ...item, meta: null, oversized: true }
    try {
      return { ...item, meta: await readCached(item.file, item.stats) }
    } catch {
      return { ...item, meta: null, unreadable: true }
    }
  })

  let malformedLines = 0
  let readFailures = 0
  let skippedCwd = 0
  const records = []
  for (const item of parsed) {
    if (item.oversized) { oversizedFiles += 1; continue }
    if (!item.meta || item.unreadable) { readFailures += 1; continue }
    const meta = item.meta
    malformedLines += meta.malformed
    // A file with no real user or assistant turn is not a chat: system, mode or
    // cost-only records are skipped rather than shown as a session.
    if (meta.userTurns === 0 && meta.assistantTurns === 0) continue
    // The transcript's cwd must prove it belongs to the scope or one of its
    // matching-basename worktrees; an unrelated same-named project is skipped.
    if (!cwdMatchesScope(meta.cwd, scope)) { skippedCwd += 1; continue }
    const updatedMs = meta.lastAt ?? item.stats.mtimeMs
    if (updatedMs < cutoff) continue

    const sessionId = meta.sessionId || path.basename(item.file, TRANSCRIPT_EXTENSION)
    const model = meta.models.size > 0 ? [...meta.models].join(', ') : 'unavailable'
    const slug = slugFor(meta.cwd, scope)
    records.push({
      id: `${PROVIDER}:${sessionId}`,
      provider: PROVIDER,
      model,
      title: safeActivity(`${slug} · ${sessionId.slice(0, 8)}`, `Claude Code ${sessionId.slice(-6)}`),
      // A local transcript proves a past conversation, not a running process, so
      // the status is left unknown rather than inferred as active.
      status: 'unknown',
      activity: 'Persisted session metadata; live Claude Code runtime status is not available to this connector',
      updatedAt: isoTime(updatedMs),
      role: 'Claude Code session · local transcript metadata',
      district: 'great-hall',
    })
  }

  // Keep the cache bounded to the files this scan considered.
  const candidateSet = new Set(candidates)
  for (const key of parseCache.keys()) if (!candidateSet.has(key)) parseCache.delete(key)

  const limitations = []
  if (unreadableDirs > 0) limitations.push(`${unreadableDirs} project director${unreadableDirs === 1 ? 'y' : 'ies'} could not be read.`)
  if (unreadableFiles > 0) limitations.push(`${unreadableFiles} transcript file${unreadableFiles === 1 ? '' : 's'} could not be inspected.`)
  if (oversizedFiles > 0) limitations.push(`${oversizedFiles} transcript file${oversizedFiles === 1 ? '' : 's'} exceeded the bounded read size and ${oversizedFiles === 1 ? 'was' : 'were'} skipped.`)
  if (readFailures > 0) limitations.push(`${readFailures} transcript file${readFailures === 1 ? '' : 's'} could not be parsed.`)
  if (skippedCwd > 0) limitations.push(`${skippedCwd} transcript file${skippedCwd === 1 ? '' : 's'} did not report a working directory inside the scoped project and ${skippedCwd === 1 ? 'was' : 'were'} skipped.`)
  if (malformedLines > 0) limitations.push(`${malformedLines} malformed transcript line${malformedLines === 1 ? '' : 's'} were skipped.`)
  const limited = limitations.length > 0

  return {
    connected: true,
    limited,
    message: limited
      ? `${records.length} local session metadata record${records.length === 1 ? '' : 's'} read; ${limitations.join(' ')}`
      : `${records.length} local session metadata record${records.length === 1 ? '' : 's'} read from the scoped Claude Code project.`,
    records,
    diagnostic: {
      provider: PROVIDER,
      state: limited ? 'limited' : 'connected',
      adapter: 'Claude Code local session metadata',
      endpoint: '~/.claude/projects/<scoped>/*.jsonl',
      recordsReceived: records.length,
      lastSuccessfulRefresh: startedAt,
      limitation: limitations.length > 0 ? limitations.join(' ') : undefined,
    },
  }
}
