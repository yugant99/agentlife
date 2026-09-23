import { createServer } from 'node:http'
import { readCodex } from './adapters/codex.mjs'
import { readClaudeCode } from './adapters/claude.mjs'
import { readOpenCode, streamOpenCodeEvents } from './adapters/opencode.mjs'
import { classifyFailure } from './safety.mjs'

try { process.loadEnvFile?.() } catch (error) {
  if (error?.code !== 'ENOENT') process.stderr.write('Could not load local .env configuration.\n')
}

const host = '127.0.0.1'
const port = Number(process.env.TELEMETRY_PORT || 4174)

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

async function buildSnapshot() {
  const results = await Promise.allSettled([readCodex(), readOpenCode(), readClaudeCode()])
  const names = ['codex', 'opencode', 'claude-code']
  const providers = {}
  const diagnostics = []
  const records = []
  let successes = 0
  let limitedProviders = 0
  let errorProviders = 0
  let disconnectedProviders = 0

  results.forEach((result, index) => {
    const name = names[index]
    if (result.status === 'fulfilled') {
      const value = result.value
      const state = value.diagnostic?.state ?? (value.connected ? 'connected' : 'error')
      providers[name] = { connected: value.connected, message: value.message }
      // Preserve records from any provider that succeeded, even when a peer failed.
      records.push(...value.records)
      diagnostics.push(value.diagnostic)
      if (state === 'error') errorProviders += 1
      else if (state === 'disconnected') disconnectedProviders += 1
      else {
        successes += 1
        if (state === 'limited') limitedProviders += 1
      }
    } else {
      errorProviders += 1
      providers[name] = { connected: false, message: 'Provider read failed.' }
      diagnostics.push({
        provider: name, state: 'error', adapter: 'Unknown', endpoint: 'unavailable',
        recordsReceived: 0, failureReason: classifyFailure(result.reason),
      })
    }
  })

  // Aggregate state is derived from the per-provider diagnostic states, not from a
  // connection flag alone. A successful empty read is still a valid snapshot.
  const unavailable = errorProviders + disconnectedProviders
  const mode = successes > 0
    ? (unavailable > 0 || limitedProviders > 0 ? 'partial' : 'live')
    : errorProviders > 0
      ? 'error'
      : 'disconnected'

  const message = mode === 'live'
    ? 'Local read-only metadata snapshot.'
    : mode === 'partial'
      ? 'Real records loaded with a connector limitation or an unavailable provider shown below.'
      : mode === 'error'
        ? 'A provider could not be read.'
        : 'No local providers were discovered.'

  return { mode, records, providers, diagnostics, fetchedAt: new Date().toISOString(), message }
}

// Coalesce simultaneous reads around one in-flight snapshot so client retries and
// event bursts cannot multiply provider CLI processes.
let inFlightSnapshot = null
function snapshot() {
  if (inFlightSnapshot) return inFlightSnapshot
  const promise = buildSnapshot()
  inFlightSnapshot = promise
  const release = () => { if (inFlightSnapshot === promise) inFlightSnapshot = null }
  promise.then(release, release)
  return promise
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${host}:${port}`)
  if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { ok: true, readOnly: true })
  if (request.method === 'GET' && url.pathname === '/api/telemetry') {
    try { return json(response, 200, await snapshot()) }
    catch { return json(response, 500, { mode: 'error', records: [], message: 'Telemetry read failed.' }) }
  }
  if (request.method === 'GET' && url.pathname === '/api/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    response.write('event: ready\ndata: {}\n\n')
    const controller = new AbortController()
    // IncomingMessage 'close' now means the request has been fully received, not that
    // the response disconnected, so tie the subscription to the response lifecycle.
    const abort = () => controller.abort()
    response.on('close', abort)
    // The client may already be gone by the time the handler runs.
    if (response.destroyed || response.writableEnded) controller.abort()
    const canWrite = () => !controller.signal.aborted && !response.destroyed && !response.writableEnded
    try {
      const connected = await streamOpenCodeEvents(response, controller.signal)
      if (!connected && canWrite()) response.write('event: unavailable\ndata: {}\n\n')
    } catch {
      if (canWrite()) response.write('event: unavailable\ndata: {}\n\n')
    }
    response.off('close', abort)
    if (canWrite()) response.end()
    return
  }
  json(response, 404, { error: 'Not found' })
})

server.listen(port, host, () => {
  process.stdout.write(`Telemetry proxy listening on http://${host}:${port}\n`)
})
