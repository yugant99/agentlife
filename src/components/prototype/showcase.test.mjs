import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BLACK_HOLE_ARC_HALF_HEIGHT_DEG,
  BLACK_HOLE_ARC_HALF_WIDTH_DEG,
  BLACK_HOLE_CORE_DEG,
  BLACK_HOLE_DIRECTION,
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
import { placementFor } from './toronto.ts'
import { LANDMARKS } from './landmarks/landmarkTypes.ts'
import { HERO_CELL, HERO_HEIGHT, HERO_SPIRE_HEIGHT } from './city.ts'

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

// Horizontal half-FOV for an aspect ratio, given the fixed vertical FOV.
function halfWidthDeg(aspect) {
  const halfV = (SCENE_FOV_DEG / 2) * (Math.PI / 180)
  return Math.atan(Math.tan(halfV) * aspect) * (180 / Math.PI)
}

test('the arcs fit vertically and the whole hole fits at 16:9 at every pose', () => {
  const halfV = SCENE_FOV_DEG / 2
  const half169 = halfWidthDeg(16 / 9)
  for (const pose of SHOWCASE_POSES) {
    const { up, right } = directionInView(pose, BLACK_HOLE_DIRECTION)
    // One degree of headroom: the top arc grazed the edge at a one-degree pitch.
    assert.ok(up + BLACK_HOLE_ARC_HALF_HEIGHT_DEG <= halfV - 1, `arc top ${up + BLACK_HOLE_ARC_HALF_HEIGHT_DEG} too close to the top edge`)
    assert.ok(up - BLACK_HOLE_ARC_HALF_HEIGHT_DEG >= -halfV, `arc bottom ${up - BLACK_HOLE_ARC_HALF_HEIGHT_DEG} below frame`)
    assert.ok(Math.abs(right) + BLACK_HOLE_ARC_HALF_WIDTH_DEG <= half169, `arcs ${right} outside a 16:9 frame`)
  }
})

test('square crops keep the core and clip the arc tips evenly', () => {
  const halfSquare = halfWidthDeg(1)
  for (const pose of SHOWCASE_POSES) {
    const { right } = directionInView(pose, BLACK_HOLE_DIRECTION)
    assert.ok(Math.abs(right) + BLACK_HOLE_CORE_DEG <= halfSquare, `core ${right} outside a square crop`)
    // Aimed at the hole, so any clipping of the arc tips is symmetric.
    assert.ok(Math.abs(right) <= 1, `hole ${right} degrees off centre`)
  }
})

test('no tall tower cuts through the hole at any pose', () => {
  const cn = placementFor('cn-tower')
  const cnSpec = LANDMARKS.find((spec) => spec.id === 'cn-tower')
  const towers = [
    { name: 'CN Tower', x: cn.x, z: cn.z, top: cnSpec.height * cn.scale },
    { name: 'hero needle', x: HERO_CELL[0], z: HERO_CELL[1], top: HERO_HEIGHT + HERO_SPIRE_HEIGHT },
  ]
  for (const pose of SHOWCASE_POSES) {
    const hole = directionInView(pose, BLACK_HOLE_DIRECTION)
    for (const tower of towers) {
      const tip = directionInView(pose, [tower.x - pose.position[0], tower.top - pose.position[1], tower.z - pose.position[2]])
      const belowCore = tip.up < hole.up - BLACK_HOLE_CORE_DEG
      const beside = Math.abs(tip.right - hole.right) >= BLACK_HOLE_CORE_DEG + 3
      assert.ok(belowCore || beside, `${tower.name} crosses the hole at pose ${pose.position} (${(tip.right - hole.right).toFixed(1)} degrees off)`)
    }
  }
})

test('the default overview cannot frame the hole (why showcase needs its own limit)', () => {
  // The overview looks down ~30 degrees; the hole sits ~12 degrees above the horizon.
  const overview = { position: [79.8, 103, 144.4], target: [0, 8, 0] }
  const { up } = directionInView(overview, BLACK_HOLE_DIRECTION)
  assert.ok(up > SCENE_FOV_DEG / 2, `expected the hole above the overview frame, got ${up}`)
})
