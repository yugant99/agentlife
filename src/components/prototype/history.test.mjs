import test from 'node:test'
import assert from 'node:assert/strict'

import {
  HISTORY_MINUTES,
  MINUTE_MS,
  diffHistoryEvents,
  emptyHistory,
  minuteStartFor,
  recordHistoryMinute,
  toHistorySnapshot,
} from './history.ts'

function agent(overrides = {}) {
  return {
    id: 'codex:a1',
    workState: 'active',
    freshness: 'fresh',
    toolKind: 'shell',
    lastSignalAt: 1_700_000_000_000,
    ...overrides,
  }
}

const EMPTY = { ships: [], tests: [], needs: [], arrivals: [] }

test('diff counts ship, test, needs and arrival ticks on fresh signals', () => {
  const prev = []
  const next = [
    agent({ id: 'codex:ship', toolKind: 'ship' }),
    agent({ id: 'codex:test', toolKind: 'test' }),
    agent({ id: 'codex:need', workState: 'needs-input' }),
  ]
  const events = diffHistoryEvents(prev, next)
  assert.deepEqual(events.ships, ['codex:ship'])
  assert.deepEqual(events.tests, ['codex:test'])
  assert.deepEqual(events.needs, ['codex:need'])
  assert.deepEqual(events.arrivals.sort(), ['codex:need', 'codex:ship', 'codex:test'].sort())
})

test('re-renders with the same id + lastSignalAt never double-count', () => {
  const before = [agent({ id: 'codex:a1', workState: 'active', lastSignalAt: 1000 })]
  const after = [agent({ id: 'codex:a1', workState: 'needs-input', lastSignalAt: 2000 })]
  assert.deepEqual(diffHistoryEvents(before, after).needs, ['codex:a1'])
  assert.deepEqual(diffHistoryEvents(after, after), EMPTY)
  // Same signal, different render object: still no event.
  const clone = [{ ...after[0] }]
  assert.deepEqual(diffHistoryEvents(after, clone), EMPTY)
})

test('stale and historical signals never tick; historical never arrives', () => {
  const prev = [agent({ id: 'codex:a1', lastSignalAt: 1000 })]
  const stale = [agent({ id: 'codex:a1', workState: 'needs-input', freshness: 'stale', toolKind: 'ship', lastSignalAt: 2000 })]
  assert.deepEqual(diffHistoryEvents(prev, stale), EMPTY)
  const historical = [agent({ id: 'codex:ghost', freshness: 'historical', lastSignalAt: 2000 })]
  assert.deepEqual(diffHistoryEvents([], historical).arrivals, [])
  assert.deepEqual(diffHistoryEvents([], historical).ships, [])
})

test('minute bucketing floors to the minute and merges within it', () => {
  assert.equal(minuteStartFor(61_000), 60_000)
  assert.equal(minuteStartFor(0), 0)
  assert.equal(minuteStartFor(NaN), 0)
  const now = 60 * MINUTE_MS + 10_000
  let buffer = emptyHistory()
  buffer = recordHistoryMinute(buffer, now, { ships: ['a'], tests: [], needs: [], arrivals: [] })
  buffer = recordHistoryMinute(buffer, now + 5_000, { ships: [], tests: ['b'], needs: [], arrivals: [] })
  assert.equal(buffer.length, 1)
  assert.deepEqual(buffer[0], { start: 60 * MINUTE_MS, ships: 1, tests: 1, needs: 0, arrivals: 0 })
})

test('ring buffer rolls over per minute and drops minutes past the window', () => {
  const base = 100 * MINUTE_MS
  let buffer = emptyHistory()
  for (let i = 0; i < HISTORY_MINUTES + 5; i += 1) {
    buffer = recordHistoryMinute(buffer, base + i * MINUTE_MS, { ships: ['a'], tests: [], needs: [], arrivals: [] })
  }
  assert.equal(buffer.length, HISTORY_MINUTES)
  assert.equal(buffer[0].start, base + 5 * MINUTE_MS)
  assert.equal(buffer[buffer.length - 1].start, base + (HISTORY_MINUTES + 4) * MINUTE_MS)
  // A far-future tick drops the whole old window.
  buffer = recordHistoryMinute(buffer, base + 500 * MINUTE_MS, { ships: [], tests: [], needs: [], arrivals: ['n'] })
  assert.equal(buffer.length, 1)
  assert.equal(buffer[0].arrivals, 1)
})

test('toHistorySnapshot keeps the diff key intact', () => {
  const snapshot = toHistorySnapshot(agent({ id: 'codex:k', lastSignalAt: 42 }))
  assert.equal(snapshot.id, 'codex:k')
  assert.equal(snapshot.lastSignalAt, 42)
})
