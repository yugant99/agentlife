import test from 'node:test'
import assert from 'node:assert/strict'

import { isOnScreen, placeWedge, placeWedgeInto } from './attention.ts'

const VIEW = { width: 800, height: 600 }
const MARGIN = 28

test('on-screen points stay where projected', () => {
  assert.equal(isOnScreen(0, 0, false), true)
  assert.equal(isOnScreen(0.99, -0.99, false), true)
  assert.equal(isOnScreen(1.01, 0, false), false)
  assert.equal(isOnScreen(0, 0, true), false)
  const out = placeWedge(0, 0, false, VIEW, MARGIN)
  assert.equal(out.onScreen, true)
  assert.equal(out.x, 400)
  assert.equal(out.y, 300)
})

test('off-screen points clamp to the inset edge', () => {
  const right = placeWedge(2, 0, false, VIEW, MARGIN)
  assert.equal(right.onScreen, false)
  assert.equal(right.x, 800 - MARGIN)
  assert.equal(right.y, 300)
  assert.ok(Math.abs(right.angleDeg) < 1, `angle ${right.angleDeg} should point east`)

  const left = placeWedge(-2, 0, false, VIEW, MARGIN)
  assert.equal(left.x, MARGIN)
  assert.ok(Math.abs(Math.abs(left.angleDeg) - 180) < 1)

  const top = placeWedge(0, 2, false, VIEW, MARGIN)
  assert.equal(top.y, MARGIN)
  assert.ok(Math.abs(top.angleDeg + 90) < 1, `angle ${top.angleDeg} should point north`)

  const bottom = placeWedge(0, -2, false, VIEW, MARGIN)
  assert.equal(bottom.y, 600 - MARGIN)
  assert.ok(Math.abs(bottom.angleDeg - 90) < 1)
})

test('corners clamp inside both insets', () => {
  const out = placeWedge(2, 2, false, VIEW, MARGIN)
  assert.equal(out.onScreen, false)
  assert.ok(out.x <= 800 - MARGIN && out.x >= MARGIN)
  assert.ok(out.y <= 600 - MARGIN && out.y >= MARGIN)
  // Up-right diagonal: angle between -90 (north) and 0 (east).
  assert.ok(out.angleDeg < 0 && out.angleDeg > -90, `angle ${out.angleDeg}`)
})

test('behind-camera targets flip to the opposite edge', () => {
  const front = placeWedge(0.5, 0, false, VIEW, MARGIN)
  const behind = placeWedge(0.5, 0, true, VIEW, MARGIN)
  assert.equal(behind.onScreen, false)
  // Flipped x lands on the opposite half from the front projection.
  assert.ok((front.x - 400) * (behind.x - 400) < 0, 'behind should mirror across center')
})

test('degenerate viewports never produce NaN', () => {
  const out = placeWedge(5, 5, false, { width: 0, height: 0 }, MARGIN)
  assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.angleDeg))
  const nan = placeWedge(NaN, 0, false, VIEW, MARGIN)
  assert.ok(Number.isFinite(nan.x) && Number.isFinite(nan.y))
})

test('into-variant writes into the reused object', () => {
  const out = { x: 0, y: 0, angleDeg: 0, onScreen: true }
  placeWedgeInto(-3, 0, false, VIEW, MARGIN, out)
  assert.equal(out.x, MARGIN)
  assert.equal(out.onScreen, false)
})
