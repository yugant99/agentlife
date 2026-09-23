import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { classifyFailure, isoTime, normalizeStatus, safeActivity } from '../safety.mjs'

function runAppServer(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CODEX_BIN || 'codex', ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'], env: process.env,
    })
    const lines = readline.createInterface({ input: child.stdout })
    const pending = new Map()
    let nextId = 2
    let closed = false

    const finish = (error, value) => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      lines.close()
      child.kill('SIGTERM')
      if (error) reject(error)
      else resolve(value)
    }
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
    const call = (method, params) => new Promise((resolveCall, rejectCall) => {
      const id = nextId++
      pending.set(id, { resolve: resolveCall, reject: rejectCall })
      send({ method, id, params })
    })
    const timer = setTimeout(() => {
      const timeout = new Error('Codex app-server read timed out')
      timeout.code = 'ETIMEDOUT'
      finish(timeout)
    }, 6000)

    // Drain stderr so the pipe cannot back up, but never store or surface its content.
    child.stderr.on('data', () => {})
    // A write to a closed child pipe must go through the idempotent finish path so an
    // EPIPE cannot surface as an unhandled process error.
    child.stdin.on('error', (error) => finish(error))
    child.on('error', (error) => finish(error))
    child.on('exit', () => {
      // Any exit before completion, including code 0, fails the read immediately
      // instead of leaving it to the timeout.
      if (!closed) finish(new Error('Codex app-server exited before completing the read'))
    })
    lines.on('line', async (line) => {
      let message
      try { message = JSON.parse(line) } catch { return }
      if (message.id === 1) {
        if (message.error) return finish(new Error('Codex initialization was refused'))
        send({ method: 'initialized', params: {} })
        try {
          const results = []
          for (const request of requests) results.push(await call(request.method, request.params))
          return finish(null, results)
        } catch (error) { return finish(error) }
      }
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error('Codex protocol read failed'))
      else waiter.resolve(message.result)
    })

    send({
      method: 'initialize', id: 1, params: {
        clientInfo: { name: 'mythic-agent-command-center', title: 'Mythic Agent Command Center', version: '0.2.0' },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: [
            'item/agentMessage/delta', 'item/reasoning/textDelta', 'item/commandExecution/outputDelta',
            'item/fileChange/outputDelta', 'item/mcpToolCall/progress',
          ],
        },
      },
    })
  })
}

// District routing keys off the title and the agent role only, so each hall is grounded
// in what the provider actually reported. Anything unmatched stays in the Great Hall
// rather than being assigned at random.
function districtFor(title = '', role = '') {
  const text = `${title} ${role}`.toLowerCase()
  if (text.includes('qa') || text.includes('test') || text.includes('luna')) return 'proving-grounds'
  if (text.includes('review') || text.includes('challenge') || text.includes('grok')) return 'watchtower'
  if (text.includes('portability') || text.includes('spencer')) return 'dock'
  if (text.includes('fable') || text.includes('oracle') || text.includes('advisory')) return 'oracle'
  if (text.includes('evidence') || text.includes('audit') || text.includes('scribe') || text.includes('account')) return 'scribe-hall'
  if (text.includes('build') || text.includes('implement') || text.includes('terra') || text.includes('sol')) return 'forge'
  return 'great-hall'
}

function statusType(thread) {
  return (typeof thread.status === 'string' ? thread.status : thread.status?.type) || 'notLoaded'
}

export async function readCodex() {
  const startedAt = new Date().toISOString()
  const leadId = process.env.COMMAND_CENTER_LEAD_THREAD_ID
  const cwd = process.env.COMMAND_CENTER_SCOPE_CWD
  // A finite list limit keeps this a bounded single-page read. It is high enough to
  // reach the retained history without building an unbounded scanner, and the
  // provider-side updatedAt filter below — not this cap — decides what is retained.
  const listLimit = Math.min(500, Math.max(1, Number(process.env.TELEMETRY_LIST_LIMIT || 200) || 200))
  const requests = [{
    method: 'thread/list',
    params: { limit: listLimit, sortKey: 'updated_at', sortDirection: 'desc', ...(cwd ? { cwd } : {}) },
  }]
  if (leadId) requests.push({ method: 'thread/list', params: { limit: listLimit, ancestorThreadId: leadId, sourceKinds: [] } })

  try {
    const results = await runAppServer(requests)
    const listed = results.flatMap((result) => result?.data || [])
    // Retention is wider than the freshness window so older sessions survive; the
    // client decides which of them are historical.
    const retentionMinutes = Number(process.env.TELEMETRY_RETENTION_MINUTES || 10_080)
    const cutoffSeconds = Math.floor((Date.now() - retentionMinutes * 60_000) / 1000)
    const selected = listed.filter((thread) => thread.id === leadId || thread.sessionId === leadId || Number(thread.updatedAt || 0) >= cutoffSeconds)
    const unique = [...new Map(selected.map((thread) => [thread.id, thread])).values()]
    const records = unique.map((thread) => {
      const runtime = statusType(thread)
      const isLead = thread.id === leadId
      // Only an explicit parent field is treated as a supervisory parent. Fork
      // provenance and shared session identifiers are not parent evidence.
      const parent = typeof thread.parentThreadId === 'string' && thread.parentThreadId ? thread.parentThreadId : undefined
      return {
        id: `codex:${thread.id}`,
        parentId: parent ? `codex:${parent}` : undefined,
        provider: 'codex',
        model: thread.model || `${thread.modelProvider || 'openai'}/model-unavailable`,
        title: safeActivity(thread.name, `Codex ${String(thread.id).slice(-6)}`),
        status: runtime === 'notLoaded' ? 'unknown' : normalizeStatus(runtime),
        activity: runtime === 'notLoaded'
          ? 'Persisted thread found; desktop runtime status is not available to this connector'
          : `Codex runtime reports ${runtime}`,
        updatedAt: isoTime(thread.updatedAt || thread.createdAt),
        branch: safeActivity(thread.gitInfo?.branch, undefined),
        role: isLead ? 'Configured main lead · persisted metadata' : parent ? 'Codex child thread' : 'Codex thread · parent not reported',
        district: districtFor(thread.name, thread.agentRole),
      }
    })
    const limited = records.some((record) => record.activity.startsWith('Persisted thread'))
    return {
      connected: true,
      limited,
      message: limited ? `${records.length} persisted thread records read; desktop live status is unavailable.` : `${records.length} live thread metadata records read.`,
      records,
      diagnostic: {
        provider: 'codex', state: limited ? 'limited' : 'connected', adapter: 'Official Codex app-server JSONL',
        endpoint: 'stdio://codex app-server', recordsReceived: records.length, lastSuccessfulRefresh: startedAt,
        limitation: limited ? 'A separate app-server can read persisted threads, but the desktop active-state control socket is unavailable.' : undefined,
      },
    }
  } catch (error) {
    return {
      connected: false, limited: false, message: 'Codex app-server discovery failed.', records: [],
      diagnostic: {
        provider: 'codex', state: 'error', adapter: 'Official Codex app-server JSONL',
        endpoint: 'stdio://codex app-server', recordsReceived: 0, failureReason: classifyFailure(error),
      },
    }
  }
}
