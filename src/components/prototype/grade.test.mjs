import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BLOOM_THRESHOLD,
  bloomParamsForTier,
  bloomResolution,
  bloomScaleForMode,
  easedShotPose,
  effectCountForDensity,
  gradeParamsForState,
  pipelineSettingsForTier,
  resolveQualityTier,
  shotAlpha,
  shotDurationSec,
  shouldStartShotMove,
  smoothstep01,
} from './grade.ts'
import { QUALITY_SETTINGS } from './sceneControl.ts'

test('quality tiers resolve with a high default and match the frozen contract', () => {
  assert.equal(resolveQualityTier(undefined), 'high')
  assert.equal(resolveQualityTier(null), 'high')
  assert.equal(resolveQualityTier('ultra'), 'high')
  assert.equal(resolveQualityTier('medium'), 'medium')
  assert.deepEqual(pipelineSettingsForTier(), QUALITY_SETTINGS.high)
  assert.deepEqual(pipelineSettingsForTier('medium'), QUALITY_SETTINGS.medium)
  assert.deepEqual(pipelineSettingsForTier('low'), QUALITY_SETTINGS.low)
  assert.equal(QUALITY_SETTINGS.high.dprMax, 1.6)
  assert.equal(QUALITY_SETTINGS.high.bloom, 'half')
  assert.equal(QUALITY_SETTINGS.medium.bloom, 'quarter')
  assert.equal(QUALITY_SETTINGS.low.bloom, 'off')
  assert.equal(QUALITY_SETTINGS.low.shadows, false)
})

test('bloom resolution halves, quarters, or disables per tier', () => {
  assert.deepEqual(bloomResolution(1600, 900, 'half'), { width: 800, height: 450 })
  assert.deepEqual(bloomResolution(1600, 900, 'quarter'), { width: 400, height: 225 })
  assert.equal(bloomResolution(1600, 900, 'off'), null)
  assert.equal(bloomScaleForMode('half'), 0.5)
  assert.equal(bloomScaleForMode('quarter'), 0.25)
  assert.equal(bloomScaleForMode('off'), 0)
  const high = bloomParamsForTier('high')
  assert.equal(high.enabled, true)
  assert.equal(high.threshold, BLOOM_THRESHOLD)
  assert.equal(high.threshold, 1.0)
  assert.ok(high.strength > 0)
  const low = bloomParamsForTier('low')
  assert.equal(low.enabled, false)
  assert.equal(low.strength, 0)
})

test('grade parameters freeze grain while paused or under reduced motion', () => {
  const live = gradeParamsForState(false, false)
  assert.equal(live.freezeGrain, false)
  assert.ok(live.exposure > 1 && live.exposure < 1.2)
  assert.ok(live.grainAmount > 0)
  assert.equal(gradeParamsForState(true, false).freezeGrain, true)
  assert.equal(gradeParamsForState(false, true).freezeGrain, true)
  // Exposure never changes: the still scene grades identically.
  assert.equal(gradeParamsForState(true, true).exposure, live.exposure)
})

test('effect density scales instance counts down per tier', () => {
  assert.equal(effectCountForDensity(26, 1), 26)
  assert.equal(effectCountForDensity(26, 0.6), 15)
  assert.equal(effectCountForDensity(26, 0.4), 10)
  assert.equal(effectCountForDensity(26, 0), 0)
  assert.equal(effectCountForDensity(0, 1), 0)
  assert.equal(effectCountForDensity(-4, 1), 0)
})

test('shot easing eases pose at time t with smoothstep', () => {
  assert.equal(smoothstep01(0), 0)
  assert.equal(smoothstep01(1), 1)
  assert.equal(smoothstep01(0.5), 0.5)
  assert.equal(smoothstep01(-2), 0)
  assert.equal(smoothstep01(3), 1)
  assert.equal(shotAlpha(500, 1000), 0.5)
  assert.equal(shotAlpha(0, 1000), 0)
  assert.equal(shotAlpha(2000, 1000), 1)
  assert.equal(shotAlpha(100, 0), 1)
  assert.equal(shotDurationSec(1000), 1)
  assert.equal(shotDurationSec(0), 0)
  const from = easedShotPose([0, 0, 0], [0, 0, 0], [10, 0, 0], [0, 10, 0], 0)
  assert.deepEqual(from.position, [0, 0, 0])
  const mid = easedShotPose([0, 0, 0], [0, 0, 0], [10, 0, 0], [0, 10, 0], 0.5)
  assert.deepEqual(mid.position, [5, 0, 0])
  assert.deepEqual(mid.target, [0, 5, 0])
  const end = easedShotPose([0, 0, 0], [0, 0, 0], [10, 0, 0], [0, 10, 0], 1)
  assert.deepEqual(end.position, [10, 0, 0])
  assert.deepEqual(end.target, [0, 10, 0])
})

test('same shot id never restarts a move; absent shots never start', () => {
  assert.equal(shouldStartShotMove(null, { id: 'a' }), true)
  assert.equal(shouldStartShotMove('a', { id: 'a' }), false)
  assert.equal(shouldStartShotMove('a', { id: 'b' }), true)
  assert.equal(shouldStartShotMove(null, null), false)
  assert.equal(shouldStartShotMove(null, undefined), false)
  assert.equal(shouldStartShotMove('a', null), false)
})
