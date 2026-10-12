import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CREST_PALETTE,
  NEUTRAL_HUE,
  PROVIDER_KITS,
  PROVIDER_PALETTE,
  WORKSPACE_PENNANTS,
  basenameOf,
  crestForRole,
  dimHex,
  heraldryFor,
  kitForProvider,
  pennantForWorkspace,
  ticksForModel,
} from './heraldry.ts'

function agent(overrides = {}) {
  return {
    id: 'codex:bjorn',
    provider: 'codex',
    model: undefined,
    role: 'Forge lead',
    workspace: 'mythic-city',
    ...overrides,
  }
}

test('provider maps to a distinct silhouette and hue; manual stays unlit', () => {
  assert.deepEqual(kitForProvider('codex'), {
    silhouette: 'helm', hue: '#ff9b47', uniform: '#4a3a2c', lit: true,
  })
  assert.deepEqual(kitForProvider('claude-code'), {
    silhouette: 'hood', hue: '#6fd8b8', uniform: '#2c443c', lit: true,
  })
  assert.deepEqual(kitForProvider('opencode'), {
    silhouette: 'cap', hue: '#7fd0ff', uniform: '#2e3d4a', lit: true,
  })
  assert.deepEqual(kitForProvider('manual'), {
    silhouette: 'band', hue: '#8a8f96', uniform: '#3a3d42', lit: false,
  })
  // Colour-blind safe: every provider differs in shape AND hue, never hue alone.
  const kits = Object.values(PROVIDER_KITS)
  assert.equal(new Set(kits.map((kit) => kit.silhouette)).size, kits.length)
  assert.equal(new Set(kits.map((kit) => kit.hue)).size, kits.length)
})

test('model maps to 0-3 shoulder ticks', () => {
  assert.equal(ticksForModel(undefined), 0)
  assert.equal(ticksForModel(''), 0)
  assert.equal(ticksForModel('   '), 0)
  assert.equal(ticksForModel('claude-opus-4-1'), 3)
  assert.equal(ticksForModel('claude-sonnet-4-5'), 2)
  assert.equal(ticksForModel('claude-haiku-3-5'), 1)
  assert.equal(ticksForModel('gpt-4o'), 2)
  assert.equal(ticksForModel('o1-mini'), 1)
  const exotic = ticksForModel('mythic-grand-model')
  assert.ok(exotic >= 0 && exotic <= 3)
  assert.equal(ticksForModel('mythic-grand-model'), exotic, 'ticks must be deterministic')
})

test('workspace basename maps onto a stable curated pennant', () => {
  const pennant = pennantForWorkspace('mythic-city')
  assert.ok(WORKSPACE_PENNANTS.includes(pennant))
  assert.equal(basenameOf('/repos/mythic-city'), 'mythic-city')
  assert.equal(basenameOf('C:\\work\\mythic-city'), 'mythic-city')
  assert.equal(pennantForWorkspace('/repos/mythic-city'), pennant, 'paths collapse to the basename')
  assert.equal(pennantForWorkspace('MYTHIC-CITY'), pennant, 'basenames match case-insensitively')
  assert.equal(pennantForWorkspace('mythic-city'), pennant, 'stable across calls')
  for (const name of ['harbor', 'foundry-plans', 'archive', 'night-market', 'signal-post', 'observatory']) {
    assert.ok(WORKSPACE_PENNANTS.includes(pennantForWorkspace(name)))
  }
})

test('role maps to a crest light; empty roles stay neutral', () => {
  assert.equal(crestForRole(undefined), NEUTRAL_HUE)
  assert.equal(crestForRole(''), NEUTRAL_HUE)
  const lead = crestForRole('Forge lead')
  assert.ok(CREST_PALETTE.includes(lead))
  assert.equal(crestForRole('Forge lead'), lead, 'crest must be deterministic')
})

test('unknown values fall back to neutral and unlit', () => {
  const kit = kitForProvider('mystery-provider')
  assert.equal(kit.hue, NEUTRAL_HUE)
  assert.equal(kit.lit, false)
  assert.equal(kitForProvider(undefined).lit, false)
  const heraldry = heraldryFor(agent({
    provider: 'mystery-provider',
    model: undefined,
    role: undefined,
    workspace: '',
  }))
  assert.equal(heraldry.hue, NEUTRAL_HUE)
  assert.equal(heraldry.lit, false)
  assert.equal(heraldry.ticks, 0)
  assert.equal(heraldry.crest, NEUTRAL_HUE)
  assert.equal(heraldry.pennant, NEUTRAL_HUE)
})

test('manual stays unlit end to end', () => {
  const heraldry = heraldryFor(agent({ provider: 'manual', role: 'Planner' }))
  assert.equal(heraldry.lit, false)
  assert.equal(heraldry.hue, NEUTRAL_HUE)
  assert.equal(heraldry.silhouette, 'band')
})

test('heraldry composes every axis and stays deterministic', () => {
  const first = heraldryFor(agent({}))
  assert.equal(first.silhouette, 'helm')
  assert.equal(first.hue, '#ff9b47')
  assert.equal(first.ticks, 0)
  assert.deepEqual(first, heraldryFor(agent({})))
  const senior = heraldryFor(agent({ model: 'claude-opus-4-1' }))
  assert.equal(senior.ticks, 3)
  assert.equal(senior.silhouette, 'helm', 'ticks never change the provider read')
})

test('provider palette export matches the kits for a later legend', () => {
  assert.deepEqual(Object.keys(PROVIDER_PALETTE).sort(), ['claude-code', 'codex', 'manual', 'opencode'])
  for (const [provider, hue] of Object.entries(PROVIDER_PALETTE)) {
    assert.equal(hue, PROVIDER_KITS[provider].hue)
  }
})

test('dim helper greys toward the legacy target without three', () => {
  assert.equal(dimHex('#ffffff'), '#adb0b3')
  assert.equal(dimHex('#000000'), '#3a3d40')
  assert.equal(dimHex('not-a-color'), NEUTRAL_HUE)
})
