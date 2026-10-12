import test from 'node:test'
import assert from 'node:assert/strict'

import {
  QUALITY_DOWN_MS,
  QUALITY_UP_MS,
  createQualityState,
  parseQualityOverride,
  updateQuality,
} from './quality.ts'

function push(state, fps, totalMs, stepMs = 500) {
  let next = state
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    next = updateQuality(next, fps, stepMs)
  }
  return next
}

test('ladder starts at high', () => {
  assert.equal(createQualityState(null).tier, 'high')
})

test('high drops to medium after 2 s below 50 fps', () => {
  let state = createQualityState(null)
  state = push(state, 49, 1500)
  assert.equal(state.tier, 'high')
  state = updateQuality(state, 49, 500)
  assert.equal(state.tier, 'medium')
})

test('any tier drops to low after 2 s below 35 fps', () => {
  let state = createQualityState(null)
  state = push(state, 20, QUALITY_DOWN_MS)
  assert.equal(state.tier, 'low')
  // Medium also falls through to low on a deep dip.
  state = { ...createQualityState(null), tier: 'medium' }
  state = push(state, 34, QUALITY_DOWN_MS)
  assert.equal(state.tier, 'low')
})

test('medium holds through a shallow dip (only <35 drops it)', () => {
  let state = { ...createQualityState(null), tier: 'medium' }
  state = push(state, 40, 5000)
  assert.equal(state.tier, 'medium')
})

test('steps up one tier only after 10 s at 58 fps or above', () => {
  let state = { ...createQualityState(null), tier: 'low' }
  state = push(state, 60, QUALITY_UP_MS - 500)
  assert.equal(state.tier, 'low')
  state = updateQuality(state, 60, 500)
  assert.equal(state.tier, 'medium')
  // One tier per window: needs a second full window to reach high.
  state = push(state, 60, QUALITY_UP_MS - 500)
  assert.equal(state.tier, 'medium')
  state = updateQuality(state, 60, 500)
  assert.equal(state.tier, 'high')
})

test('hysteresis: dead-zone samples reset both timers', () => {
  let state = createQualityState(null)
  state = push(state, 40, 1500)
  state = updateQuality(state, 55, 500) // dead zone: 50-58 resets
  state = push(state, 40, 1500)
  assert.equal(state.tier, 'high')
  state = push(state, 40, 500)
  assert.equal(state.tier, 'medium')
})

test('hysteresis: flapping around thresholds never transitions', () => {
  let state = createQualityState(null)
  for (let i = 0; i < 40; i += 1) {
    state = updateQuality(state, i % 2 === 0 ? 49 : 59, 500)
  }
  assert.equal(state.tier, 'high')
})

test('a weak sample resets the climb timer', () => {
  let state = { ...createQualityState(null), tier: 'low' }
  state = push(state, 60, 9000)
  state = updateQuality(state, 30, 500)
  state = push(state, 60, 9500)
  assert.equal(state.tier, 'low')
  state = updateQuality(state, 60, 500)
  assert.equal(state.tier, 'medium')
})

test('healthy rates hold the tier without climbing', () => {
  let state = { ...createQualityState(null), tier: 'low' }
  state = push(state, 55, 30000)
  assert.equal(state.tier, 'low')
  state = createQualityState(null)
  state = push(state, 120, 30000)
  assert.equal(state.tier, 'high')
})

test('non-finite samples never move the ladder', () => {
  const state = createQualityState(null)
  assert.deepEqual(updateQuality(state, NaN, 1000), state)
  assert.deepEqual(updateQuality(state, Infinity, 1000), state)
})

test('?quality pins the tier and ignores samples', () => {
  assert.equal(parseQualityOverride('?quality=low'), 'low')
  assert.equal(parseQualityOverride('?quality=medium'), 'medium')
  assert.equal(parseQualityOverride('?quality=high'), 'high')
  assert.equal(parseQualityOverride(''), null)
  assert.equal(parseQualityOverride('?quality=ultra'), null)
  assert.equal(parseQualityOverride('?quality='), null)
  let state = createQualityState(parseQualityOverride('?quality=low'))
  assert.equal(state.tier, 'low')
  state = push(state, 120, 30000)
  assert.equal(state.tier, 'low')
  state = createQualityState(parseQualityOverride('?quality=high'))
  state = push(state, 5, 10000)
  assert.equal(state.tier, 'high')
})
