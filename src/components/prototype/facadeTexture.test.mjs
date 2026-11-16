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
  FACADE_BAY_WORLD_W,
  FACADE_FLOOR_WORLD_H,
  FACADE_GRID_COLS,
  FACADE_GRID_ROWS,
  FACADE_LIT_RATIO,
  FACADE_TILE_WORLD_H,
  FACADE_TILE_WORLD_W,
  FACADE_WALL,
  clampLitRatio,
  describeFacadeAtlas,
  facadeUvAt,
  hexToLinearRgb,
  litRatioForActiveCount,
  paintFacadeColorMap,
  paintFacadeEmissiveMap,
  patchFacadeShader,
  windowRect,
} from './facadeTexture.ts'
import { MAIN_PARTS, PODIUM_PARTS } from './city.ts'

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

const BAYS = 8 * 16

test('facade atlas is 512x1024 with an 8x16 grid of 64px bays covering the canvas', () => {
  assert.equal(FACADE_ATLAS_WIDTH, 512)
  assert.equal(FACADE_ATLAS_HEIGHT, 1024)
  assert.equal(FACADE_GRID_COLS, 8)
  assert.equal(FACADE_GRID_ROWS, 16)
  const cells = describeFacadeAtlas(0.5)
  assert.equal(cells.length, BAYS)
  for (const cell of cells) {
    assert.equal(cell.w, 64)
    assert.equal(cell.h, 64)
    assert.equal(cell.x, cell.col * 64)
    assert.equal(cell.y, cell.row * 64)
  }
  // Full coverage without gaps: union area equals canvas area.
  const area = cells.reduce((sum, c) => sum + c.w * c.h, 0)
  assert.equal(area, 512 * 1024)
})

test('lit ratio clamping keeps counts inside 0..all bays', () => {
  assert.equal(clampLitRatio(-1), 0)
  assert.equal(clampLitRatio(0), 0)
  assert.equal(clampLitRatio(0.5), 0.5)
  assert.equal(clampLitRatio(1), 1)
  assert.equal(clampLitRatio(2), 1)
  assert.equal(clampLitRatio(NaN), 0)
  assert.equal(clampLitRatio(Infinity), 0)
  assert.equal(describeFacadeAtlas(0).filter((c) => c.lit).length, 0)
  assert.equal(describeFacadeAtlas(1).filter((c) => c.lit).length, BAYS)
  assert.equal(describeFacadeAtlas(-0.5).filter((c) => c.lit).length, 0)
  assert.equal(describeFacadeAtlas(2).filter((c) => c.lit).length, BAYS)
  assert.equal(describeFacadeAtlas(0.5).filter((c) => c.lit).length, BAYS / 2)
  assert.equal(describeFacadeAtlas(FACADE_LIT_RATIO).filter((c) => c.lit).length, Math.round(FACADE_LIT_RATIO * BAYS))
})

test('the atlas is deterministic, scattered across floors, and varies its tones', () => {
  const a = describeFacadeAtlas(FACADE_LIT_RATIO)
  const b = describeFacadeAtlas(FACADE_LIT_RATIO)
  assert.deepEqual(a, b)
  const lit = a.filter((c) => c.lit)
  // Every floor and every column gets at least one lit window: no dark bands.
  for (let row = 0; row < FACADE_GRID_ROWS; row += 1) {
    assert.ok(lit.some((c) => c.row === row), `floor ${row} fully dark`)
  }
  for (let col = 0; col < FACADE_GRID_COLS; col += 1) {
    assert.ok(lit.some((c) => c.col === col), `column ${col} fully dark`)
  }
  assert.ok(new Set(lit.map((c) => c.tone)).size >= 3, 'lit windows all one tone')
  assert.ok(lit.some((c) => c.blind) && lit.some((c) => !c.blind), 'blinds all or nothing')
  assert.ok(a.every((c) => c.lit || !c.blind), 'unlit window with a blind')
})

test('windows sit inside their bay with wall on every side and a deeper sill', () => {
  for (const cell of describeFacadeAtlas(0.5)) {
    const glass = windowRect(cell)
    const left = glass.x - cell.x
    const right = cell.x + cell.w - (glass.x + glass.w)
    const top = glass.y - cell.y
    const bottom = cell.y + cell.h - (glass.y + glass.h)
    for (const margin of [left, right, top, bottom]) assert.ok(margin >= 8, `margin ${margin}px too thin`)
    assert.ok(bottom > top, 'sill should be deeper than the head')
    // Glass is roughly half the bay: windows, not a checkerboard.
    const share = (glass.w * glass.h) / (cell.w * cell.h)
    assert.ok(share > 0.25 && share < 0.45, `glass covers ${share.toFixed(2)} of the bay`)
  }
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
  assert.equal(canvas.width, 512)
  assert.equal(canvas.height, 1024)
  assert.ok(record.length > BAYS)

  const emissiveRecord = []
  const emissive = paintFacadeEmissiveMap(makeFakeFactory(emissiveRecord), 0.5)
  assert.ok(emissive)
  assert.equal(emissive.width, 512)
  assert.equal(emissive.height, 1024)
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

// --- World mapping -----------------------------------------------------------

test('world mapping gives every facade the same window size, whatever its box size', () => {
  assert.equal(FACADE_TILE_WORLD_W, FACADE_BAY_WORLD_W * FACADE_GRID_COLS)
  assert.equal(FACADE_TILE_WORLD_H, FACADE_FLOOR_WORLD_H * FACADE_GRID_ROWS)
  // One bay along a wall and one floor up both move exactly one atlas cell.
  const base = facadeUvAt([3, 1, 5], [0, 0, 1])
  const nextBay = facadeUvAt([3 + FACADE_BAY_WORLD_W, 1, 5], [0, 0, 1])
  const nextFloor = facadeUvAt([3, 1 + FACADE_FLOOR_WORLD_H, 5], [0, 0, 1])
  assert.ok(Math.abs(nextBay[0] - base[0] - 1 / FACADE_GRID_COLS) < 1e-9)
  assert.ok(Math.abs(nextFloor[1] - base[1] - 1 / FACADE_GRID_ROWS) < 1e-9)
  // Walls facing x run along z; walls facing z run along x.
  assert.equal(facadeUvAt([7, 2, 11], [1, 0, 0])[0], 11 / FACADE_TILE_WORLD_W)
  assert.equal(facadeUvAt([7, 2, 11], [0, 0, -1])[0], 7 / FACADE_TILE_WORLD_W)
  // Roofs get no window UV (plain wall).
  assert.equal(facadeUvAt([0, 10, 0], [0, 1, 0]), null)
})

test('real building parts get sensible window counts (no slits, no giant panes)', () => {
  // Old mapping stretched 4x8 windows over every face: a 3.6-tall podium got
  // 8 floors of 0.45 and a 34-tall block got 8 floors of 4.25. Now floors are
  // fixed, so floor count tracks height and bays track width.
  for (const part of [...PODIUM_PARTS, ...MAIN_PARTS]) {
    const floors = part.h / FACADE_FLOOR_WORLD_H
    const bays = part.w / FACADE_BAY_WORLD_W
    assert.ok(Math.abs(floors - part.h / 2.6) < 1e-9)
    assert.ok(bays >= 1, `part ${part.x},${part.z} narrower than one bay (${part.w})`)
  }
  const tallest = Math.max(...MAIN_PARTS.map((p) => p.h))
  assert.ok(tallest / FACADE_FLOOR_WORLD_H > 10, 'tall blocks should read as many floors')
})

test('the shader patch maps both textures, flattens roofs and degrades safely', () => {
  const shader = {
    vertexShader: '#define STANDARD\nvoid main() {\n\t#include <uv_vertex>\n\t#include <begin_vertex>\n}',
    fragmentShader: 'void main() {\n\t#include <map_fragment>\n\t#include <emissivemap_fragment>\n}',
  }
  assert.equal(patchFacadeShader(shader), true)
  assert.ok(shader.vertexShader.startsWith('varying float vFacadeRoof;'))
  assert.ok(shader.vertexShader.includes('#include <uv_vertex>'), 'keeps the original chunk')
  assert.ok(shader.vertexShader.includes('vMapUv = facadeUv;'))
  assert.ok(shader.vertexShader.includes('vEmissiveMapUv = facadeUv;'))
  assert.ok(shader.vertexShader.includes('instanceMatrix'))
  assert.ok(shader.vertexShader.includes(`/ ${FACADE_TILE_WORLD_W}.0`))
  assert.ok(!shader.fragmentShader.includes('#include <map_fragment>'))
  assert.ok(!shader.fragmentShader.includes('#include <emissivemap_fragment>'))
  assert.ok(shader.fragmentShader.includes('vFacadeRoof'))
  // The roof wall colour is the painted wall, converted to linear space.
  const [r] = hexToLinearRgb(FACADE_WALL)
  assert.ok(shader.fragmentShader.includes(String(r)))
  assert.ok(r > 0 && r < 1)

  // A shader without the expected chunks is left untouched.
  const foreign = { vertexShader: 'void main() {}', fragmentShader: 'void main() {}' }
  assert.equal(patchFacadeShader(foreign), false)
  assert.equal(foreign.vertexShader, 'void main() {}')
})

test('hex to linear matches the sRGB transfer at the ends and midpoint', () => {
  assert.deepEqual(hexToLinearRgb('#000000'), [0, 0, 0])
  assert.deepEqual(hexToLinearRgb('#ffffff'), [1, 1, 1])
  const [mid] = hexToLinearRgb('#808080')
  assert.ok(Math.abs(mid - 0.2158605) < 1e-6)
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
