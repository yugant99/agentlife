import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { classifyFailure, isoTime, normalizeStatus, safeActivity } from '../safety.mjs'

const execFileAsync = promisify(execFile)

// Child discovery is bounded in both breadth and concurrency: an unbounded
// Promise.all over every root session can spawn a CLI process per root and, on a
// large project, overrun the client's 15-second poll. Roots themselves are always
// retained; only the child read is capped, and a cap is reported as a limitation.
const CHILD_READ_LIMIT = 64
const CHILD_READ_CONCURRENCY = 4
// Child listings change far more slowly than the 15-second client poll, so a short
// cache keyed by parent id and the parent's updated timestamp avoids respawning up
// to 64 CLI processes on every poll. A changed parent timestamp, an expired entry,
// or any failed read is never served from the cache.
const CHILD_CACHE_TTL_MS = 60_000
const childCache = new Map()

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

async function operation(name, params = {}) {
  const args = ['api', name]
  for (const [key, value] of Object.entries(params)) args.push('--param', `${key}=${value}`)
  const { stdout } = await execFileAsync(process.env.OPENCODE_BIN || 'opencode', args, {
    timeout: 4500,
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  })
  const payload = JSON.parse(stdout)
  return payload.data || payload.result?.data || []
}

function getModel(session) {
  const model = session.model
  if (typeof model === 'string') return model
  if (model && typeof model === 'object') {
    const base = [model.providerID || model.provider, model.id || model.modelID].filter(Boolean).join('/')
    return model.variant ? `${base}#${model.variant}` : base
  }
  return 'unavailable'
}

function districtFor(title = '', model = '') {
  const text = `${title} ${model}`.toLowerCase()
  if (text.includes('terra') || text.includes('deepseek') || text.includes('sol')) return 'forge'
  if (text.includes('grok') || text.includes('challenge') || text.includes('review')) return 'watchtower'
  if (text.includes('luna') || text.includes('qa') || text.includes('test')) return 'proving-grounds'
  if (text.includes('fable') || text.includes('oracle') || text.includes('advisory')) return 'oracle'
  if (text.includes('spencer') || text.includes('portability')) return 'dock'
  if (text.includes('evidence') || text.includes('audit') || text.includes('scribe')) return 'scribe-hall'
  if (text.includes('build') || text.includes('implement')) return 'forge'
  return 'great-hall'
}

function statusFor(session) {
  if (session.outcome === 'failed') return 'failed'
  if (session.outcome === 'succeeded') return 'complete'
  if (session.outcome === 'cancelled') return 'waiting'
  if (session.time?.idle) return 'waiting'
  // Only affirmative provider metadata may produce an active state. A missing or
  // unrecognized status stays unknown instead of being assumed to be running.
  return normalizeStatus(session.status)
}

function activityFor(session, status) {
  if (session.outcome === 'failed') return 'Session ended with a reported failure'
  if (session.outcome === 'succeeded') return 'Session completed successfully'
  if (session.outcome === 'cancelled') return 'Session was cancelled'
  if (session.time?.idle) return 'Session is idle'
  switch (status) {
    case 'active': return 'Session is running'
    case 'review': return 'Session is in review'
    case 'needs-input': return 'Session needs input'
    case 'waiting': return 'Session is waiting'
    case 'failed': return 'Session reported a failure'
    case 'complete': return 'Session completed'
    default: return 'Session status is not available from the connector'
  }
}

function inScope(session) {
  const scope = process.env.COMMAND_CENTER_SCOPE_CWD
  if (!scope) return true
  const directory = session.location?.directory || session.directory || ''
  return directory === scope || path.basename(directory) === path.basename(scope)
}

export async function readOpenCode() {
  const startedAt = new Date().toISOString()
  const scope = process.env.COMMAND_CENTER_SCOPE_CWD
  try {
    // The unscoped session listing can exceed the CLI's output handling on a busy
    // machine, so a configured scope is pushed down as a directory filter. This is
    // the same authenticated read operation, only narrower. Without a scope the
    // read stays as before and any truncated payload surfaces as an error below.
    const sessions = await operation('session.list', scope ? { directory: scope } : {})
    // Retention is wider than the client's freshness window so a project's older
    // sessions still appear; the client marks them historical.
    const retentionMinutes = Number(process.env.TELEMETRY_RETENTION_MINUTES || 10_080)
    const cutoff = Date.now() - retentionMinutes * 60_000
    const roots = sessions
      .filter((session) => inScope(session) && Number(session.time?.updated || 0) >= cutoff)
      .sort((a, b) => Number(b.time?.updated || 0) - Number(a.time?.updated || 0))
    const childRoots = roots.slice(0, CHILD_READ_LIMIT)
    const skippedChildRoots = roots.length - childRoots.length
    let failedChildReads = 0
    const now = Date.now()
    const childBatches = await mapLimit(childRoots, CHILD_READ_CONCURRENCY, async (session) => {
      const key = String(session.id)
      const stamp = Number(session.time?.updated || 0)
      const cached = childCache.get(key)
      if (cached && cached.stamp === stamp && cached.expiresAt > now) return cached.children
      try {
        // The directory filter is passed to the child read as well, so a child
        // listing can never grow back into the oversized unscoped read.
        const children = await operation('session.list', scope
          ? { parentID: session.id, directory: scope }
          : { parentID: session.id })
        childCache.set(key, { stamp, expiresAt: Date.now() + CHILD_CACHE_TTL_MS, children })
        return children
      } catch {
        failedChildReads += 1
        // A failed read is never cached, so a transient failure is retried on the
        // next poll instead of being hidden behind a stale success.
        childCache.delete(key)
        // A failed child read never removes its parent root from the inventory.
        return []
      }
    })
    // Drop cached children for roots that are no longer in scope.
    const liveRootIds = new Set(roots.map((session) => String(session.id)))
    for (const key of childCache.keys()) if (!liveRootIds.has(key)) childCache.delete(key)
    const unique = [...new Map([...roots, ...childBatches.flat()].map((session) => [session.id, session])).values()]
      .filter((session) => inScope(session))

    const records = unique.map((session) => {
      const model = getModel(session)
      const status = statusFor(session)
      return {
        id: `opencode:${session.id}`,
        parentId: session.parentID ? `opencode:${session.parentID}` : undefined,
        provider: 'opencode',
        model,
        title: safeActivity(session.title, `OpenCode ${String(session.id).slice(-6)}`),
        status,
        activity: activityFor(session, status),
        updatedAt: isoTime(session.time?.updated || session.time?.created),
        usage: session.tokens ? {
          inputTokens: session.tokens.input,
          outputTokens: session.tokens.output,
          cachedInputTokens: session.tokens.cache?.read,
        } : undefined,
        role: session.parentID ? 'OpenCode child session' : 'OpenCode session · parent not reported',
        district: districtFor(session.title, model),
      }
    })

    const limitations = []
    if (failedChildReads > 0) limitations.push(`${failedChildReads} child session read${failedChildReads === 1 ? '' : 's'} failed; the child inventory may be incomplete.`)
    if (skippedChildRoots > 0) limitations.push(`${skippedChildRoots} root session${skippedChildRoots === 1 ? '' : 's'} were not checked for children because the bounded child-read cap was reached.`)
    limitations.push('Subscription allowance is not exposed; no quota is estimated.')
    const limited = failedChildReads > 0 || skippedChildRoots > 0

    return {
      connected: true,
      limited,
      message: limited
        ? `${records.length} session metadata records read; ${limitations[0]}`
        : `${records.length} current session metadata records read through the authenticated CLI.`,
      records,
      diagnostic: {
        provider: 'opencode', state: limited ? 'limited' : 'connected', adapter: 'OpenCode CLI read operations',
        endpoint: 'opencode api session.list', recordsReceived: records.length, lastSuccessfulRefresh: startedAt,
        limitation: limitations.join(' '),
      },
    }
  } catch (error) {
    return {
      connected: false, limited: false, message: 'OpenCode CLI discovery failed.', records: [],
      diagnostic: {
        provider: 'opencode', state: 'error', adapter: 'OpenCode CLI read operations',
        endpoint: 'opencode api session.list', recordsReceived: 0, failureReason: classifyFailure(error),
      },
    }
  }
}

const SAFE_EVENTS = new Set([
  'session.status', 'session.idle', 'session.error', 'session.updated',
  'message.updated', 'todo.updated', 'tool.execute.before', 'tool.execute.after',
])

// An indefinite subscription must not be read through a buffered execFile: Node
// terminates a child once maxBuffer is exceeded. Bound the pending line instead and
// end the stream into the existing unavailable/reconnect path on an oversized or
// malformed frame, so no unbounded data or raw payload is ever retained or forwarded.
const MAX_EVENT_LINE_BYTES = 64 * 1024

export function streamOpenCodeEvents(response, signal) {
  return new Promise((resolve) => {
    // An already-aborted signal must not launch a child process.
    if (signal?.aborted) { resolve(false); return }

    let settled = false
    let buffer = ''

    let child = null
    try {
      child = spawn(process.env.OPENCODE_BIN || 'opencode', ['api', 'event.subscribe'], {
        stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
      })
    } catch {
      resolve(false)
      return
    }
    if (!child) { resolve(false); return }

    const finish = () => {
      if (settled) return
      settled = true
      if (signal) signal.removeEventListener('abort', onAbort)
      child.stdout?.off('data', onStdout)
      child.stderr?.off('data', onStderr)
      child.off('exit', onExit)
      buffer = ''
      // Only ever terminate the child this stream created.
      if (!child.killed && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      resolve(false)
    }

    const onAbort = () => finish()
    const onStderr = () => {}
    const onExit = () => finish()
    const onError = () => finish()
    const onStdout = (chunk) => {
      if (settled) return
      buffer += chunk
      let newline
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_LINE_BYTES) { finish(); return }
        if (!line.trim()) continue
        let event
        try {
          event = JSON.parse(line)
        } catch {
          // A malformed frame ends the stream; never forward raw content.
          finish()
          return
        }
        if (!event || typeof event !== 'object' || Array.isArray(event)) { finish(); return }
        const type = event.type || event.data?.type
        if (SAFE_EVENTS.has(type)) {
          if (response.destroyed || response.writableEnded) { finish(); return }
          try { response.write(`event: refresh\ndata: ${JSON.stringify({ type })}\n\n`) }
          catch { finish(); return }
        }
      }
      if (Buffer.byteLength(buffer, 'utf8') > MAX_EVENT_LINE_BYTES) finish()
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', onStdout)
    child.stdout?.on('error', onError)
    child.stderr?.on('data', onStderr)
    child.stderr?.on('error', onError)
    child.on('exit', onExit)
    child.on('error', onError)
    // Keep error listeners until the pipes have closed, including errors during kill.
    child.once('close', () => {
      child.off('error', onError)
      child.stdout?.off('error', onError)
      child.stderr?.off('error', onError)
    })
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    // The signal may have aborted between the initial check and this registration.
    if (signal?.aborted) finish()
  })
}
