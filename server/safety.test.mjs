import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeStatus, safeActivity } from './safety.mjs'

test('unknown provider status never becomes active', () => {
  assert.notEqual(normalizeStatus('notLoaded'), 'active')
})

test('provider activity is flattened and bounded before reaching the browser', () => {
  const value = safeActivity(`line one\nline two\t${'x'.repeat(160)}`, 'fallback')
  assert.equal(value.includes('\n'), false)
  assert.equal(value.length, 120)
})
