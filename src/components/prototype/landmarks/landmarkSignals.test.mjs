import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AVIATION_DUTY,
  AVIATION_PERIOD_SEC,
  LANDMARK_EASE_SECONDS,
  STADIUM_OFF_LEVEL,
  STADIUM_ON_LEVEL,
  TOWER_AMBER_LEVEL,
  TOWER_DIM_LEVEL,
  TOWER_LED_AMBER,
  TOWER_LED_COOL,
  TOWER_PULSE_DEPTH,
  TOWER_WORKING_BASE,
  TOWER_WORKING_CAP,
  aviationOnAt,
  aviationPhaseAt,
  ledPulseAt,
  ledTargetFor,
  resolveEased,
  stadiumTargetFor,
  stepEased,
} from './landmarkSignals.ts'

test('LEDs read amber while anyone needs you, regardless of working', () => {
  const target = ledTargetFor(2, 9)
  assert.equal(target.color, TOWER_LED_AMBER)
  assert.equal(target.intensity, TOWER_AMBER_LEVEL)
  assert.ok(TOWER_AMBER_LEVEL > 1, 'amber blooms')
  assert.equal(ledTargetFor(1, 0).color, TOWER_LED_AMBER)
})

test('LEDs read cool white-blue scaled by working, dim at rest', () => {
  const rest = ledTargetFor(0, 0)
  assert.equal(rest.color, TOWER_LED_COOL)
  assert.equal(rest.intensity, TOWER_DIM_LEVEL)
  assert.ok(TOWER_DIM_LEVEL < TOWER_WORKING_BASE, 'rest sits below any working level')

  const one = ledTargetFor(0, 1)
  const many = ledTargetFor(0, 8)
  const capped = ledTargetFor(0, TOWER_WORKING_CAP * 4)
  assert.equal(one.color, TOWER_LED_COOL)
  assert.ok(one.intensity > rest.intensity, 'any work lifts above rest')
  assert.ok(many.intensity > one.intensity, 'more work reads brighter')
  assert.ok(capped.intensity >= many.intensity, 'saturates instead of blowing out')
  assert.ok(capped.intensity <= TOWER_WORKING_BASE + 1.5, 'headroom stays bounded')
})

test('LED targets sanitize messy counts', () => {
  assert.equal(ledTargetFor(-3, -1).intensity, TOWER_DIM_LEVEL)
  assert.equal(ledTargetFor(NaN, NaN).color, TOWER_LED_COOL)
  assert.equal(ledTargetFor(undefined, 2).intensity, ledTargetFor(0, 2).intensity)
})

test('amber pulse stays shallow and loops once per period', () => {
  const period = 1 / 0.6
  for (const t of [0, 0.2, 0.5, 1.1, 2.3]) {
    const pulse = ledPulseAt(t)
    assert.ok(pulse >= 1 - TOWER_PULSE_DEPTH - 1e-9 && pulse <= 1 + 1e-9, `pulse ${pulse} at ${t}`)
  }
  assert.ok(Math.abs(ledPulseAt(0) - ledPulseAt(period)) < 1e-9, 'pulse loops')
  assert.ok(ledPulseAt(period / 2) < ledPulseAt(0), 'pulse dips mid-period')
  assert.equal(ledPulseAt(NaN), ledPulseAt(0))
})

test('stadium lights are on while tests run, off otherwise', () => {
  assert.equal(stadiumTargetFor(1), STADIUM_ON_LEVEL)
  assert.equal(stadiumTargetFor(5), STADIUM_ON_LEVEL)
  assert.ok(STADIUM_ON_LEVEL > 1, 'lit rim blooms')
  assert.equal(stadiumTargetFor(0), STADIUM_OFF_LEVEL)
  assert.equal(stadiumTargetFor(-2), STADIUM_OFF_LEVEL)
  assert.equal(stadiumTargetFor(NaN), STADIUM_OFF_LEVEL)
})

test('eased steps converge over at least 1.5 s and never overshoot', () => {
  assert.equal(LANDMARK_EASE_SECONDS, 1.5)
  // A 60 fps frame moves 1/90th of the gap: full swings take seconds.
  assert.ok(Math.abs(stepEased(0, 2, 1 / 60) - 2 / 90) < 1e-9)
  let value = 0
  const dt = 1 / 60
  for (let i = 0; i < 45; i += 1) value = stepEased(value, 2, dt)
  assert.ok(value < 2 * 0.5, `halfway time still far off: ${value}`)
  for (let i = 0; i < 800; i += 1) value = stepEased(value, 2, dt)
  assert.ok(Math.abs(value - 2) < 1e-3, `long runs converge: ${value}`)
  assert.ok(stepEased(0, 2, 0) === 0, 'no time means no move')
  assert.ok(stepEased(0, 2, -1) === 0, 'negative time holds')
  assert.ok(stepEased(0, 2, NaN) === 0, 'bad deltas hold')
})

test('resolveEased freezes on pause and snaps under reduced motion', () => {
  const live = resolveEased(0, 2, 1 / 60, { paused: false, reducedMotion: false })
  assert.ok(live > 0 && live < 2, 'live frames ease')
  assert.equal(resolveEased(0.5, 2, 1, { paused: true, reducedMotion: false }), 0.5)
  assert.equal(resolveEased(0.5, 2, 1, { paused: true, reducedMotion: true }), 0.5)
  assert.equal(resolveEased(0.5, 2, 1 / 60, { paused: false, reducedMotion: true }), 2)
})

test('aviation blink is a short duty flash with per-beacon offsets', () => {
  assert.ok(AVIATION_PERIOD_SEC > 1, 'slow scenery blink')
  assert.ok(AVIATION_DUTY > 0 && AVIATION_DUTY < 0.5, 'short flash')
  assert.equal(aviationOnAt(0), true)
  assert.equal(aviationOnAt(AVIATION_PERIOD_SEC * 0.5), false)
  assert.equal(aviationOnAt(AVIATION_PERIOD_SEC), true)
  const phase = aviationPhaseAt(0.4)
  assert.ok(phase >= 0 && phase < 1, 'phase wraps 0..1')
  assert.notEqual(aviationOnAt(0, 0), aviationOnAt(0, AVIATION_PERIOD_SEC / 2), 'offsets stagger beacons')
  assert.equal(aviationOnAt(NaN), aviationOnAt(0), 'bad clocks pin to phase 0')
})
