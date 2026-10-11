import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyCommand, toolKindForCodexItem, toolKindForToolName } from './classify.mjs'

test('ship commands classify by first tokens', () => {
  assert.equal(classifyCommand('git commit -m demo'), 'ship')
  assert.equal(classifyCommand('git push origin main'), 'ship')
  assert.equal(classifyCommand('  gh pr create --fill'), 'ship')
  assert.equal(classifyCommand('sudo git commit -m demo'), 'ship')
})

test('test runners classify, everything else is shell', () => {
  assert.equal(classifyCommand('npm test -- filter'), 'test')
  assert.equal(classifyCommand('node --test server/'), 'test')
  assert.equal(classifyCommand('pytest -q'), 'test')
  assert.equal(classifyCommand('vitest run'), 'test')
  assert.equal(classifyCommand('jest src/'), 'test')
  assert.equal(classifyCommand('go test ./...'), 'test')
  assert.equal(classifyCommand('cargo test'), 'test')
  assert.equal(classifyCommand('npx vitest run'), 'test')
  assert.equal(classifyCommand('ls -la'), 'shell')
  assert.equal(classifyCommand(''), 'shell')
  assert.equal(classifyCommand(null), 'shell')
})

test('claude tool names map without leaking input', () => {
  assert.equal(toolKindForToolName('Bash', 'npm test'), 'test')
  assert.equal(toolKindForToolName('Bash', 'git push'), 'ship')
  assert.equal(toolKindForToolName('Bash', 'ls'), 'shell')
  assert.equal(toolKindForToolName('Edit', 'anything'), 'edit')
  assert.equal(toolKindForToolName('Write', ''), 'edit')
  assert.equal(toolKindForToolName('Read', ''), 'read')
  assert.equal(toolKindForToolName('Grep', ''), 'search')
  assert.equal(toolKindForToolName('WebFetch', ''), 'web')
  assert.equal(toolKindForToolName('Agent', ''), 'delegate')
  assert.equal(toolKindForToolName('AskUserQuestion', ''), 'ask')
  assert.equal(toolKindForToolName('mcp__browser__navigate', ''), 'web')
  assert.equal(toolKindForToolName('TotallyNewTool', ''), 'other')
})

test('codex item types map, messages carry no tool', () => {
  assert.equal(toolKindForCodexItem('CommandExecution', 'pytest -q'), 'test')
  assert.equal(toolKindForCodexItem('CommandExecution', 'git commit -m x'), 'ship')
  assert.equal(toolKindForCodexItem('FileChange', ''), 'edit')
  assert.equal(toolKindForCodexItem('McpToolCall', '', 'browser-navigate'), 'web')
  assert.equal(toolKindForCodexItem('Reasoning', ''), undefined)
  assert.equal(toolKindForCodexItem('AgentMessage', ''), undefined)
})
