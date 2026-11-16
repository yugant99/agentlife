import test from 'node:test'
import assert from 'node:assert/strict'

import { LANDMARKS } from './landmarks/landmarkTypes.ts'
import {
  LANDMARK_MARGIN,
  LANDMARK_PLACEMENTS,
  checkPairs,
  checkPlacement,
  landmarkSignals,
  obbIntersectsRect,
  placementFor,
  placementOBB,
  unionFrontToStreet,
} from './toronto.ts'
import { BUILDINGS, DISTRICTS, ROADS } from './city.ts'

function agent(overrides = {}) {
  return {
    id: 'codex:test',
    provider: 'codex',
    source: 'simulation',
    depth: 0,
    name: 'Test',
    workspace: 'mythic-city',
    workState: 'active',
    freshness: 'fresh',
    phase: 'tool',
    toolKind: 'shell',
    lastSignalAt: 1_700_000_000_000,
    startedAt: 1_700_000_000_000 - 600_000,
    ...overrides,
  }
}

test('every LANDMARKS entry has a placement inside its district, scale 0.7-1.0', () => {
  assert.equal(Object.keys(LANDMARK_PLACEMENTS).length, LANDMARKS.length)
  for (const spec of LANDMARKS) {
    const placement = placementFor(spec.id)
    assert.equal(placement.id, spec.id)
    assert.ok(placement.scale >= 0.7 && placement.scale <= 1.0, `${spec.id}: scale ${placement.scale}`)
    assert.ok(Number.isFinite(placement.x) && Number.isFinite(placement.z) && Number.isFinite(placement.rotationY))
    const district = DISTRICTS.find((d) => d.id === spec.district)
    assert.ok(district, `missing district ${spec.district}`)
    const dist = Math.hypot(placement.x - district.center[0], placement.z - district.center[1])
    assert.ok(dist <= district.radius, `${spec.id}: centre ${dist.toFixed(2)} outside ${spec.district} r=${district.radius}`)
  }
})

test('placements are deterministic', () => {
  const first = JSON.stringify(LANDMARK_PLACEMENTS)
  const second = JSON.stringify({
    'cn-tower': placementFor('cn-tower'),
    'rogers-centre': placementFor('rogers-centre'),
    'union-station': placementFor('union-station'),
    'city-hall': placementFor('city-hall'),
    'rom-crystal': placementFor('rom-crystal'),
    distillery: placementFor('distillery'),
  })
  assert.equal(second, first)
  assert.equal(LANDMARK_MARGIN, 2)
})

test('no placement overlaps water, canal, bridges, spots, arch or hero (plus margin)', () => {
  for (const spec of LANDMARKS) {
    assert.deepEqual(checkPlacement(spec.id), [], `${spec.id} has placement issues`)
  }
})

test('landmark pairs do not overlap each other (plus margin)', () => {
  assert.deepEqual(checkPairs(), [])
})

test('carved ROADS export is clear of every expanded footprint', () => {
  assert.ok(ROADS.length > 50, 'suspiciously few road segments')
  for (const road of ROADS) {
    const rect = road.along === 'z'
      ? { x0: road.x - road.wide / 2, x1: road.x + road.wide / 2, z0: road.z - road.len / 2, z1: road.z + road.len / 2 }
      : { x0: road.x - road.len / 2, x1: road.x + road.len / 2, z0: road.z - road.wide / 2, z1: road.z + road.wide / 2 }
    for (const spec of LANDMARKS) {
      assert.ok(!obbIntersectsRect(placementOBB(spec.id), rect), `${spec.id} overlaps a carved road at ${road.x},${road.z}`)
    }
  }
})

test('generic buildings are carved around every expanded footprint', () => {
  assert.ok(BUILDINGS.length > 40, 'suspiciously few buildings')
  for (const building of BUILDINGS) {
    // Matches the carve predicate in city.ts: the 10-unit lattice cell rect.
    const cell = { x0: building.x - 5, x1: building.x + 5, z0: building.z - 5, z1: building.z + 5 }
    for (const spec of LANDMARKS) {
      assert.ok(!obbIntersectsRect(placementOBB(spec.id), cell), `building at ${building.x},${building.z} inside ${spec.id} carve`)
    }
  }
})

test('CN Tower and Rogers Centre share the Port waterfront, Rogers west / south-west', () => {
  const tower = placementFor('cn-tower')
  const rogers = placementFor('rogers-centre')
  assert.ok(rogers.x < tower.x, 'Rogers Centre must sit west of the tower')
  assert.ok(rogers.z <= tower.z, 'Rogers Centre must sit south-west of the tower')
  const dist = Math.hypot(tower.x - rogers.x, tower.z - rogers.z)
  assert.ok(dist <= 42, `Port pair reads as one waterfront cluster, got ${dist.toFixed(1)}`)
})

test('Union Station faces a street at the Gateway', () => {
  assert.ok(unionFrontToStreet() <= 6, `Union front too far from any street line: ${unionFrontToStreet().toFixed(2)}`)
})

test('landmarkSignals counts needs-you, working and test runners', () => {
  const now = 1_700_000_000_000
  const agents = [
    agent({ id: 'codex:a1', workState: 'active', freshness: 'fresh', toolKind: 'shell', lastSignalAt: now - 1_000 }),
    agent({ id: 'codex:a2', workState: 'needs-input', freshness: 'fresh', toolKind: 'read', lastSignalAt: now - 2_000 }),
    agent({ id: 'codex:a3', workState: 'active', freshness: 'fresh', toolKind: 'test', lastSignalAt: now - 3_000 }),
    agent({ id: 'codex:a4', workState: 'active', freshness: 'stale', toolKind: 'test', lastSignalAt: now - 300_000 }),
    agent({ id: 'codex:a5', workState: 'complete', freshness: 'fresh', toolKind: 'test', lastSignalAt: now - 4_000 }),
  ]
  assert.deepEqual(landmarkSignals(agents), { needsYou: 1, working: 2, testsRunning: 1 })
  assert.deepEqual(landmarkSignals([]), { needsYou: 0, working: 0, testsRunning: 0 })
})
