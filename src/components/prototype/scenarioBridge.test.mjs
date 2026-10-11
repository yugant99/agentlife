import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveFreshness } from './agentModel.ts'
import { applyStep, createScenario, scenarioLength } from './scenario.ts'
import {
  cityAttentionQueue,
  cityCounts,
  cityIdFor,
  cityStatusLabel,
  nextAttentionCity,
  signalAgeFor,
  toCityAgents,
  toCitySnapshot,
} from './scenarioBridge.ts'

function runTo(index) {
  let state = createScenario()
  for (let i = 1; i <= index; i += 1) state = applyStep(state, i)
  return state
}

const NOW = 1_700_000_000_000

test('the bridge maps every fixture field onto the frozen contract', () => {
  const agents = toCityAgents(createScenario(), NOW)
  assert.equal(agents.length, 5)
  for (const agent of agents) {
    assert.equal(agent.source, 'simulation')
    assert.ok(agent.id.includes(':'), `id is not provider-scoped: ${agent.id}`)
    assert.ok(agent.name.length <= 40)
    assert.ok(!agent.workspace.includes('/'), 'workspace must be a basename, never a path')
    // The synthetic ages round-trip through the contract freshness thresholds.
    assert.equal(deriveFreshness(agent.lastSignalAt, NOW), agent.freshness)
    assert.ok(agent.lastSignalAt <= NOW)
  }
  const bjorn = agents.find((agent) => agent.id === 'codex:bjorn')
  assert.ok(bjorn)
  assert.equal(bjorn.toolKind, 'shell')
  assert.equal(bjorn.phase, 'tool')
  assert.equal(bjorn.depth, 0)
  assert.equal(bjorn.parentId, undefined)
})

test('the script covers arrival, tool walks, sub-agents, citadel waits, sitting and leaving', () => {
  const full = runTo(scenarioLength() - 1)
  const agents = toCityAgents(full, NOW)
  const byNative = new Map(full.agents.map((agent) => [agent.id, agent]))

  // Arrival at the Gateway.
  assert.ok(byNative.has('yrsa'), 'no arrival step')
  // Tool changes that cause walks.
  assert.equal(byNative.get('bjorn')?.toolKind, 'test')
  assert.equal(byNative.get('astrid')?.toolKind, 'ship')
  // A sub-agent spawning beside its parent.
  const loom = byNative.get('loom')
  assert.ok(loom)
  assert.equal(loom.parentId, 'bjorn')
  assert.equal(loom.depth, 1)
  const loomCity = agents.find((agent) => agent.id === cityIdFor('codex', 'loom'))
  assert.ok(loomCity)
  assert.equal(loomCity.parentId, cityIdFor('codex', 'bjorn'))
  // Needs-input walks to the Citadel steps.
  assert.equal(byNative.get('sigrid')?.workState, 'needs-input')
  // Stale sits down.
  assert.equal(byNative.get('eirik')?.freshness, 'stale')
  // Historical walks out the Gateway and fades.
  assert.equal(byNative.get('halvard')?.freshness, 'historical')
  // Provenance stays simulation across every step.
  assert.ok(agents.every((agent) => agent.source === 'simulation'))
})

test('ship steps log one boat each and never replay', () => {
  const full = runTo(scenarioLength() - 1)
  assert.deepEqual(full.ships, ['astrid'])
  const again = applyStep(full, scenarioLength() - 1)
  assert.deepEqual(again.ships, ['astrid'])
  const shipStep = full.step
  void shipStep
})

test('counts and status copy keep work state and freshness apart', () => {
  const agents = toCityAgents(createScenario(), NOW)
  const counts = cityCounts(agents)
  assert.deepEqual(counts, { working: 2, needsYou: 1, complete: 1, total: 5 })
  assert.equal(cityStatusLabel(agents.find((a) => a.workState === 'unknown')), 'Unknown · no heartbeat')
  assert.equal(cityStatusLabel({ workState: 'active', freshness: 'stale' }), 'Stale snapshot · last active')
  assert.equal(cityStatusLabel({ workState: 'active', freshness: 'historical' }), 'Past · walked out the gate')
  assert.equal(cityStatusLabel({ workState: 'needs-input', freshness: 'fresh' }), 'Needs you')
})

test('city attention cycles in stable snapshot order and wraps', () => {
  const agents = toCityAgents(createScenario(), NOW)
  const queue = cityAttentionQueue(agents)
  assert.equal(queue.length, 1)
  assert.equal(nextAttentionCity(agents), queue[0].id)
  assert.equal(nextAttentionCity(agents, queue[0].id), queue[0].id)
  assert.equal(nextAttentionCity([]), undefined)
})

test('snapshots carry the simulation source and no diagnostics', () => {
  const snapshot = toCitySnapshot(createScenario(), NOW)
  assert.equal(snapshot.source, 'simulation')
  assert.equal(snapshot.generatedAt, NOW)
  assert.equal(snapshot.agents.length, 5)
  assert.deepEqual(snapshot.diagnostics, [])
})

test('synthetic ages sit inside the contract windows', () => {
  assert.ok(signalAgeFor('fresh') <= 90_000)
  assert.ok(signalAgeFor('stale') > 90_000 && signalAgeFor('stale') <= 20 * 60_000)
  assert.ok(signalAgeFor('historical') > 20 * 60_000)
})
