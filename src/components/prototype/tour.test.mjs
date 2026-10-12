import test from 'node:test'
import assert from 'node:assert/strict'

import { TOOL_DISTRICT } from './agentModel.ts'
import { DISTRICTS, WORK_SPOTS } from './city.ts'
import {
  ATTRACT_IDLE_MS,
  CITY_DISTANCE,
  CITY_TARGET,
  INTRO_DISTANCE_FACTOR,
  INTRO_DURATION_MS,
  INTRO_SEEN_KEY,
  TOUR_SHOT_MS,
  advanceTourState,
  buildTourQueue,
  currentTourStop,
  distanceForDistrict,
  distanceForStop,
  idleDue,
  introFromShot,
  introToShot,
  markIntroSeen,
  parseAttractFlag,
  parseNoIntroFlag,
  readIntroSeen,
  shotForStop,
  shouldSkipIntro,
  startTourState,
  stopTourState,
  targetForStop,
} from './tour.ts'

function agent(overrides = {}) {
  return {
    id: 'codex:a1',
    workState: 'active',
    freshness: 'fresh',
    lastSignalAt: 1_700_000_000_000,
    toolKind: 'shell',
    ...overrides,
  }
}

function distance(position, target) {
  return Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2])
}

// --- Flags + intro skip rules --------------------------------------------------

test('flag parsing', () => {
  assert.equal(parseAttractFlag('?attract=1'), true)
  assert.equal(parseAttractFlag('?attract=0'), false)
  assert.equal(parseAttractFlag(''), false)
  assert.equal(parseNoIntroFlag('?noIntro'), true)
  assert.equal(parseNoIntroFlag('?noIntro=1'), true)
  assert.equal(parseNoIntroFlag(''), false)
})

test('intro skips on ?noIntro, reduced motion, or a seen session', () => {
  const base = { search: '', reducedMotion: false, seen: false }
  assert.equal(shouldSkipIntro(base), false)
  assert.equal(shouldSkipIntro({ ...base, search: '?noIntro' }), true)
  assert.equal(shouldSkipIntro({ ...base, reducedMotion: true }), true)
  assert.equal(shouldSkipIntro({ ...base, seen: true }), true)
})

test('sessionStorage gate survives throwing stores', () => {
  const store = new Map()
  const fake = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, value) },
  }
  assert.equal(readIntroSeen(fake), false)
  markIntroSeen(fake)
  assert.equal(store.get(INTRO_SEEN_KEY), '1')
  assert.equal(readIntroSeen(fake), true)
  assert.equal(readIntroSeen(null), false)
  assert.equal(readIntroSeen(undefined), false)
  const throwing = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
  }
  assert.equal(readIntroSeen(throwing), false)
  markIntroSeen(throwing) // must not throw
  markIntroSeen(null)
})

// --- Tour ordering -------------------------------------------------------------

test('needs-you leads, then busy districts, then the city overview', () => {
  const agents = [
    agent({ id: 'codex:busy1', toolKind: 'read', lastSignalAt: 1000 }), // archive
    agent({ id: 'codex:busy2', toolKind: 'read', lastSignalAt: 1001 }), // archive
    agent({ id: 'codex:other', toolKind: 'shell', lastSignalAt: 1002 }), // foundry
    agent({ id: 'codex:needy', workState: 'needs-input', toolKind: 'shell', lastSignalAt: 500 }),
  ]
  const queue = buildTourQueue(agents)
  assert.equal(queue[0].kind, 'needs-you')
  assert.equal(queue[0].agentId, 'codex:needy')
  const districts = queue.filter((stop) => stop.kind === 'district').map((stop) => stop.districtId)
  assert.deepEqual(districts, ['archive', 'foundry'])
  assert.equal(queue[queue.length - 1].kind, 'city')
})

test('needs-you urgency: longest waiter first, one stop per district', () => {
  const agents = [
    agent({ id: 'codex:new', workState: 'needs-input', lastSignalAt: 2000 }),
    agent({ id: 'codex:old', workState: 'needs-input', lastSignalAt: 1000 }),
  ]
  const queue = buildTourQueue(agents)
  // Every fresh needs-input agent resolves to the Citadel steps, so the pair
  // collapses to a single stop naming the longest waiter.
  const needy = queue.filter((stop) => stop.kind === 'needs-you')
  assert.equal(needy.length, 1)
  assert.equal(needy[0].agentId, 'codex:old')
})

test('stale needs-input never leads the tour', () => {
  const agents = [
    agent({ id: 'codex:stale', workState: 'needs-input', freshness: 'stale', lastSignalAt: 100 }),
    agent({ id: 'codex:busy', toolKind: 'shell', lastSignalAt: 200 }),
  ]
  const queue = buildTourQueue(agents)
  assert.ok(queue.every((stop) => stop.kind !== 'needs-you'))
  assert.equal(queue[0].kind, 'district')
})

test('needs-covered districts do not repeat in the activity phase', () => {
  const agents = [
    agent({ id: 'codex:needy', workState: 'needs-input', toolKind: 'other', lastSignalAt: 100 }),
  ]
  const queue = buildTourQueue(agents)
  assert.deepEqual(queue.map((stop) => stop.kind), ['needs-you', 'city'])
})

test('empty city still tours the overview', () => {
  assert.deepEqual(buildTourQueue([]), [{ kind: 'city' }])
})

// --- Shot framing ---------------------------------------------------------------

test('city shot frames the default overview', () => {
  const stop = { kind: 'city' }
  assert.deepEqual(targetForStop(stop), [...CITY_TARGET])
  assert.equal(distanceForStop(stop), CITY_DISTANCE)
  const shot = shotForStop(stop, 7)
  assert.equal(shot.id, 'tour-7-city')
  assert.equal(shot.durationMs, TOUR_SHOT_MS)
  assert.ok(Math.abs(distance(shot.position, shot.target) - CITY_DISTANCE) < 1e-6)
})

test('district shots center on city.ts district centers', () => {
  for (const district of DISTRICTS) {
    const stop = { kind: 'district', districtId: district.id }
    const target = targetForStop(stop)
    assert.deepEqual(target, [district.center[0], 16, district.center[1]])
    const expected = distanceForDistrict(district.radius)
    assert.equal(distanceForStop(stop), expected)
    const shot = shotForStop(stop, 1)
    assert.ok(Math.abs(distance(shot.position, shot.target) - expected) < 1e-6)
  }
})

test('needs-you stops frame the district work spot up close', () => {
  const stop = { kind: 'needs-you', districtId: 'citadel', agentId: 'codex:a1' }
  const spot = WORK_SPOTS.citadel
  assert.deepEqual(targetForStop(stop), [spot.center[0], 2, spot.center[1]])
  assert.equal(distanceForStop(stop), 30)
})

test('tour tool mapping matches the frozen agent contract', () => {
  // preferredDistrict must keep resolving through agentModel: spot-check every tool.
  for (const [tool, district] of Object.entries(TOOL_DISTRICT)) {
    const queue = buildTourQueue([agent({ toolKind: tool })])
    assert.equal(queue[0].districtId, district, `tool ${tool}`)
  }
})

test('arrival glide: ~1.25x out eases home over 2.8 s', () => {
  const from = introFromShot()
  const to = introToShot()
  assert.deepEqual(from.target, [...CITY_TARGET])
  assert.deepEqual(to.target, [...CITY_TARGET])
  assert.equal(to.durationMs, INTRO_DURATION_MS)
  assert.equal(INTRO_DURATION_MS, 2800)
  const fromDist = distance(from.position, from.target)
  const toDist = distance(to.position, to.target)
  assert.ok(Math.abs(toDist - CITY_DISTANCE) < 1e-6)
  assert.ok(Math.abs(fromDist / toDist - INTRO_DISTANCE_FACTOR) < 1e-6)
})

test('every tour id is unique per stop', () => {
  const queue = buildTourQueue([agent({}), agent({ id: 'codex:b', toolKind: 'read' })])
  const ids = new Set(queue.map((stop, index) => shotForStop(stop, index).id))
  assert.equal(ids.size, queue.length)
})

// --- Driver: idle, yield, advance -------------------------------------------------

test('tour starts after 60 s idle and yields to any input', () => {
  assert.equal(idleDue(0, ATTRACT_IDLE_MS), true)
  assert.equal(idleDue(0, ATTRACT_IDLE_MS - 1), false)
  assert.equal(idleDue(NaN, 1000), false)
  let state = startTourState()
  assert.equal(state.active, true)
  const queue = buildTourQueue([agent({})])
  assert.deepEqual(currentTourStop(queue, state), queue[0])
  state = advanceTourState(state)
  assert.deepEqual(currentTourStop(queue, state), queue[1 % queue.length])
  // Yield: back to idle, index reset, overview stop for an empty queue.
  state = stopTourState()
  assert.equal(state.active, false)
  assert.deepEqual(currentTourStop([], state), { kind: 'city' })
})
