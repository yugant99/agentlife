import test from 'node:test'
import assert from 'node:assert/strict'

import { FRESH_MS, STALE_MS } from './agentModel.ts'
import {
  FOOTSTEP_BASE,
  FOOTSTEP_SWELL,
  HALO_CAP_MS,
  MOTE_COUNT,
  MOTE_RADIUS,
  THEATRE_MAX,
  TOOL_SIGIL_FALLBACK,
  desaturationForAge,
  effectForPhase,
  footstepScaleAt,
  haloFractionForDuration,
  moteOffsetAt,
  rateForPhase,
  rippleFractionAt,
  rippleScaleFor,
  toolSigilColor,
} from './theatre.ts'
import { footstepAlphaAt, paintFootstepDisc } from './footstepTexture.ts'

function agent(overrides = {}) {
  return { phase: 'tool', freshness: 'fresh', ...overrides }
}

test('phase maps to exactly one theatre effect, fresh only', () => {
  assert.equal(effectForPhase(agent({ phase: 'thinking' })), 'motes')
  assert.equal(effectForPhase(agent({ phase: 'talking' })), 'ripple')
  assert.equal(effectForPhase(agent({ phase: 'tool' })), 'sigil')
  assert.equal(effectForPhase(agent({ phase: 'gap' })), 'none')
  assert.equal(effectForPhase(agent({ phase: 'idle' })), 'none')
  assert.equal(effectForPhase(agent({ phase: 'thinking', freshness: 'stale' })), 'none')
  assert.equal(effectForPhase(agent({ phase: 'talking', freshness: 'historical' })), 'none')
  assert.equal(effectForPhase(agent({ phase: 'tool', freshness: 'stale' })), 'none')
  assert.equal(THEATRE_MAX, 32)
})

test('tool sigils stay in their family colour with a quiet fallback', () => {
  assert.equal(toolSigilColor('shell'), toolSigilColor('edit'))
  assert.equal(toolSigilColor('read'), toolSigilColor('search'))
  assert.equal(toolSigilColor('test'), toolSigilColor('web'))
  assert.notEqual(toolSigilColor('shell'), toolSigilColor('read'))
  assert.equal(toolSigilColor(undefined), TOOL_SIGIL_FALLBACK)
  assert.equal(toolSigilColor('other'), TOOL_SIGIL_FALLBACK)
})

test('desaturation ramps from the fresh window to the stale window', () => {
  assert.equal(desaturationForAge(0), 0)
  assert.equal(desaturationForAge(FRESH_MS), 0)
  assert.equal(desaturationForAge(STALE_MS), 1)
  assert.equal(desaturationForAge(STALE_MS + 1_000_000), 1)
  const mid = desaturationForAge((FRESH_MS + STALE_MS) / 2)
  assert.ok(mid > 0.4 && mid < 0.6, `mid ramp reads ${mid}`)
  assert.equal(desaturationForAge(-5), 0)
  assert.equal(desaturationForAge(NaN), 0)
})

test('halo fraction grows with work duration and caps at 30 min', () => {
  assert.equal(haloFractionForDuration(0), 0)
  assert.equal(haloFractionForDuration(-1), 0)
  assert.equal(haloFractionForDuration(NaN), 0)
  assert.equal(haloFractionForDuration(undefined), 0)
  assert.equal(haloFractionForDuration(HALO_CAP_MS), 1)
  assert.equal(haloFractionForDuration(HALO_CAP_MS * 4), 1)
  assert.equal(HALO_CAP_MS, 30 * 60_000)
  const half = haloFractionForDuration(HALO_CAP_MS / 2)
  assert.ok(Math.abs(half - 0.5) < 1e-9)
})

test('pulse rate orders talking fastest and thinking slowest', () => {
  const talking = rateForPhase('talking')
  const tool = rateForPhase('tool')
  const thinking = rateForPhase('thinking')
  const idle = rateForPhase('idle')
  assert.ok(talking > tool && tool > thinking, `${talking} > ${tool} > ${thinking}`)
  assert.equal(rateForPhase('gap'), idle)
  for (const phase of ['thinking', 'tool', 'talking', 'gap', 'idle']) {
    assert.ok(Number.isFinite(rateForPhase(phase)) && rateForPhase(phase) > 0)
  }
})

test('footstep pools pulse around the base diameter', () => {
  assert.equal(footstepScaleAt(0), FOOTSTEP_BASE)
  assert.ok(Math.abs(footstepScaleAt(Math.PI / 2) - (FOOTSTEP_BASE + FOOTSTEP_SWELL)) < 1e-9)
  assert.ok(Math.abs(footstepScaleAt(-Math.PI / 2) - (FOOTSTEP_BASE - FOOTSTEP_SWELL)) < 1e-9)
  assert.equal(footstepScaleAt(NaN), FOOTSTEP_BASE)
})

test('talking ripples loop 1 to 2.5 units', () => {
  assert.equal(rippleFractionAt(0, 1.6), 0)
  assert.ok(Math.abs(rippleFractionAt(0.5, 1) - 0.5) < 1e-9)
  assert.equal(rippleFractionAt(1, 1), 0)
  assert.equal(rippleFractionAt(NaN, 1.6), 0)
  assert.equal(rippleScaleFor(0), 1)
  assert.equal(rippleScaleFor(1), 2.5)
  assert.ok(Math.abs(rippleScaleFor(0.5) - 1.75) < 1e-9)
})

test('thought motes spread evenly around the orbit', () => {
  const a = moteOffsetAt(0, 0.8, 0)
  assert.ok(Math.abs(Math.hypot(a[0], a[1]) - MOTE_RADIUS) < 1e-9)
  const b = moteOffsetAt(0, 0.8, 1)
  const c = moteOffsetAt(0, 0.8, 2)
  assert.ok(Math.abs(Math.hypot(b[0], b[1]) - MOTE_RADIUS) < 1e-9)
  assert.ok(Math.abs(Math.hypot(c[0], c[1]) - MOTE_RADIUS) < 1e-9)
  assert.equal(MOTE_COUNT, 3)
  // A quarter period at 1 Hz rotates slot 0 onto +z.
  const turned = moteOffsetAt(0.25, 1, 0)
  assert.ok(Math.abs(turned[0]) < 1e-9 && Math.abs(turned[1] - MOTE_RADIUS) < 1e-9)
})

test('footstep texture falls off softly and paints without a DOM gradient', () => {
  assert.equal(footstepAlphaAt(0), 1)
  assert.equal(footstepAlphaAt(1), 0)
  assert.equal(footstepAlphaAt(2), 0)
  assert.ok(Math.abs(footstepAlphaAt(0.5) - 0.5) < 1e-9)
  assert.ok(footstepAlphaAt(0.25) > footstepAlphaAt(0.75), 'monotonic falloff')
  let arcs = 0
  const fake = () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect: () => {},
      fillStyle: '',
      globalAlpha: 1,
      beginPath: () => {},
      arc: () => { arcs += 1 },
      fill: () => {},
    }),
  })
  assert.ok(paintFootstepDisc(fake), 'paints with an injected factory')
  assert.ok(arcs > 8, 'disc is painted from concentric arcs')
  assert.equal(paintFootstepDisc(null), null)
  assert.equal(paintFootstepDisc(() => { throw new Error('no canvas') }), null)
})
