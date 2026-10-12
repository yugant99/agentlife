import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BUILDINGS,
  CANAL_WIDTH,
  HARBOR,
  HERO,
  HERO_CELL,
  HERO_HEIGHT,
  HERO_SPIRE_HEIGHT,
  PLAZAS,
  PLAZA_CARVE,
  SPOT_CARVE,
  WORK_SPOTS,
  isCarveClear,
  isLatticeCell,
} from './city.ts'
import { isWalkable } from './cityGraph.ts'
import {
  FACADE_ATLAS_HEIGHT,
  FACADE_ATLAS_WIDTH,
  FACADE_GRID_COLS,
  FACADE_GRID_ROWS,
  clampLitRatio,
  describeFacadeAtlas,
  litRatioForActiveCount,
  paintFacadeColorMap,
  paintFacadeEmissiveMap,
} from './facadeTexture.ts'

function makeFakeFactory(record) {
  return (w, h) => {
    const canvas = {
      width: w,
      height: h,
      getContext: () => ({
        fillStyle: '',
        fillRect: (x, y, rw, rh) => {
          record.push([x, y, rw, rh])
        },
      }),
    }
    return canvas
  }
}

// --- Facade atlas layout ----------------------------------------------------

test('facade atlas is 256x512 with a 4x8 grid covering the canvas', () => {
  assert.equal(FACADE_ATLAS_WIDTH, 256)
  assert.equal(FACADE_ATLAS_HEIGHT, 512)
  assert.equal(FACADE_GRID_COLS, 4)
  assert.equal(FACADE_GRID_ROWS, 8)
  const cells = describeFacadeAtlas(0.5)
  assert.equal(cells.length, 32)
  const cellW = 256 / 4
  const cellH = 512 / 8
  for (const cell of cells) {
    assert.equal(cell.w, cellW)
    assert.equal(cell.h, cellH)
    assert.equal(cell.x, cell.col * cellW)
    assert.equal(cell.y, cell.row * cellH)
  }
  // Full coverage without gaps: union area equals canvas area.
  const area = cells.reduce((sum, c) => sum + c.w * c.h, 0)
  assert.equal(area, 256 * 512)
})

test('lit ratio clamping keeps counts inside 0..32', () => {
  assert.equal(clampLitRatio(-1), 0)
  assert.equal(clampLitRatio(0), 0)
  assert.equal(clampLitRatio(0.5), 0.5)
  assert.equal(clampLitRatio(1), 1)
  assert.equal(clampLitRatio(2), 1)
  assert.equal(clampLitRatio(NaN), 0)
  assert.equal(clampLitRatio(Infinity), 0)
  assert.equal(describeFacadeAtlas(0).filter((c) => c.lit).length, 0)
  assert.equal(describeFacadeAtlas(1).filter((c) => c.lit).length, 32)
  assert.equal(describeFacadeAtlas(-0.5).filter((c) => c.lit).length, 0)
  assert.equal(describeFacadeAtlas(2).filter((c) => c.lit).length, 32)
  assert.equal(describeFacadeAtlas(0.5).filter((c) => c.lit).length, 16)
})

test('lit ratio follows the active count with base glow and a cap', () => {
  assert.equal(litRatioForActiveCount(0), 0.18)
  assert.equal(litRatioForActiveCount(-2), 0.18)
  assert.ok(litRatioForActiveCount(1) > litRatioForActiveCount(0))
  assert.ok(litRatioForActiveCount(2) > litRatioForActiveCount(1))
  assert.ok(litRatioForActiveCount(3) > litRatioForActiveCount(2))
  assert.equal(litRatioForActiveCount(3), litRatioForActiveCount(10))
  assert.ok(litRatioForActiveCount(3) <= 0.92)
})

test('paint uses the injected factory and degrades to null without a canvas', () => {
  const record = []
  const canvas = paintFacadeColorMap(makeFakeFactory(record), 0.5)
  assert.ok(canvas)
  assert.equal(canvas.width, 256)
  assert.equal(canvas.height, 512)
  assert.ok(record.length > 32)

  const emissiveRecord = []
  const emissive = paintFacadeEmissiveMap(makeFakeFactory(emissiveRecord), 0.5)
  assert.ok(emissive)
  assert.equal(emissive.width, 256)
  assert.equal(emissive.height, 512)
  assert.ok(emissiveRecord.length > 1)

  assert.equal(paintFacadeColorMap(null, 0.5), null)
  assert.equal(paintFacadeColorMap(undefined, 0.5), null)
  assert.equal(paintFacadeEmissiveMap(null, 0.5), null)
  assert.equal(paintFacadeColorMap(() => { throw new Error('no canvas') }, 0.5), null)
  assert.equal(paintFacadeColorMap(() => null, 0.5), null)
  assert.equal(
    paintFacadeColorMap(() => ({ width: 256, height: 512, getContext: () => null }), 0.5),
    null,
  )
})

// --- Hero cell ---------------------------------------------------------------

test('hero cell is a valid lattice cell outside every carve', () => {
  const [hx, hz] = HERO_CELL
  assert.ok(isLatticeCell(hx, hz), `hero ${hx},${hz} is not a lattice cell`)
  // Lattice cells sit at +5 (buildings); streets sit at multiples of 10.
  assert.equal((hx - 5) % 10, 0)
  assert.equal((hz - 5) % 10, 0)
  assert.ok(isCarveClear(hx, hz), 'hero cell fails a carve check')
  // Explicit carve checks so a helper regression cannot hide a plaza/water siting.
  assert.ok(Math.hypot(hx, hz) >= 18, 'hero inside the citadel core carve')
  assert.ok(!(hx > HARBOR.x0 - 1 && hx < HARBOR.x1 + 1 && hz > HARBOR.z0 - 1 && hz < HARBOR.z1 + 1), 'hero in water')
  for (const id of Object.keys(PLAZAS)) {
    const [px, pz] = PLAZAS[id]
    assert.ok(Math.hypot(hx - px, hz - pz) >= PLAZA_CARVE, `hero inside plaza ${id}`)
  }
  for (const spot of [WORK_SPOTS.citadel.center, WORK_SPOTS.observatory.center, WORK_SPOTS.port.center]) {
    assert.ok(Math.hypot(hx - spot[0], hz - spot[1]) >= SPOT_CARVE, 'hero inside a work-spot carve')
  }
  // Canal pad mirrors city.ts (CANAL_WIDTH * 0.5 + 2.4).
  void CANAL_WIDTH
  assert.ok(HERO, 'HERO missing from BUILDINGS')
  assert.equal(HERO.x, hx)
  assert.equal(HERO.z, hz)
  assert.equal(HERO.district, 'citadel')
  assert.equal(HERO.height, HERO_HEIGHT)
  assert.equal(HERO.roof, 'spire')
  assert.equal(HERO_SPIRE_HEIGHT, 14)
  // The street graph never sees buildings, so the hero must not block walking.
  assert.equal(isWalkable(hx, hz), true)
})

test('building count is deterministic and every building clears its carves', () => {
  assert.ok(BUILDINGS.length > 60, `suspicious city size: ${BUILDINGS.length}`)
  let expected = 0
  for (let i = -6; i <= 5; i += 1) {
    for (let j = -6; j <= 5; j += 1) {
      const x = i * 10 + 5
      const z = j * 10 + 5
      if (isCarveClear(x, z)) expected += 1
    }
  }
  assert.equal(BUILDINGS.length, expected)
  for (const b of BUILDINGS) {
    assert.ok(isLatticeCell(b.x, b.z), `building ${b.x},${b.z} off lattice`)
    assert.ok(isCarveClear(b.x, b.z), `building ${b.x},${b.z} inside a carve`)
    assert.ok(b.parts.length > 0)
    assert.ok(b.height > 0)
  }
})
