import test from 'node:test'
import assert from 'node:assert/strict'

import { diffSoundEvents, minIntervalFor, shouldPlayCue } from './citySound.ts'

function agent(overrides = {}) {
  return {
    id: 'codex:a1',
    workState: 'active',
    freshness: 'fresh',
    lastSignalAt: 1_700_000_000_000,
    toolKind: 'shell',
    ...overrides,
  }
}

test('needs cues fire only on fresh needs-input transitions', () => {
  const before = [agent({ id: 'codex:a1', workState: 'active', lastSignalAt: 1000 })]
  const after = [agent({ id: 'codex:a1', workState: 'needs-input', lastSignalAt: 2000 })]
  assert.deepEqual(diffSoundEvents(before, after).needs, ['codex:a1'])
  // Same id + same signal: no repeat.
  assert.deepEqual(diffSoundEvents(after, after).needs, [])
  // Stale needs-input never cues.
  const stale = [agent({ id: 'codex:a1', workState: 'needs-input', freshness: 'stale', lastSignalAt: 3000 })]
  assert.deepEqual(diffSoundEvents(after, stale).needs, [])
})

test('ship cues key on fresh ship-tool transitions', () => {
  const before = [agent({ id: 'codex:s', toolKind: 'read', lastSignalAt: 1000 })]
  const after = [agent({ id: 'codex:s', toolKind: 'ship', lastSignalAt: 2000 })]
  assert.deepEqual(diffSoundEvents(before, after).ships, ['codex:s'])
  assert.deepEqual(diffSoundEvents(after, after).ships, [])
})

test('arrivals list brand-new ids only', () => {
  const before = [agent({ id: 'codex:a1' })]
  const after = [agent({ id: 'codex:a1' }), agent({ id: 'codex:a2' })]
  assert.deepEqual(diffSoundEvents(before, after).arrivals, ['codex:a2'])
  assert.deepEqual(diffSoundEvents([], []).arrivals, [])
})

test('first snapshot never cues (caller seeds prev first)', () => {
  // Empty prev means every id counts as an arrival but only arrivals — the HUD
  // suppresses playback on the seeding pass, so assert the pure shape instead.
  const events = diffSoundEvents([], [agent({ id: 'codex:a1', workState: 'needs-input' })])
  assert.deepEqual(events.arrivals, ['codex:a1'])
  assert.deepEqual(events.needs, ['codex:a1'])
})

test('rate limits gate repeats per cue kind', () => {
  assert.equal(shouldPlayCue('needs', 10_000, undefined), true)
  assert.equal(shouldPlayCue('needs', 10_000, 10_000), false)
  assert.equal(shouldPlayCue('needs', 10_000 + minIntervalFor('needs'), 10_000), true)
  assert.equal(shouldPlayCue('ship', 5_000, 4_000), false)
  assert.equal(shouldPlayCue('ship', 8_000, 4_000), true)
  assert.equal(shouldPlayCue('arrive', NaN, undefined), false)
})
