import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ARRIVAL_FADE_MS,
  DEPARTURE_FADE_MS,
  arrivalOpacity,
  departureOpacity,
  lifecycleFor,
  shouldTether,
} from './lifecycle.ts'

test('new agents arrive; stale sit; historical leave', () => {
  assert.equal(lifecycleFor('fresh', false), 'arriving')
  assert.equal(lifecycleFor('fresh', true), 'at-work')
  assert.equal(lifecycleFor('stale', true), 'seated')
  assert.equal(lifecycleFor('stale', false), 'arriving')
  assert.equal(lifecycleFor('historical', true), 'leaving')
  assert.equal(lifecycleFor('historical', false), 'arriving')
})

test('departures fade over about eight seconds', () => {
  assert.equal(departureOpacity(0), 1)
  assert.equal(departureOpacity(-5), 1)
  assert.ok(departureOpacity(DEPARTURE_FADE_MS / 2) > 0.4 && departureOpacity(DEPARTURE_FADE_MS / 2) < 0.6)
  assert.equal(departureOpacity(DEPARTURE_FADE_MS), 0)
  assert.equal(departureOpacity(DEPARTURE_FADE_MS + 4000), 0)
  assert.equal(DEPARTURE_FADE_MS, 8000)
})

test('arrivals fade in quickly', () => {
  assert.equal(arrivalOpacity(0), 0)
  assert.equal(arrivalOpacity(ARRIVAL_FADE_MS), 1)
  assert.equal(arrivalOpacity(ARRIVAL_FADE_MS + 500), 1)
})

test('tethers join a fresh child and parent only', () => {
  const parent = { id: 'codex:parent', freshness: 'fresh' }
  const child = { id: 'codex:child', parentId: 'codex:parent', freshness: 'fresh' }
  assert.equal(shouldTether(child, parent), true)
  assert.equal(shouldTether({ ...child, freshness: 'stale' }, parent), false)
  assert.equal(shouldTether(child, { ...parent, freshness: 'stale' }), false)
  assert.equal(shouldTether({ ...child, parentId: 'codex:other' }, parent), false)
  assert.equal(shouldTether({ ...child, parentId: undefined }, parent), false)
})
