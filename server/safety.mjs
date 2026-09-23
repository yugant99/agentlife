export function requireLoopback(value, label) {
  if (!value) return null
  const url = new URL(value)
  const allowed = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
  if (!allowed.has(url.hostname)) {
    throw new Error(`${label} must use a localhost URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTP or HTTPS`)
  }
  return url
}

export function safeActivity(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 120)
}

// Explicit allowlist of concrete statuses used by the application plus a few
// straightforward provider spellings. Generic lifecycle words (done, closed,
// finished, success, queued, paused, stopped, inactive) are deliberately absent:
// they do not prove task completion or current activity. Anything not listed
// stays `unknown`; nothing is inferred from substrings or recency.
const STATUS_ALIASES = new Map([
  ['active', 'active'],
  ['running', 'active'],
  ['busy', 'active'],
  ['working', 'active'],
  ['inprogress', 'active'],
  ['in-progress', 'active'],
  ['in_progress', 'active'],

  ['waiting', 'waiting'],
  ['idle', 'waiting'],

  ['complete', 'complete'],
  ['completed', 'complete'],
  ['succeeded', 'complete'],

  ['review', 'review'],

  ['failed', 'failed'],
  ['error', 'failed'],

  ['needs-input', 'needs-input'],
  ['needs_input', 'needs-input'],
  ['needsinput', 'needs-input'],
  ['blocked', 'needs-input'],

  ['unknown', 'unknown'],
  ['unavailable', 'unknown'],
  ['notloaded', 'unknown'],
  ['not_loaded', 'unknown'],
  ['not-loaded', 'unknown'],
])

export function normalizeStatus(value) {
  const status = String(value ?? '').trim().toLowerCase()
  return STATUS_ALIASES.get(status) ?? 'unknown'
}

// Fixed, allowlisted failure categories for the browser. Raw CLI stderr, protocol
// payloads and Node error text must never cross the loopback boundary. Only an
// explicit code counts: a process signal is not treated as a timeout.
export function classifyFailure(error) {
  if (error && typeof error === 'object') {
    if (error.code === 'ENOENT') return 'executable unavailable'
    if (error.code === 'ETIMEDOUT') return 'timeout'
  }
  return 'read failed'
}

export function isoTime(value) {
  if (!value) return new Date().toISOString()
  const numeric = Number(value)
  const date = Number.isFinite(numeric) ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric) : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}
