import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeCitySnapshot, sanitizeAgent } from './snapshot.mjs'

const NOW = 1_767_225_600_000
const FRESH_MS = 90_000
const STALE_MS = 20 * 60_000

function agent(overrides = {}) {
  return {
    id: 'codex:demo-1',
    provider: 'codex',
    source: 'live',
    depth: 0,
    name: 'Demo',
    workspace: 'city-demo',
    workState: 'active',
    phase: 'tool',
    toolKind: 'shell',
    lastSignalAt: NOW,
    ...overrides,
  }
}

test('freshness thresholds are fixed', () => {
  assert.equal(mergeCitySnapshot([{ agents: [agent({ lastSignalAt: NOW })], diagnostic: { provider: 'codex', state: 'connected', message: 'ok' } }], NOW).agents[0].freshness, 'fresh')
  assert.equal(mergeCitySnapshot([{ agents: [agent({ lastSignalAt: NOW - FRESH_MS })], diagnostic: { provider: 'codex', state: 'connected', message: 'ok' } }], NOW).agents[0].freshness, 'fresh')
  assert.equal(mergeCitySnapshot([{ agents: [agent({ lastSignalAt: NOW - FRESH_MS - 1 })], diagnostic: { provider: 'codex', state: 'connected', message: 'ok' } }], NOW).agents[0].freshness, 'stale')
  assert.equal(mergeCitySnapshot([{ agents: [agent({ lastSignalAt: NOW - STALE_MS })], diagnostic: { provider: 'codex', state: 'connected', message: 'ok' } }], NOW).agents[0].freshness, 'stale')
  assert.equal(mergeCitySnapshot([{ agents: [agent({ lastSignalAt: NOW - STALE_MS - 1 })], diagnostic: { provider: 'codex', state: 'connected', message: 'ok' } }], NOW).agents[0].freshness, 'historical')
})

test('only CityAgent fields survive; forbidden fields never appear', () => {
  const dirty = agent({
    command: 'git push origin main',
    prompt: 'synthetic prompt',
    description: 'SECRET-DESCRIPTION-MUST-NOT-LEAK',
    cwd: '/work/city-demo',
    path: '/work/city-demo/file.ts',
    input: { command: 'rm -rf /' },
    output: 'synthetic output',
    content: 'synthetic content',
  })
  const snapshot = mergeCitySnapshot([{ agents: [dirty], diagnostic: { provider: 'codex', state: 'connected', message: 'ok' } }], NOW)
  const text = JSON.stringify(snapshot)
  for (const forbidden of ['git push origin main', 'synthetic prompt', 'SECRET-DESCRIPTION', '/work/city-demo', 'synthetic output', 'synthetic content']) {
    assert.equal(text.includes(forbidden), false, `snapshot leaks ${forbidden}`)
  }
  assert.deepEqual(Object.keys(snapshot.agents[0]).sort(), Object.keys(snapshot.agents[0]).sort().filter((key) =>
    ['id', 'provider', 'source', 'parentId', 'depth', 'name', 'role', 'model', 'workspace', 'workState', 'freshness', 'phase', 'toolKind', 'lastSignalAt', 'startedAt'].includes(key)))
})

test('names truncate, workspaces stay basenames, ids stay scoped', () => {
  assert.equal(sanitizeAgent(agent({ name: 'x'.repeat(100) }), NOW).name.length, 40)
  assert.equal(sanitizeAgent(agent({ workspace: '/work/city-demo' }), NOW), null)
  assert.equal(sanitizeAgent(agent({ id: 'wrong:demo' }), NOW), null)
  assert.equal(sanitizeAgent(agent({ provider: 'unknown' }), NOW), null)
  // Parent links survive only when they differ from the agent id.
  assert.equal(sanitizeAgent(agent({ parentId: 'codex:parent' }), NOW).parentId, 'codex:parent')
  assert.equal('parentId' in sanitizeAgent(agent({ parentId: 'codex:demo-1' }), NOW), false)
})

test('snapshot shape is stable and sorted newest first', () => {
  const snapshot = mergeCitySnapshot([
    { agents: [agent({ id: 'codex:old', lastSignalAt: NOW - 1000 })], diagnostic: { provider: 'codex', state: 'connected', message: 'Codex session snapshot read.' } },
    { agents: [agent({ id: 'opencode:new', provider: 'opencode', lastSignalAt: NOW })], diagnostic: { provider: 'opencode', state: 'connected', message: 'OpenCode session snapshot read.' } },
  ], NOW)
  assert.equal(snapshot.source, 'live')
  assert.equal(typeof snapshot.generatedAt, 'number')
  assert.deepEqual(snapshot.agents.map((entry) => entry.id), ['opencode:new', 'codex:old'])
  assert.equal(snapshot.diagnostics.length, 2)
})
