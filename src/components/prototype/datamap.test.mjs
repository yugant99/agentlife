import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DATAMAP_ROWS,
  MAPPING_ROWS,
  cityCounts,
  compareUrgency,
  formatAge,
  overflowLabel,
  truthCard,
  urgencySort,
} from './datamap.ts'

const AGENT_FIELDS = new Set([
  'id',
  'provider',
  'source',
  'parentId',
  'depth',
  'name',
  'role',
  'model',
  'workspace',
  'workState',
  'freshness',
  'phase',
  'toolKind',
  'lastSignalAt',
  'startedAt',
])

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

test('every datamap row names a real CityAgent field', () => {
  assert.ok(Array.isArray(DATAMAP_ROWS) && DATAMAP_ROWS.length >= 10, 'table must list visual channels')
  assert.equal(MAPPING_ROWS, DATAMAP_ROWS)
  for (const row of DATAMAP_ROWS) {
    assert.ok(typeof row.channel === 'string' && row.channel.length > 0, 'channel copy missing')
    assert.ok(Array.isArray(row.fields) && row.fields.length > 0, `${row.channel}: no fields`)
    for (const field of row.fields) {
      assert.ok(AGENT_FIELDS.has(field), `${row.channel}: ${String(field)} is not a CityAgent field`)
    }
    assert.ok(typeof row.rule === 'string' && row.rule.length > 0, `${row.channel}: no rule`)
    assert.ok(typeof row.degrades === 'string' && row.degrades.length > 0, `${row.channel}: no degrade note`)
  }
})

test('the table covers the label-versus-glow split and the walk lag', () => {
  const copy = DATAMAP_ROWS.map((row) => `${row.channel} ${row.rule} ${row.degrades}`.toLowerCase()).join('\n')
  assert.ok(copy.includes('assigned'), 'must define label=assigned')
  assert.ok(copy.includes('active'), 'must define glow=active')
  assert.ok(copy.includes('4-10'), 'must state the 4-10 s walk lag')
})

test('cityCounts splits working, needs-you and per-district assigned versus active', () => {
  const now = 1_700_000_000_000
  const agents = [
    agent({ id: 'codex:a1', workState: 'active', freshness: 'fresh', toolKind: 'shell', lastSignalAt: now - 1_000 }),
    agent({ id: 'codex:a2', workState: 'needs-input', freshness: 'fresh', toolKind: 'read', lastSignalAt: now - 2_000 }),
    agent({ id: 'codex:a3', workState: 'active', freshness: 'stale', toolKind: 'test', lastSignalAt: now - 300_000 }),
    agent({ id: 'codex:a4', workState: 'active', freshness: 'historical', toolKind: 'read', lastSignalAt: now - 2_000_000 }),
    agent({ id: 'codex:a5', workState: 'complete', freshness: 'fresh', toolKind: 'edit', lastSignalAt: now - 3_000 }),
  ]
  const counts = cityCounts(agents)
  assert.equal(counts.working, 1)
  assert.equal(counts.needsYou, 1)
  assert.equal(counts.complete, 1)
  assert.equal(counts.total, 5)
  // Foundry holds the two shell/edit workers; only the fresh active one glows.
  assert.deepEqual(counts.byDistrict.foundry, { assigned: 2, active: 1 })
  // Needs-input walks to the Citadel regardless of its read tool.
  assert.deepEqual(counts.byDistrict.citadel, { assigned: 1, active: 0 })
  // Stale still counts as assigned but never as active.
  assert.deepEqual(counts.byDistrict.observatory, { assigned: 1, active: 0 })
  assert.equal(counts.byDistrict.archive.assigned + counts.byDistrict.port.assigned + counts.byDistrict.gateway.assigned, 0)
  // Historical agents are past: neither assigned nor active anywhere.
  const assignedTotal = Object.values(counts.byDistrict).reduce((sum, d) => sum + d.assigned, 0)
  assert.equal(assignedTotal, 4)
})

test('urgencySort puts fresh needs-input longest wait first, then fresh, then stale', () => {
  const base = 1_700_000_000_000
  const oldest = agent({ id: 'codex:old', workState: 'needs-input', freshness: 'fresh', lastSignalAt: base - 60_000 })
  const newest = agent({ id: 'codex:new', workState: 'needs-input', freshness: 'fresh', lastSignalAt: base - 5_000 })
  const fresh = agent({ id: 'codex:fresh', workState: 'active', freshness: 'fresh', lastSignalAt: base - 60_000 })
  const stale = agent({ id: 'codex:stale', workState: 'active', freshness: 'stale', lastSignalAt: base - 500_000 })
  const past = agent({ id: 'codex:past', workState: 'active', freshness: 'historical', lastSignalAt: base - 2_000_000 })
  const input = [stale, fresh, newest, past, oldest]
  const sorted = urgencySort(input)
  assert.deepEqual(sorted.map((a) => a.id), ['codex:old', 'codex:new', 'codex:fresh', 'codex:stale', 'codex:past'])
  // Never mutates the input.
  assert.deepEqual(input.map((a) => a.id), ['codex:stale', 'codex:fresh', 'codex:new', 'codex:past', 'codex:old'])
  assert.ok(compareUrgency(oldest, newest) < 0)
  assert.ok(compareUrgency(newest, fresh) < 0)
  assert.ok(compareUrgency(fresh, stale) < 0)
})

test('urgencySort tie-breaks equal waits by id', () => {
  const base = 1_700_000_000_000
  const b = agent({ id: 'codex:b', workState: 'needs-input', freshness: 'fresh', lastSignalAt: base - 1_000 })
  const a = agent({ id: 'codex:a', workState: 'needs-input', freshness: 'fresh', lastSignalAt: base - 1_000 })
  assert.deepEqual(urgencySort([b, a]).map((x) => x.id), ['codex:a', 'codex:b'])
})

test('overflowLabel reads "3 shown +2 more"', () => {
  assert.equal(overflowLabel(3, 5), '3 shown +2 more')
  assert.equal(overflowLabel(5, 5), '5 shown')
  assert.equal(overflowLabel(0, 0), '0 shown')
  assert.equal(overflowLabel(2, 3), '2 shown +1 more')
})

test('formatAge matches the HUD wait copy', () => {
  assert.equal(formatAge(1_000), 'just now')
  assert.equal(formatAge(30_000), '30s ago')
  assert.equal(formatAge(120_000), '2m ago')
})

test('truthCard covers every workState', () => {
  const now = 1_700_000_000_000
  const cases = {
    active: agent({ workState: 'active', phase: 'tool', toolKind: 'shell', freshness: 'fresh', lastSignalAt: now - 20_000, startedAt: now - 600_000 }),
    'needs-input': agent({ workState: 'needs-input', phase: 'idle', toolKind: 'ask', freshness: 'fresh', lastSignalAt: now - 360_000, startedAt: now - 600_000 }),
    waiting: agent({ workState: 'waiting', phase: 'idle', freshness: 'fresh', lastSignalAt: now - 20_000 }),
    complete: agent({ workState: 'complete', phase: 'idle', toolKind: 'read', freshness: 'fresh', lastSignalAt: now - 20_000 }),
    unknown: agent({ workState: 'unknown', phase: 'idle', freshness: 'fresh', lastSignalAt: now - 20_000 }),
  }
  for (const [workState, input] of Object.entries(cases)) {
    const card = truthCard(input, now)
    assert.ok(card.doing.length > 0 && card.where.length > 0 && card.since.length > 0 && card.next.length > 0, `${workState}: empty card line`)
    assert.ok(card.since.includes('last signal'), `${workState}: since must carry signal age`)
  }
  assert.match(truthCard(cases.active, now).doing, /Working/i)
  assert.match(truthCard(cases.active, now).next, /let them work/i)
  const needy = truthCard(cases['needs-input'], now)
  assert.match(needy.doing, /Needs you/i)
  assert.match(needy.where, /Citadel/i)
  assert.match(needy.next, /blocked on you/i)
  assert.match(truthCard(cases.waiting, now).next, /waiting on its own work/i)
  assert.match(truthCard(cases.complete, now).next, /filed/i)
  assert.match(truthCard(cases.unknown, now).doing, /Unknown/i)
})

test('truthCard derives where, since and next from freshness and clocks', () => {
  const now = 1_700_000_000_000
  const stale = truthCard(
    agent({ workState: 'active', phase: 'tool', toolKind: 'shell', freshness: 'stale', lastSignalAt: now - 300_000, startedAt: now - 900_000 }),
    now,
  )
  assert.match(stale.doing, /Stale/i)
  assert.match(stale.next, /stale/i)
  const past = truthCard(
    agent({ workState: 'active', phase: 'idle', freshness: 'historical', lastSignalAt: now - 2_000_000 }),
    now,
  )
  assert.match(past.doing, /Past/i)
  assert.match(past.next, /archived/i)
  const noStart = truthCard(
    agent({ workState: 'active', phase: 'tool', toolKind: 'shell', freshness: 'fresh', lastSignalAt: now - 1_000, startedAt: undefined }),
    now,
  )
  assert.ok(!noStart.since.includes('working'), 'missing startedAt must omit duration')
})
