import test from 'node:test'
import assert from 'node:assert/strict'
import { mapOpenCodeEvent, mapOpenCodeSession, workStateForSession } from './opencode.mjs'
import { normalizePath } from './scope.mjs'

const scopeSet = new Set([normalizePath('/work/city-demo'), normalizePath('/work/city-demo-worktree')])
const NOW = 1_767_225_600_000

function session(overrides = {}) {
  return {
    id: 'sess-1',
    title: 'Demo session',
    status: 'active',
    model: 'demo-model',
    directory: '/work/city-demo',
    location: { directory: '/work/city-demo' },
    time: { updated: NOW, created: NOW - 60_000 },
    ...overrides,
  }
}

test('event types map to phase and tool kind', () => {
  assert.deepEqual(mapOpenCodeEvent('tool.execute.before', 'Edit'), { phase: 'tool', toolKind: 'edit' })
  assert.deepEqual(mapOpenCodeEvent('tool.execute.after', 'Edit'), { phase: 'gap', toolKind: 'edit' })
  assert.deepEqual(mapOpenCodeEvent('tool.execute.before', 'Bash', 'git push'), { phase: 'tool', toolKind: 'ship' })
  assert.deepEqual(mapOpenCodeEvent('session.idle'), { phase: 'idle', toolKind: undefined })
  assert.deepEqual(mapOpenCodeEvent('session.error'), { phase: 'idle', toolKind: undefined })
  assert.deepEqual(mapOpenCodeEvent('session.status'), { phase: 'gap', toolKind: undefined })
})

test('session outcomes map without failed leaking into work state', () => {
  assert.equal(workStateForSession(session({ outcome: 'failed' })), 'unknown')
  assert.equal(workStateForSession(session({ outcome: 'succeeded' })), 'complete')
  assert.equal(workStateForSession(session({ outcome: 'cancelled' })), 'waiting')
  assert.equal(workStateForSession(session({ status: 'active' })), 'active')
  assert.equal(workStateForSession(session({ status: 'blocked' })), 'needs-input')
  assert.equal(workStateForSession(session({ status: 'weird-future' })), 'unknown')
})

test('scope filtering is exact for OpenCode sessions', () => {
  const inScope = mapOpenCodeSession(session(), scopeSet, NOW)
  assert.ok(inScope)
  assert.equal(inScope.workspace, 'city-demo')
  assert.equal(inScope.id, 'opencode:sess-1')

  const sameBasenameElsewhere = mapOpenCodeSession(
    session({ id: 'sess-2', directory: '/other/city-demo', location: { directory: '/other/city-demo' } }),
    scopeSet,
    NOW,
  )
  assert.equal(sameBasenameElsewhere, null)

  const worktree = mapOpenCodeSession(
    session({ id: 'sess-3', directory: '/work/city-demo-worktree', location: { directory: '/work/city-demo-worktree' } }),
    scopeSet,
    NOW,
  )
  assert.ok(worktree)
})

test('active sessions without tool evidence read as gap, never frozen', () => {
  const agent = mapOpenCodeSession(session({ status: 'active' }), scopeSet, NOW)
  assert.equal(agent.phase, 'gap')
  assert.equal(agent.workState, 'active')
  assert.equal(agent.freshness, 'fresh')
  // Raw session fields never leak into the agent.
  assert.equal('directory' in agent, false)
  assert.equal('location' in agent, false)
})
