import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { hookOverride, parseClaudeTranscript, parseHookEvents, parseSubagentMeta } from './claude.mjs'

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

test('pending tool_use without tool_result is phase tool', async () => {
  const text = await fixture('claude-pending.jsonl')
  const parsed = parseClaudeTranscript(text)
  assert.equal(parsed.sessionId, 'claude-demo-1')
  assert.equal(parsed.cwd, '/work/city-demo')
  assert.equal(parsed.workState, 'active')
  assert.equal(parsed.phase, 'tool')
  // Bash npm test classifies to test inside the server.
  assert.equal(parsed.toolKind, 'test')
})

test('completed tool_use resolves to a gap, never frozen', async () => {
  const text = await fixture('claude-done.jsonl')
  const parsed = parseClaudeTranscript(text)
  assert.equal(parsed.phase, 'gap')
  assert.equal(parsed.workState, 'active')
  assert.equal(parsed.toolKind, 'read')
})

test('custom-title becomes the name; prompt text is never retained', async () => {
  const text = await fixture('claude-title.jsonl')
  const parsed = parseClaudeTranscript(text)
  assert.equal(parsed.customTitle, 'Harbor survey')
  assert.equal(parsed.phase, 'talking')
  assert.equal(parsed.workState, 'active')
  const serialized = JSON.stringify(parsed)
  assert.equal(serialized.includes('synthetic prompt body'), false)
  assert.equal(serialized.includes('synthetic reply body'), false)
})

test('AskUserQuestion maps to needs-input', () => {
  const text = [
    '{"type":"assistant","sessionId":"s","cwd":"/work/city-demo","message":{"content":[{"type":"tool_use","id":"t","name":"AskUserQuestion","input":{}}]}}',
  ].join('\n')
  const parsed = parseClaudeTranscript(text)
  assert.equal(parsed.workState, 'needs-input')
  assert.equal(parsed.toolKind, 'ask')
})

test('sub-agent meta links parent, keeps type, drops description', async () => {
  const metaText = await fixture('claude-subagent.meta.json')
  const meta = parseSubagentMeta(metaText)
  assert.equal(meta.agentType, 'Explore')
  assert.equal(meta.spawnDepth, 1)
  assert.equal('description' in meta, false)

  const transcript = await fixture('claude-subagent.jsonl')
  const parsed = parseClaudeTranscript(transcript)
  assert.equal(parsed.phase, 'tool')
  assert.equal(parsed.toolKind, 'search')
  assert.equal(JSON.stringify(parsed).includes('SECRET-DESCRIPTION-MUST-NOT-LEAK'), false)
})

test('hook events win: Notification needs-input, Stop waiting', async () => {
  const text = await fixture('hook-events.jsonl')
  const events = parseHookEvents(text)
  // Malformed and session-less lines are skipped; three valid sessions remain.
  assert.equal(events.size, 3)
  assert.deepEqual(hookOverride(events.get('claude-demo-9')), { workState: 'needs-input', phase: 'idle', toolKind: 'ask' })
  assert.deepEqual(hookOverride(events.get('claude-demo-10')), { workState: 'waiting', phase: 'idle', toolKind: undefined })
  const pre = hookOverride(events.get('claude-demo-1'))
  assert.equal(pre.workState, 'active')
  assert.equal(pre.phase, 'tool')
  assert.equal(hookOverride(null), null)
})
