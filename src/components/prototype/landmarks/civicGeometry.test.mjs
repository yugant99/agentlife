import test from 'node:test'
import assert from 'node:assert/strict'

import { LANDMARKS } from './landmarkTypes.ts'
import {
  CITY_HALL_ARCH,
  CITY_HALL_ARCH_XS,
  CITY_HALL_FOOTPRINT,
  CITY_HALL_HEIGHT,
  CITY_HALL_PLAZA,
  CITY_HALL_PODIUM,
  CITY_HALL_POOL,
  CITY_HALL_SAUCER,
  CITY_HALL_SIGN_COLORS,
  CITY_HALL_TOWER_DEPTH,
  CITY_HALL_TOWER_EAST_HEIGHT,
  CITY_HALL_TOWER_THICKNESS,
  CITY_HALL_TOWER_WEST_HEIGHT,
  DISTILLERY_CHIMNEY,
  DISTILLERY_FOOTPRINT,
  DISTILLERY_HEIGHT,
  DISTILLERY_LANE,
  DISTILLERY_ROOF_OVERHANG,
  ROM_BASE,
  ROM_CORNICE,
  ROM_FOOTPRINT,
  ROM_HEIGHT,
  ROM_PRISMS,
  UNION_COLUMN,
  UNION_COLUMN_COUNT,
  UNION_FOOTPRINT,
  UNION_HEIGHT,
  boxWithinFootprint,
  cityHallSignBlocks,
  cityHallTowerArcPoints,
  distilleryBuildings,
  distilleryRoofBase,
  distilleryWindows,
  romPrismCorners,
  romSlitTransforms,
  unionBlocks,
  unionColumnPositions,
  unionWindowPositions,
} from './civicGeometry.ts'

function spec(id) {
  const found = LANDMARKS.find((s) => s.id === id)
  assert.ok(found, `spec for ${id}`)
  return found
}

test('specs match the frozen landmark contract', () => {
  assert.deepEqual([UNION_FOOTPRINT, UNION_HEIGHT], [{ w: 24, d: 7 }, 9])
  assert.deepEqual([CITY_HALL_FOOTPRINT, CITY_HALL_HEIGHT], [{ w: 18, d: 14 }, 30])
  assert.deepEqual([ROM_FOOTPRINT, ROM_HEIGHT], [{ w: 12, d: 12 }, 16])
  assert.deepEqual([DISTILLERY_FOOTPRINT, DISTILLERY_HEIGHT], [{ w: 16, d: 10 }, 10])
  assert.equal(spec('union-station').height, 9)
  assert.equal(spec('city-hall').height, 30)
  assert.equal(spec('rom-crystal').height, 16)
  assert.equal(spec('distillery').height, 10)
})

test('union station: 22 columns and windows stay inside 24x7x9', () => {
  const cols = unionColumnPositions()
  assert.equal(cols.length, UNION_COLUMN_COUNT)
  assert.equal(UNION_COLUMN_COUNT, 22)
  for (const c of cols) {
    assert.ok(Math.abs(c.x) + UNION_COLUMN.radius <= UNION_FOOTPRINT.w / 2)
    assert.ok(Math.abs(c.z) + UNION_COLUMN.radius <= UNION_FOOTPRINT.d / 2)
  }
  const xs = cols.map((c) => c.x)
  assert.ok(Math.max(...xs) - Math.min(...xs) > 20, 'colonnade spans the facade')
  for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i] > xs[i - 1], 'evenly ordered')
  assert.ok(UNION_COLUMN.y0 + UNION_COLUMN.height <= UNION_HEIGHT)
  const wins = unionWindowPositions()
  assert.equal(wins.length, UNION_COLUMN_COUNT - 1)
  for (const w of wins) {
    assert.ok(Math.abs(w.x) <= UNION_FOOTPRINT.w / 2)
    assert.ok(Math.abs(w.z) <= UNION_FOOTPRINT.d / 2)
    assert.ok(w.y > 0 && w.y < UNION_HEIGHT)
  }
  for (const b of unionBlocks()) assert.ok(boxWithinFootprint(b, UNION_FOOTPRINT, UNION_HEIGHT))
})

test('city hall: concave unequal towers cradle the saucer, all inside 18x14x30', () => {
  assert.equal(CITY_HALL_TOWER_EAST_HEIGHT, 30)
  assert.equal(CITY_HALL_TOWER_WEST_HEIGHT, 22)
  for (const side of ['east', 'west']) {
    const pts = cityHallTowerArcPoints(side, 7)
    assert.equal(pts.length, 7)
    const top = side === 'east' ? CITY_HALL_TOWER_EAST_HEIGHT : CITY_HALL_TOWER_WEST_HEIGHT
    for (const p of pts) {
      assert.equal(p.top, top)
      assert.ok(Math.abs(p.x) + CITY_HALL_TOWER_THICKNESS / 2 <= CITY_HALL_FOOTPRINT.w / 2)
      assert.ok(Math.abs(p.z) + CITY_HALL_TOWER_DEPTH / 2 <= CITY_HALL_FOOTPRINT.d / 2)
      assert.ok(p.top <= CITY_HALL_HEIGHT)
    }
    // Concave toward the centre: the middle sits closer to x = 0 than the ends.
    const ends = (Math.abs(pts[0].x) + Math.abs(pts[pts.length - 1].x)) / 2
    const mid = Math.abs(pts[Math.floor(pts.length / 2)].x)
    assert.ok(mid < ends, `${side} tower bows inward`)
  }
  assert.ok(boxWithinFootprint(CITY_HALL_PLAZA, CITY_HALL_FOOTPRINT, CITY_HALL_HEIGHT))
  assert.ok(boxWithinFootprint(CITY_HALL_PODIUM, CITY_HALL_FOOTPRINT, CITY_HALL_HEIGHT))
  assert.ok(boxWithinFootprint(CITY_HALL_POOL, CITY_HALL_FOOTPRINT, CITY_HALL_HEIGHT))
  assert.ok(Math.abs(CITY_HALL_SAUCER.x) + CITY_HALL_SAUCER.radius <= CITY_HALL_FOOTPRINT.w / 2)
  assert.ok(Math.abs(CITY_HALL_SAUCER.z) + CITY_HALL_SAUCER.radius <= CITY_HALL_FOOTPRINT.d / 2)
  assert.ok(CITY_HALL_SAUCER.y0 + CITY_HALL_SAUCER.height <= CITY_HALL_HEIGHT)
  assert.equal(CITY_HALL_ARCH_XS.length, 3)
  for (const x of CITY_HALL_ARCH_XS) {
    assert.ok(Math.abs(x) + CITY_HALL_ARCH.radius <= CITY_HALL_FOOTPRINT.w / 2)
    assert.ok(CITY_HALL_ARCH.y + CITY_HALL_ARCH.radius <= CITY_HALL_HEIGHT)
  }
  const sign = cityHallSignBlocks()
  assert.equal(sign.length, 7)
  assert.equal(new Set(sign.map((s) => s.color)).size, 7)
  assert.deepEqual(sign.map((s) => s.color), [...CITY_HALL_SIGN_COLORS])
  for (const s of sign) {
    assert.ok(Math.abs(s.x) <= CITY_HALL_FOOTPRINT.w / 2)
    assert.ok(Math.abs(s.z) <= CITY_HALL_FOOTPRINT.d / 2)
    assert.ok(s.y < CITY_HALL_HEIGHT)
  }
})

test('rom crystal: 5 prisms burst from the base, every corner inside 12x12x16', () => {
  assert.ok(ROM_PRISMS.length >= 4 && ROM_PRISMS.length <= 5)
  assert.ok(boxWithinFootprint(ROM_BASE, ROM_FOOTPRINT, ROM_HEIGHT))
  assert.ok(boxWithinFootprint(ROM_CORNICE, ROM_FOOTPRINT, ROM_HEIGHT))
  for (const prism of ROM_PRISMS) {
    const corners = romPrismCorners(prism)
    assert.equal(corners.length, 8)
    for (const [x, y, z] of corners) {
      assert.ok(Math.abs(x) <= ROM_FOOTPRINT.w / 2, `prism x ${x}`)
      assert.ok(Math.abs(z) <= ROM_FOOTPRINT.d / 2, `prism z ${z}`)
      assert.ok(y >= 0 && y <= ROM_HEIGHT, `prism y ${y}`)
    }
  }
  for (const s of romSlitTransforms()) {
    const [x, y, z] = s.position
    assert.ok(Math.abs(x) <= ROM_FOOTPRINT.w / 2)
    assert.ok(Math.abs(z) <= ROM_FOOTPRINT.d / 2)
    assert.ok(y >= 0 && y <= ROM_HEIGHT)
  }
})

test('distillery: brick cluster, chimney and lane stay inside 16x10x10', () => {
  const buildings = distilleryBuildings()
  assert.equal(buildings.length, 4)
  for (const b of buildings) {
    assert.ok(boxWithinFootprint(b, DISTILLERY_FOOTPRINT, DISTILLERY_HEIGHT))
    assert.ok(b.y0 + b.h + b.roofH <= DISTILLERY_HEIGHT)
    assert.ok(boxWithinFootprint(distilleryRoofBase(b), DISTILLERY_FOOTPRINT, DISTILLERY_HEIGHT))
  }
  assert.ok(boxWithinFootprint(DISTILLERY_CHIMNEY, DISTILLERY_FOOTPRINT, DISTILLERY_HEIGHT))
  assert.ok(boxWithinFootprint(DISTILLERY_LANE, DISTILLERY_FOOTPRINT, DISTILLERY_HEIGHT))
  assert.ok(DISTILLERY_ROOF_OVERHANG < 1.1, 'roofs hug the walls')
  // Narrow lane between the north and south rows stays clear of wall bodies.
  const laneZ0 = DISTILLERY_LANE.z - DISTILLERY_LANE.d / 2
  const laneZ1 = DISTILLERY_LANE.z + DISTILLERY_LANE.d / 2
  for (const b of buildings) {
    const z0 = b.z - b.d / 2
    const z1 = b.z + b.d / 2
    assert.ok(z1 <= laneZ0 || z0 >= laneZ1, 'lane stays open')
  }
  const wins = distilleryWindows()
  assert.ok(wins.length > 10, 'both edges read lit')
  for (const w of wins) {
    assert.ok(Math.abs(w.x) <= DISTILLERY_FOOTPRINT.w / 2)
    assert.ok(Math.abs(w.z) <= DISTILLERY_FOOTPRINT.d / 2)
    assert.ok(w.y > 0 && w.y <= DISTILLERY_HEIGHT)
  }
})
