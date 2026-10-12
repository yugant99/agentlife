import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TRAM_TOTAL,
  hasFreshPresence,
  isFreshShip,
  majorityProvider,
  newShipEvents,
  selectCourierHandoff,
  shipEventKey,
  shouldBoatSail,
  tramLitCount,
} from './vehicles.ts'

function agent(overrides = {}) {
  return {
    id: 'codex:a',
    provider: 'codex',
    workState: 'active',
    freshness: 'fresh',
    phase: 'tool',
    toolKind: 'shell',
    lastSignalAt: 1_700_000_000_000,
    depth: 0,
    ...overrides,
  }
}

test('tram lit cars clamp to 1-5 from the working count', () => {
  assert.equal(tramLitCount(0), 1)
  assert.equal(tramLitCount(1), 1)
  assert.equal(tramLitCount(3), 3)
  assert.equal(tramLitCount(5), 5)
  assert.equal(tramLitCount(9), 5)
  assert.equal(tramLitCount(-2), 1)
  assert.equal(tramLitCount(Number.NaN), 1)
  assert.equal(TRAM_TOTAL, 5)
})

test('majority provider follows fresh-active workers with a stable tie-break', () => {
  const agents = [
    agent({ id: 'codex:1', provider: 'codex' }),
    agent({ id: 'codex:2', provider: 'codex' }),
    agent({ id: 'opencode:1', provider: 'opencode' }),
    agent({ id: 'manual:1', provider: 'manual', freshness: 'stale' }),
  ]
  assert.equal(majorityProvider(agents), 'codex')
  const tie = [
    agent({ id: 'codex:1', provider: 'codex' }),
    agent({ id: 'opencode:1', provider: 'opencode' }),
  ]
  assert.equal(majorityProvider(tie), majorityProvider([...tie].reverse()))
  assert.equal(majorityProvider([]), 'codex')
  const staleOnly = [agent({ id: 'codex:1', freshness: 'stale' })]
  assert.equal(majorityProvider(staleOnly), 'codex')
})

test('ship keys dedupe on id plus lastSignalAt and ignore non-ships', () => {
  const fresh = agent({ id: 'codex:s', toolKind: 'ship', lastSignalAt: 100 })
  assert.equal(shipEventKey(fresh), 'codex:s@100')
  assert.equal(isFreshShip(fresh), true)
  assert.equal(isFreshShip(agent({ toolKind: 'ship', freshness: 'stale' })), false)
  assert.equal(isFreshShip(agent({ toolKind: 'shell' })), false)
  assert.deepEqual(newShipEvents(new Set(), [fresh]), ['codex:s@100'])
  assert.deepEqual(newShipEvents(new Set(['codex:s@100']), [fresh]), [])
  const reship = agent({ id: 'codex:s', toolKind: 'ship', lastSignalAt: 200 })
  assert.deepEqual(newShipEvents(new Set(['codex:s@100']), [reship]), ['codex:s@200'])
  assert.deepEqual(newShipEvents(['codex:s@100'], [fresh, reship]), ['codex:s@200'])
})

test('courier handoff needs a fresh delegate parent with a fresh child', () => {
  const parent = agent({ id: 'codex:p', toolKind: 'delegate', lastSignalAt: 10 })
  const child = agent({ id: 'codex:c', parentId: 'codex:p', lastSignalAt: 20 })
  const handoff = selectCourierHandoff([parent, child])
  assert.deepEqual(handoff, { parentId: 'codex:p', childId: 'codex:c', key: 'codex:p>codex:c@20' })
  assert.equal(selectCourierHandoff([parent, { ...child, freshness: 'stale' }]), null)
  assert.equal(selectCourierHandoff([{ ...parent, toolKind: 'shell' }, child]), null)
  assert.equal(selectCourierHandoff([parent]), null)
  assert.equal(selectCourierHandoff([]), null)
  const parent2 = agent({ id: 'codex:q', toolKind: 'delegate', lastSignalAt: 5 })
  const child2 = agent({ id: 'codex:d', parentId: 'codex:q', lastSignalAt: 5 })
  assert.equal(selectCourierHandoff([parent, child, parent2, child2])?.childId, 'codex:d')
})

test('mooring gates canal boats on fresh presence per district', () => {
  const shell = agent({ toolKind: 'shell', freshness: 'fresh' })
  assert.equal(hasFreshPresence([shell], 'foundry'), true)
  assert.equal(hasFreshPresence([shell], 'port'), false)
  assert.equal(hasFreshPresence([{ ...shell, freshness: 'stale' }], 'foundry'), false)
  assert.equal(hasFreshPresence([], 'port'), false)
  assert.equal(shouldBoatSail([shell], 'foundry'), true)
  assert.equal(shouldBoatSail([shell], 'port'), false)
})
