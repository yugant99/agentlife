#!/usr/bin/env node
// Claude Code hook for Mythic City (plan 002, Lane A).
//
// Appends exact session states to `~/.mythic/claude-events.jsonl`:
//   {session_id, hook_event_name, tool_name, ts}
// When hook events exist they win over transcript inference:
// Notification (permission request) -> needs-input, Stop -> waiting.
//
// Installing this hook is the user's decision. Do NOT edit the user's
// `~/.claude/settings.json` for them; share this snippet instead:
//
// {
//   "hooks": {
//     "PreToolUse": [
//       { "matcher": ".*", "hooks": [{ "type": "command", "command": "node /absolute/path/to/scripts/claude-hook.mjs" }] }
//     ],
//     "PostToolUse": [
//       { "matcher": ".*", "hooks": [{ "type": "command", "command": "node /absolute/path/to/scripts/claude-hook.mjs" }] }
//     ],
//     "Notification": [
//       { "hooks": [{ "type": "command", "command": "node /absolute/path/to/scripts/claude-hook.mjs" }] }
//     ],
//     "Stop": [
//       { "hooks": [{ "type": "command", "command": "node /absolute/path/to/scripts/claude-hook.mjs" }] }
//     ]
//   }
// }
//
// Only the four allowlisted fields above are stored. Tool input, prompts,
// messages and output are never read or written.

import { appendFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function readStdinBounded(maxBytes = 64 * 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of process.stdin) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (total > maxBytes) break
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

try {
  const raw = await readStdinBounded()
  let payload = null
  try { payload = raw ? JSON.parse(raw) : null } catch { payload = null }
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}

  // Accept both snake_case (documented hook payload) and camelCase variants.
  const sessionId = firstString(record.session_id, record.sessionId)
  const hookEvent = firstString(record.hook_event_name, record.hookEventName)
  const toolName = firstString(record.tool_name, record.toolName)
  if (sessionId && hookEvent) {
    const ts = Date.now()
    const line = JSON.stringify({ session_id: sessionId.slice(0, 160), hook_event_name: hookEvent.slice(0, 80), tool_name: toolName.slice(0, 80), ts })
    const dir = path.join(os.homedir(), '.mythic')
    await mkdir(dir, { recursive: true })
    await appendFile(path.join(dir, 'claude-events.jsonl'), `${line}\n`, 'utf8')
  }
} catch {
  // Hooks must never block the agent; swallow all errors.
}
process.exit(0)
