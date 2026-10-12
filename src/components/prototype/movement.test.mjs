import test from 'node:test'
import assert from 'node:assert/strict'

import { DOMINANCE_WINDOW_MS, DWELL_MIN_MS, MAX_RENDERED_WORKERS, TRIP_MAX_MS, TRIP_MIN_MS } from './agentModel.ts'
import {
  OVERFLOW_RING_R,
  assignDistrictSlots,
  assignOverflowSlots,
  canLeaveSpot,
  childOffset,
  dominantToolKind,
  gestureForWorker,
  layoutTargets,
  overflowSlotPosition,
  overflowTargets,
  renderPriority,
  RIBBON_MAX_POINTS,
  ribbonPointsFromRoute,
  ringFor,
  selectRendered,
  slotPosition,
  SLOT_RING_R,
  targetDistrict,
  tripDurationMs,
  tripSpeed,
  selectLeaving,
} from './movement.ts'

const CENTERS = {
  citadel: [0, 20],
  foundry: [-38, -6],
  archive: [42, -10],
  observatory: [18, 44],
  port: [-30, 40],
  gateway: [42, 18],
}

function cityAgent(overrides = {}) {
  return {
    id: 'codex:worker',
    parentId: undefined,
    depth: 0,
    workState: 'active',
    freshness: 'fresh',
    phase: 'tool',
    toolKind: 'shell',
    lastSignalAt: 1_000_000,
    ...overrides,
  }
}

test('trip time clamps into 4-10 s by scaling speed', () => {
  // A short hop still takes the minimum: a slow amble, never a teleport.
  assert.equal(tripDurationMs(3), TRIP_MIN_MS)
  assert.equal(tripDurationMs(0), TRIP_MIN_MS)
  // A mid-length walk at the brisk baseline is unclamped.
  assert.equal(tripDurationMs(21), 7000)
  // A city-spanning trip caps at 10 s: a jog.
  assert.equal(tripDurationMs(300), TRIP_MAX_MS)
  assert.equal(tripDurationMs(31, 3), TRIP_MAX_MS)
  // Speed matches the clamped duration.
  assert.ok(Math.abs(tripSpeed(21) - 3) < 1e-9)
  assert.ok(Math.abs(tripSpeed(300) - 30) < 1e-9)
  assert.equal(TRIP_MIN_MS, 4000)
  assert.equal(TRIP_MAX_MS, 10_000)
})

test('dominance follows the window and breaks ties toward the recent', () => {
  const now = 1_000_000
  const history = [
    { toolKind: 'shell', at: now - 50_000 },
    { toolKind: 'shell', at: now - 40_000 },
    { toolKind: 'test', at: now - 10_000 },
  ]
  assert.equal(dominantToolKind(history, now), 'shell')
  const recent = [
    { toolKind: 'shell', at: now - 50_000 },
    { toolKind: 'test', at: now - 10_000 },
    { toolKind: 'test', at: now - 5_000 },
  ]
  assert.equal(dominantToolKind(recent, now), 'test')
  // Samples older than the window are forgotten.
  const stale = [{ toolKind: 'ship', at: now - DOMINANCE_WINDOW_MS - 1 }]
  assert.equal(dominantToolKind(stale, now), undefined)
  assert.equal(dominantToolKind([], now), undefined)
})

test('dwell gates departures so workers never ping-pong', () => {
  const arrivedAt = 500_000
  assert.equal(canLeaveSpot(arrivedAt, arrivedAt + DWELL_MIN_MS - 1), false)
  assert.equal(canLeaveSpot(arrivedAt, arrivedAt + DWELL_MIN_MS), true)
  assert.equal(DWELL_MIN_MS, 20_000)
})

test('target district honours needs-input and historical first', () => {
  assert.equal(targetDistrict(cityAgent({ workState: 'needs-input', toolKind: 'shell' }), 'shell'), 'citadel')
  assert.equal(targetDistrict(cityAgent({ freshness: 'historical', toolKind: 'shell' }), 'shell'), 'gateway')
  assert.equal(targetDistrict(cityAgent({ toolKind: 'shell' }), 'test'), 'observatory')
  assert.equal(targetDistrict(cityAgent({ toolKind: 'shell' }), undefined), 'foundry')
  assert.equal(targetDistrict(cityAgent({ toolKind: undefined }), undefined), 'citadel')
})

test('ring slots are distinct, deterministic and grow past eight', () => {
  const center = [0, 20]
  const a = slotPosition(center, 0, 6)
  const b = slotPosition(center, 1, 6)
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 2, 'slots overlap')
  assert.deepEqual(slotPosition(center, 0, 6), slotPosition(center, 0, 6))
  const crowded = slotPosition(center, 0, 12)
  const roomy = slotPosition(center, 0, 6)
  assert.ok(Math.hypot(crowded[0] - center[0], crowded[1] - center[1]) > Math.hypot(roomy[0] - center[0], roomy[1] - center[1]))
})

test('slot assignment is stable in id order and children attach to parents', () => {
  const agents = [
    cityAgent({ id: 'codex:b' }),
    cityAgent({ id: 'codex:a' }),
    cityAgent({ id: 'codex:a-1', parentId: 'codex:a', depth: 1 }),
  ]
  const slots = assignDistrictSlots(agents)
  assert.equal(slots.get('codex:a')?.slot, 0)
  assert.equal(slots.get('codex:b')?.slot, 1)
  assert.equal(slots.get('codex:a')?.total, 2)
  assert.equal(slots.get('codex:a-1')?.district, slots.get('codex:a')?.district)
})

test('layout targets put roots on rings and children beside parents', () => {
  const agents = [
    cityAgent({ id: 'codex:a', toolKind: 'shell' }),
    cityAgent({ id: 'codex:a-1', parentId: 'codex:a', depth: 1, toolKind: 'search' }),
  ]
  const targets = layoutTargets(agents, CENTERS)
  const parent = targets.get('codex:a')
  const child = targets.get('codex:a-1')
  assert.ok(parent && child)
  assert.deepEqual([parent.x, parent.z], slotPosition(CENTERS.foundry, 0, 1))
  const [ox, oz] = childOffset(0, 1)
  assert.ok(Math.abs(child.x - parent.x - ox) < 1e-9)
  assert.ok(Math.abs(child.z - parent.z - oz) < 1e-9)
})

test('render cap prefers needs-input, then fresh, then stale; historical never renders', () => {
  const agents = []
  for (let i = 0; i < MAX_RENDERED_WORKERS + 6; i += 1) {
    agents.push(cityAgent({ id: `codex:fresh-${i}`, lastSignalAt: 1_000_000 + i }))
  }
  agents.push(cityAgent({ id: 'codex:need', workState: 'needs-input', lastSignalAt: 1 }))
  agents.push(cityAgent({ id: 'codex:stale', freshness: 'stale', lastSignalAt: 2_000_000 }))
  agents.push(cityAgent({ id: 'codex:past', freshness: 'historical', lastSignalAt: 3_000_000 }))
  const { rendered, overflow } = selectRendered(agents)
  assert.equal(rendered.length, MAX_RENDERED_WORKERS)
  assert.ok(rendered.some((agent) => agent.id === 'codex:need'), 'needs-input must render first')
  assert.ok(!rendered.some((agent) => agent.id === 'codex:past'), 'historical must never render')
  assert.ok(!rendered.some((agent) => agent.id === 'codex:stale') || overflow.length > 0)
  assert.ok(overflow.every((agent) => agent.freshness !== 'historical'))
  assert.equal(renderPriority(cityAgent({ workState: 'needs-input' })), 0)
  assert.equal(renderPriority(cityAgent({})), 1)
  assert.equal(renderPriority(cityAgent({ freshness: 'stale' })), 2)
  assert.equal(renderPriority(cityAgent({ freshness: 'historical' })), 3)
})

test('gestures follow phase and tool kind immediately', () => {
  assert.equal(gestureForWorker(cityAgent({ toolKind: 'shell' })), 'hammer')
  assert.equal(gestureForWorker(cityAgent({ toolKind: 'edit' })), 'hammer')
  assert.equal(gestureForWorker(cityAgent({ toolKind: 'read' })), 'scroll')
  assert.equal(gestureForWorker(cityAgent({ toolKind: 'search' })), 'scroll')
  assert.equal(gestureForWorker(cityAgent({ toolKind: 'test' })), 'telescope')
  assert.equal(gestureForWorker(cityAgent({ toolKind: 'web' })), 'telescope')
  assert.equal(gestureForWorker(cityAgent({ toolKind: 'ship' })), 'crate')
  assert.equal(gestureForWorker(cityAgent({ toolKind: 'delegate' })), 'banner')
  assert.equal(gestureForWorker(cityAgent({ phase: 'thinking', toolKind: 'shell' })), 'think')
  assert.equal(gestureForWorker(cityAgent({ phase: 'talking', toolKind: 'shell' })), 'talk')
  assert.equal(gestureForWorker(cityAgent({ phase: 'gap', toolKind: 'shell' })), 'idle')
  assert.equal(gestureForWorker(cityAgent({ freshness: 'stale', toolKind: 'shell' })), 'sit')
  assert.equal(gestureForWorker(cityAgent({ freshness: 'historical' })), 'idle')
})

test('status rings use the five semantic colors in priority order', () => {
  assert.equal(ringFor(cityAgent({}), true), 'accent')
  assert.equal(ringFor(cityAgent({ workState: 'needs-input' }), false), 'warning')
  assert.equal(ringFor(cityAgent({ freshness: 'stale' }), false), 'muted')
  assert.equal(ringFor(cityAgent({ phase: 'thinking' }), false), 'info')
  assert.equal(ringFor(cityAgent({ phase: 'talking' }), false), 'info')
  assert.equal(ringFor(cityAgent({}), false), 'success')
  assert.equal(ringFor(cityAgent({ workState: 'waiting' }), false), 'muted')
})

test('only on-screen historical agents walk out, so faded or never-seen ones never respawn', () => {
  const now = 10_000_000
  const old = (id, ageMs) => ({ id, freshness: 'historical', lastSignalAt: now - ageMs })
  const agents = [old('a', 30 * 60_000), old('b', 40 * 60_000), old('c', 50 * 60_000), { id: 'd', freshness: 'fresh', lastSignalAt: now }]
  assert.deepEqual(selectLeaving(agents, new Set(), 6), [])
  assert.deepEqual(selectLeaving(agents, new Set(['b', 'c', 'd']), 6).map((agent) => agent.id), ['b', 'c'])
  assert.deepEqual(selectLeaving(agents, new Set(['a', 'b', 'c']), 2).map((agent) => agent.id), ['a', 'b'])
})

test('ribbon points follow the remaining route and cap at a short hint', () => {
  assert.ok(RIBBON_MAX_POINTS >= 4 && RIBBON_MAX_POINTS <= 12)
  assert.deepEqual(ribbonPointsFromRoute([0, 0], []), [[0, 0]])
  assert.deepEqual(
    ribbonPointsFromRoute([0, 0], [[1, 0], [2, 0], [3, 0]]),
    [[0, 0], [1, 0], [2, 0], [3, 0]],
  )
  const long = Array.from({ length: 40 }, (_, i) => [i + 1, 0])
  const capped = ribbonPointsFromRoute([0, 0], long)
  assert.equal(capped.length, RIBBON_MAX_POINTS)
  assert.deepEqual(capped[0], [0, 0])
  assert.deepEqual(capped[capped.length - 1], [RIBBON_MAX_POINTS - 1, 0])
  // The scene reuses one scratch array per frame: out is truncated in place.
  const scratch = [[9, 9], [9, 9], [9, 9]]
  const reused = ribbonPointsFromRoute([5, 5], [[6, 6]], 9, scratch)
  assert.equal(reused, scratch)
  assert.deepEqual(reused, [[5, 5], [6, 6]])
  assert.deepEqual(ribbonPointsFromRoute([0, 0], [[1, 1]], 0), [])
  assert.deepEqual(ribbonPointsFromRoute([0, 0], [[1, 1]], 1), [[0, 0]])
})

test('overflow ring sits outside the work ring at the plaza edge', () => {
  assert.ok(OVERFLOW_RING_R > SLOT_RING_R)
  const center = [0, 20]
  const inner = slotPosition(center, 0, 1)
  const outer = overflowSlotPosition(center, 0, 1)
  const innerR = Math.hypot(inner[0] - center[0], inner[1] - center[1])
  const outerR = Math.hypot(outer[0] - center[0], outer[1] - center[1])
  assert.ok(Math.abs(innerR - SLOT_RING_R) < 1e-9)
  assert.ok(Math.abs(outerR - OVERFLOW_RING_R) < 1e-9)
  assert.ok(outerR - innerR > 2)
  const a = overflowSlotPosition(center, 0, 6)
  const b = overflowSlotPosition(center, 1, 6)
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 2, 'overflow slots overlap')
  assert.deepEqual(a, overflowSlotPosition(center, 0, 6))
})

test('overflow slots group by district in id order', () => {
  const agents = [
    cityAgent({ id: 'codex:b', toolKind: 'shell' }),
    cityAgent({ id: 'codex:a', toolKind: 'shell' }),
    cityAgent({ id: 'codex:c', toolKind: 'read' }),
  ]
  const slots = assignOverflowSlots(agents)
  assert.equal(slots.get('codex:a')?.slot, 0)
  assert.equal(slots.get('codex:b')?.slot, 1)
  assert.equal(slots.get('codex:a')?.total, 2)
  assert.equal(slots.get('codex:c')?.district, 'archive')
  assert.equal(slots.get('codex:a')?.district, 'foundry')
})

test('overflow targets land on the outer ring per district', () => {
  const agents = [
    cityAgent({ id: 'codex:a', toolKind: 'shell' }),
    cityAgent({ id: 'codex:b', toolKind: 'shell' }),
  ]
  const targets = overflowTargets(agents, CENTERS)
  for (const [id, target] of targets) {
    const center = CENTERS[target.district]
    const radius = Math.hypot(target.x - center[0], target.z - center[1])
    assert.ok(Math.abs(radius - OVERFLOW_RING_R) < 1e-9, `${id} not on the outer ring`)
  }
  assert.equal(targets.get('codex:a')?.district, 'foundry')
  // Deterministic across calls.
  assert.deepEqual([...overflowTargets(agents, CENTERS).keys()], [...targets.keys()])
})
