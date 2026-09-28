import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SCENARIO_STEPS,
  advanceScenario,
  applyStep,
  attentionQueue,
  canPerformWork,
  createScenario,
  gestureFor,
  isFinished,
  resetScenario,
  scenarioCounts,
  scenarioLength,
  selectNextAttention,
  statusLabel,
} from './scenario.ts'

// Runs the deterministic timeline up to (and including) a step index.
function runTo(index) {
  let state = createScenario()
  for (let i = 1; i <= index; i += 1) state = applyStep(state, i)
  return state
}

test('the initial cast is diverse and deterministic', () => {
  const state = createScenario()
  const counts = scenarioCounts(state)
  assert.equal(counts.total, 5)
  assert.equal(counts.working, 2)
  assert.equal(counts.needsYou, 1)
  assert.equal(counts.complete, 1)
  assert.equal(state.agents.filter((agent) => agent.workState === 'unknown').length, 1)
  // Every fixture record is explicitly a simulation, and provider is only an example.
  assert.ok(state.agents.every((agent) => agent.source === 'simulation'))
  // A baseline completed agent is present but is not a fresh event.
  assert.equal(state.celebrations.length, 0)
  assert.deepEqual(state, resetScenario())
})

test('stale disables work and is not a work state', () => {
  const staleStep = SCENARIO_STEPS.findIndex((step) => step.changes.some((change) => change.freshness === 'stale'))
  assert.ok(staleStep > 0)
  const before = runTo(staleStep - 1)
  const state = runTo(staleStep)
  const agent = state.agents.find((entry) => entry.freshness === 'stale')
  assert.ok(agent)
  // The work state is untouched by staleness: it still reports the last known work.
  assert.equal(agent.workState, 'active')
  assert.equal(canPerformWork(agent), false)
  assert.equal(gestureFor(agent), 'idle')
  // A stale snapshot drops out of the working count.
  assert.equal(scenarioCounts(state).working, scenarioCounts(before).working - 1)
})

test('an unknown heartbeat cannot work', () => {
  const state = createScenario()
  const unknown = state.agents.find((agent) => agent.workState === 'unknown')
  assert.ok(unknown)
  assert.equal(canPerformWork(unknown), false)
  assert.equal(gestureFor(unknown), 'idle')
  assert.match(statusLabel(unknown), /Unknown/)
})

test('a completion celebration fires once per real transition and never replays', () => {
  const completeStep = SCENARIO_STEPS.findIndex((step) => step.changes.some((change) => change.workState === 'complete'))
  assert.ok(completeStep > 0)
  const state = runTo(completeStep)
  assert.equal(state.celebrations.length, 1)

  // Re-applying an unchanged step on an already-complete agent must not re-emit.
  const again = applyStep(state, completeStep)
  assert.equal(again.celebrations.length, 1)
  assert.equal(again.celebrations[0].id, state.celebrations[0].id)

  // The baseline completed agent never enters the celebration log.
  assert.ok(!state.celebrations.some((celebration) => celebration.agentId === 'halvard'))

  // The whole deterministic run emits exactly one celebration per completion transition.
  const full = runTo(scenarioLength() - 1)
  assert.equal(full.celebrations.length, 2)
  assert.equal(new Set(full.celebrations.map((c) => c.agentId)).size, 2)
  // Provenance stays simulation across every step.
  assert.ok(full.agents.every((agent) => agent.source === 'simulation'))
})

test('replay resets to a fresh deterministic scenario', () => {
  const fresh = createScenario()
  const played = runTo(scenarioLength() - 1)
  assert.ok(played.celebrations.length > 0)

  const replayed = resetScenario()
  assert.deepEqual(replayed, fresh)
  assert.equal(replayed.step, 0)
  assert.equal(replayed.celebrations.length, 0)
  assert.equal(replayed.eventId, 0)

  // Replaying the same script yields byte-identical values, including event ids.
  assert.deepEqual(runTo(scenarioLength() - 1), played)
})

test('needs-you selection cycles eligible agents in stable order and wraps', () => {
  const state = createScenario()
  const queue = attentionQueue(state)
  assert.equal(queue.length, 1)
  assert.equal(selectNextAttention(state), queue[0].id)
  assert.equal(selectNextAttention(state, queue[0].id), queue[0].id)

  const two = { ...state, agents: state.agents.map((agent) => (agent.id === 'bjorn' ? { ...agent, workState: 'needs-input' } : agent)) }
  assert.deepEqual(attentionQueue(two).map((agent) => agent.id), ['bjorn', 'astrid'])
  assert.equal(selectNextAttention(two, 'bjorn'), 'astrid')
  assert.equal(selectNextAttention(two, 'astrid'), 'bjorn')

  const none = { ...state, agents: state.agents.map((agent) => ({ ...agent, workState: 'active' })) }
  assert.equal(selectNextAttention(none), undefined)
})

test('a finished scenario does not advance or re-emit', () => {
  let state = createScenario()
  while (!isFinished(state)) state = advanceScenario(state)
  assert.equal(advanceScenario(state), state)
})
