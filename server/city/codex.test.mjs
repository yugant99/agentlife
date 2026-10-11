import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isApprovalEvent, parseCodexMeta, parseCodexTail } from './codex.mjs'

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

function metaAndTail(text, fallbackId) {
  const [firstLine, ...rest] = text.split('\n')
  return { meta: parseCodexMeta(firstLine, fallbackId), tail: parseCodexTail(rest.join('\n')) }
}

test('session_meta yields id/cwd, parent only when explicit', async () => {
  const active = await fixture('codex-active.jsonl')
  const { meta } = metaAndTail(active, 'fallback')
  assert.equal(meta.id, 'codex-demo-1')
  assert.equal(meta.cwd, '/work/city-demo')
  assert.equal(meta.parentId, null)

  const ship = await fixture('codex-ship.jsonl')
  const shipMeta = metaAndTail(ship, 'fallback').meta
  assert.equal(shipMeta.parentId, 'codex-demo-1')

  // Never infer a parent from filenames or ordering.
  assert.equal(parseCodexMeta('{"id":"x","cwd":"/work/city-demo"}', '').parentId, null)
  assert.equal(parseCodexMeta('not json', 'fallback'), null)
})

test('active tail keeps its tool kind after the tool finishes', async () => {
  const text = await fixture('codex-active.jsonl')
  const { tail } = metaAndTail(text, 'fallback')
  assert.equal(tail.workState, 'active')
  // Last evidence is a message, so the moment is talking; the npm test tool
  // kind is kept so the worker stays at its spot.
  assert.equal(tail.phase, 'talking')
  assert.equal(tail.toolKind, 'test')
})

test('approval_request maps to needs-input with ask', async () => {
  const text = await fixture('codex-approval.jsonl')
  const { tail } = metaAndTail(text, 'fallback')
  assert.equal(tail.workState, 'needs-input')
  assert.equal(tail.toolKind, 'ask')
})

test('task_complete maps to waiting', async () => {
  const text = await fixture('codex-complete.jsonl')
  const { tail } = metaAndTail(text, 'fallback')
  assert.equal(tail.workState, 'waiting')
  assert.equal(tail.phase, 'idle')
})

test('ship classification and unknown kinds', async () => {
  const text = await fixture('codex-ship.jsonl')
  const { tail } = metaAndTail(text, 'fallback')
  assert.equal(tail.toolKind, 'ship')
  assert.equal(tail.phase, 'tool')
  assert.equal(tail.workState, 'active')

  // Unknown record kinds never change state and never throw.
  const idle = parseCodexTail('{"type":"nonsense_kind","payload":{"type":"future"}}\n')
  assert.equal(idle.workState, 'unknown')
  assert.equal(idle.phase, 'idle')
})

test('any approval_request type wins the event', () => {
  assert.equal(isApprovalEvent({ type: 'event_msg' }, { type: 'approval_request:exec' }, null), true)
  assert.equal(isApprovalEvent({ type: 'other' }, { type: 'task_started' }, null), false)
})

test('session_meta longer than the first-line cap still yields id and cwd', () => {
  const line = JSON.stringify({
    timestamp: '2026-10-10T21:20:25Z',
    type: 'session_meta',
    payload: { session_id: 's-1', id: 't-1', timestamp: '2026-10-10T21:20:25Z', cwd: '/tmp/work/demo', base_instructions: 'x'.repeat(200_000) },
  })
  for (const input of [line, line.slice(0, 4000)]) {
    const meta = parseCodexMeta(input)
    assert.equal(meta.id, 't-1')
    assert.equal(meta.cwd, '/tmp/work/demo')
  }
})
