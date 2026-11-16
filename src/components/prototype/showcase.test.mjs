import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BLACK_HOLE_DIRECTION,
  BLACK_HOLE_GLOW_DEG,
  DEFAULT_MAX_POLAR,
  SCENE_FOV_DEG,
  SHOWCASE_DEFAULT_QUALITY,
  SHOWCASE_FIRST_SHOT_MS,
  SHOWCASE_MAX_POLAR,
  SHOWCASE_POSES,
  SHOWCASE_SHOT_MS,
  directionInView,
  parseShowcaseFlag,
  polarAngle,
  showcaseQuality,
  showcaseShot,
} from './showcase.ts'

test('flag parsing: only showcase=1 turns it on', () => {
  assert.equal(parseShowcaseFlag('?showcase=1'), true)
  assert.equal(parseShowcaseFlag('?debug=1&showcase=1'), true)
  assert.equal(parseShowcaseFlag('?showcase=0'), false)
  assert.equal(parseShowcaseFlag('?showcase'), false)
  assert.equal(parseShowcaseFlag(''), false)
})

test('quality: explicit ?quality= wins, showcase pins medium, otherwise unpinned', () => {
  assert.equal(SHOWCASE_DEFAULT_QUALITY, 'medium')
  assert.equal(showcaseQuality(null, true), 'medium')
  assert.equal(showcaseQuality('high', true), 'high')
  assert.equal(showcaseQuality('low', false), 'low')
  assert.equal(showcaseQuality(null, false), null)
})

test('reel alternates poses with unique ids; first move is quicker', () => {
  const first = showcaseShot(0, 1)
  const second = showcaseShot(1, 2)
  const third = showcaseShot(2, 3)
  assert.equal(first.durationMs, SHOWCASE_FIRST_SHOT_MS)
  assert.equal(second.durationMs, SHOWCASE_SHOT_MS)
  assert.deepEqual(first.position, SHOWCASE_POSES[0].position)
  assert.deepEqual(second.position, SHOWCASE_POSES[1].position)
  assert.deepEqual(third.position, SHOWCASE_POSES[0].position)
  assert.notEqual(first.id, second.id)
  assert.ok(first.id.startsWith('showcase-'))
  // Shots carry copies, never the shared pose arrays.
  first.position[0] = 999
  assert.notEqual(SHOWCASE_POSES[0].position[0], 999)
  // Bad steps fall back to the first pose.
  assert.deepEqual(showcaseShot(Number.NaN, 4).position, SHOWCASE_POSES[0].position)
})

test('every pose sits inside the showcase orbit limits (controls never clamp it)', () => {
  assert.ok(SHOWCASE_MAX_POLAR > DEFAULT_MAX_POLAR)
  for (const pose of SHOWCASE_POSES) {
    const polar = polarAngle(pose)
    assert.ok(polar >= 0.22, `polar ${polar} under the minimum`)
    assert.ok(polar <= SHOWCASE_MAX_POLAR, `polar ${polar} over the showcase limit`)
  }
})

test('the whole black-hole glow fits in frame at every pose (square crop or wider)', () => {
  const half = SCENE_FOV_DEG / 2
  for (const pose of SHOWCASE_POSES) {
    const { up, right } = directionInView(pose, BLACK_HOLE_DIRECTION)
    assert.ok(up + BLACK_HOLE_GLOW_DEG <= half, `glow top ${up + BLACK_HOLE_GLOW_DEG} above frame`)
    assert.ok(up - BLACK_HOLE_GLOW_DEG >= -half, `glow bottom ${up - BLACK_HOLE_GLOW_DEG} below frame`)
    // Square crop: horizontal half-FOV equals the vertical one.
    assert.ok(Math.abs(right) + BLACK_HOLE_GLOW_DEG <= half, `glow side ${right} outside a square crop`)
  }
})

test('the default overview cannot frame the hole (why showcase needs its own limit)', () => {
  // The overview looks down ~30 degrees; the hole sits ~12 degrees above the horizon.
  const overview = { position: [79.8, 103, 144.4], target: [0, 8, 0] }
  const { up } = directionInView(overview, BLACK_HOLE_DIRECTION)
  assert.ok(up > SCENE_FOV_DEG / 2, `expected the hole above the overview frame, got ${up}`)
})
