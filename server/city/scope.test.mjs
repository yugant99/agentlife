import test from 'node:test'
import assert from 'node:assert/strict'
import { cwdInScopeSet, normalizePath, parseWorktreePorcelain, shortName, workspaceFor } from './scope.mjs'

test('worktree porcelain parses worktree lines only', () => {
  const text = 'worktree /work/city-demo\nHEAD abc\nbranch refs/heads/main\n\nworktree /work/city-demo-worktree\nHEAD def\n'
  assert.deepEqual(parseWorktreePorcelain(text), ['/work/city-demo', '/work/city-demo-worktree'])
  assert.deepEqual(parseWorktreePorcelain(''), [])
})

test('scope membership is exact, never basename matching', () => {
  const scopeSet = new Set([normalizePath('/work/city-demo'), normalizePath('/work/city-demo-worktree')])
  assert.equal(cwdInScopeSet('/work/city-demo', scopeSet), true)
  assert.equal(cwdInScopeSet('/work/city-demo-worktree', scopeSet), true)
  // Same basename elsewhere must not belong.
  assert.equal(cwdInScopeSet('/other/city-demo', scopeSet), false)
  assert.equal(cwdInScopeSet('/work/city-demo/subdir', scopeSet), false)
  assert.equal(cwdInScopeSet('', scopeSet), false)
  assert.equal(cwdInScopeSet('/work/city-demo', new Set()), false)
})

test('workspace is a basename, never a full path', () => {
  assert.equal(workspaceFor('/work/city-demo'), 'city-demo')
  assert.equal(workspaceFor('/work/city-demo-worktree'), 'city-demo-worktree')
  assert.equal(workspaceFor(''), 'unknown')
  const workspace = workspaceFor('/work/city-demo')
  assert.equal(workspace.includes('/'), false)
})

test('display names truncate to 40 chars', () => {
  assert.equal(shortName('  hello\nworld  ', 'fallback'), 'hello world')
  assert.equal(shortName('', 'fallback'), 'fallback')
  assert.equal(shortName('x'.repeat(100), 'fallback').length, 40)
})

test('worktrees that reuse the repo folder name are labelled by their worktree folder', () => {
  assert.equal(workspaceFor('/work/demo', 'unknown', '/work/demo'), 'demo')
  assert.equal(workspaceFor('/trees/lane-a/demo', 'unknown', '/work/demo'), 'lane-a')
  assert.equal(workspaceFor('/trees/other-repo', 'unknown', '/work/demo'), 'other-repo')
})

