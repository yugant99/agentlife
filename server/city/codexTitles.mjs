// Codex thread titles for the city feed (plan 002, Lane A).
//
// Keeps the existing app-server `thread/list` read, titles only. Timeout is
// 25 s (a measured read of 40 threads took about 11 s against the old 6 s
// timeout) and results are cached for 60 s. A title failure never fails the
// city snapshot; names fall back to a short synthetic label.

import { spawn } from 'node:child_process'
import readline from 'node:readline'

const TITLE_CACHE_TTL_MS = 60_000
let titleCache = { expiresAt: 0, titles: new Map() }

function runThreadList() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CODEX_BIN || 'codex', ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
    const lines = readline.createInterface({ input: child.stdout })
    let nextId = 2
    let closed = false
    const pending = new Map()

    const finish = (error, value) => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      lines.close()
      child.kill('SIGTERM')
      if (error) reject(error)
      else resolve(value)
    }
    const send = (message) => {
      try { child.stdin.write(`${JSON.stringify(message)}\n`) } catch (error) { finish(error) }
    }
    const call = (method, params) => new Promise((resolveCall, rejectCall) => {
      const id = nextId++
      pending.set(id, { resolve: resolveCall, reject: rejectCall })
      send({ method, id, params })
    })
    const timer = setTimeout(() => {
      const timeout = new Error('Codex titles read timed out')
      timeout.code = 'ETIMEDOUT'
      finish(timeout)
    }, 25_000)

    child.stderr.on('data', () => {})
    child.stdin.on('error', (error) => finish(error))
    child.on('error', (error) => finish(error))
    child.on('exit', () => {
      if (!closed) finish(new Error('Codex app-server exited before completing the read'))
    })
    lines.on('line', async (line) => {
      let message
      try { message = JSON.parse(line) } catch { return }
      if (message.id === 1) {
        if (message.error) return finish(new Error('Codex initialization was refused'))
        send({ method: 'initialized', params: {} })
        try {
          const cwd = process.env.COMMAND_CENTER_SCOPE_CWD
          const listLimit = Math.min(500, Math.max(1, Number(process.env.TELEMETRY_LIST_LIMIT || 200) || 200))
          const result = await call('thread/list', {
            limit: listLimit,
            sortKey: 'updated_at',
            sortDirection: 'desc',
            ...(cwd ? { cwd } : {}),
          })
          return finish(null, result)
        } catch (error) { return finish(error) }
      }
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error('Codex protocol read failed'))
      else waiter.resolve(message.result)
    })

    send({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: { name: 'mythic-city-feed', title: 'Mythic City Feed', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      },
    })
  })
}

/** Thread id -> title. Pure helper for tests. */
export function titlesFromList(data) {
  const map = new Map()
  const rows = Array.isArray(data) ? data : data?.data ?? []
  for (const thread of rows) {
    if (!thread || typeof thread !== 'object') continue
    const id = typeof thread.id === 'string' ? thread.id : null
    if (!id) continue
    const title = typeof thread.name === 'string' && thread.name.trim() ? thread.name.trim() : null
    if (title) map.set(id, title)
  }
  return map
}

/** Cached thread titles; empty on failure so names fall back. */
export async function getCodexThreadTitles() {
  const now = Date.now()
  if (titleCache.expiresAt > now) return titleCache.titles
  try {
    const result = await runThreadList()
    const titles = titlesFromList(result)
    titleCache = { expiresAt: now + TITLE_CACHE_TTL_MS, titles }
    return titles
  } catch {
    // Serve a stale cache once rather than failing the snapshot.
    if (titleCache.titles.size > 0) return titleCache.titles
    return new Map()
  }
}
