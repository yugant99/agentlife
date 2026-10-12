// Provider heraldry for Mythic City workers (plan 003, Wave 1 Lane 1B). Pure and
// deterministic: the only import is types, so plain Node tests can load it with
// `node --experimental-strip-types`. Hue AND silhouette both carry provider
// identity (colour-blind safe); `manual` stays unlit; unknown values fall back to
// neutral grey. The scene keeps thin wrappers over these helpers.

import type { CityAgent, Provider } from './agentModel.ts'

/** Head/finial silhouette per provider. All four differ in shape, never hue alone. */
export type HeraldrySilhouette = 'helm' | 'hood' | 'cap' | 'band'

export interface ProviderKit {
  silhouette: HeraldrySilhouette
  /** Primary trim/finial hue. */
  hue: string
  /** Dark uniform coat tinted toward the hue. */
  uniform: string
  /** False for `manual` and unknown providers: no emissive light. */
  lit: boolean
}

export const PROVIDER_KITS: Record<Provider, ProviderKit> = {
  codex: { silhouette: 'helm', hue: '#ff9b47', uniform: '#4a3a2c', lit: true },
  'claude-code': { silhouette: 'hood', hue: '#6fd8b8', uniform: '#2c443c', lit: true },
  opencode: { silhouette: 'cap', hue: '#7fd0ff', uniform: '#2e3d4a', lit: true },
  manual: { silhouette: 'band', hue: '#8a8f96', uniform: '#3a3d42', lit: false },
}

/** Provider hue table for a later legend. Values match the kit hues. */
export const PROVIDER_PALETTE: Record<Provider, string> = {
  codex: PROVIDER_KITS.codex.hue,
  'claude-code': PROVIDER_KITS['claude-code'].hue,
  opencode: PROVIDER_KITS.opencode.hue,
  manual: PROVIDER_KITS.manual.hue,
}

/** Neutral fallback for unknown providers, roles and workspaces. */
export const NEUTRAL_HUE = '#8a8f96'

const NEUTRAL_KIT: ProviderKit = {
  silhouette: 'band',
  hue: NEUTRAL_HUE,
  uniform: '#43464c',
  lit: false,
}

/** Provider kit with a neutral, unlit fallback for unknown values. */
export function kitForProvider(provider: string | undefined): ProviderKit {
  if (
    provider === 'codex'
    || provider === 'claude-code'
    || provider === 'opencode'
    || provider === 'manual'
  ) {
    return PROVIDER_KITS[provider]
  }
  return NEUTRAL_KIT
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return Math.abs(hash)
}

/**
 * Model seniority to 0-3 shoulder ticks. Missing models read 0; the named
 * families map explicitly (`opus` 3, `sonnet` 2, `haiku` 1, `gpt-*` 2) and every
 * other non-empty model hashes stably into 0-3.
 */
export function ticksForModel(model: string | undefined): 0 | 1 | 2 | 3 {
  if (!model || model.trim() === '') return 0
  const lower = model.toLowerCase()
  if (lower.includes('opus') || lower.includes('ultra') || lower.includes('large')) return 3
  if (lower.includes('sonnet') || lower.includes('medium') || lower.includes('gpt')) return 2
  if (
    lower.includes('haiku')
    || lower.includes('mini')
    || lower.includes('nano')
    || lower.includes('small')
    || lower.includes('lite')
  ) {
    return 1
  }
  return (hashString(lower) % 4) as 0 | 1 | 2 | 3
}

/** Role crest-light hues. Empty roles fall back to neutral. */
export const CREST_PALETTE: readonly string[] = ['#ffd479', '#e0a03b', '#b9a8ff', '#a8e6ff']

export function crestForRole(role: string | undefined): string {
  if (!role || role.trim() === '') return NEUTRAL_HUE
  return CREST_PALETTE[hashString(role.toLowerCase()) % CREST_PALETTE.length]
}

/** Workspace pennant hues: a small curated palette keyed by basename. */
export const WORKSPACE_PENNANTS: readonly string[] = [
  '#d9b05a',
  '#6fb3a8',
  '#b9a8ff',
  '#e0893b',
  '#8fd18f',
  '#e6d6b0',
]

/** Last path segment; the contract already sends basenames, this stays defensive. */
export function basenameOf(workspace: string): string {
  const parts = workspace.split(/[/\\]/).filter((part) => part.length > 0)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/** Basename-hashed pennant; unknown or empty workspaces fall back to neutral. */
export function pennantForWorkspace(workspace: string | undefined): string {
  if (!workspace) return NEUTRAL_HUE
  const base = basenameOf(workspace)
  if (base === '') return NEUTRAL_HUE
  return WORKSPACE_PENNANTS[hashString(base.toLowerCase()) % WORKSPACE_PENNANTS.length]
}

export interface Heraldry {
  silhouette: HeraldrySilhouette
  hue: string
  uniform: string
  lit: boolean
  ticks: 0 | 1 | 2 | 3
  crest: string
  pennant: string
}

export type HeraldryAgent = Pick<CityAgent, 'id' | 'provider' | 'model' | 'role' | 'workspace'>

export function heraldryFor(agent: HeraldryAgent): Heraldry {
  const kit = kitForProvider(agent.provider)
  return {
    silhouette: kit.silhouette,
    hue: kit.hue,
    uniform: kit.uniform,
    lit: kit.lit,
    ticks: ticksForModel(agent.model),
    crest: crestForRole(agent.role),
    pennant: pennantForWorkspace(agent.workspace),
  }
}

/** Legacy stale-mix target grey (matches the pre-heraldry desaturation). */
export const DIM_TARGET = '#6a6f75'

/**
 * Pure hex lerp toward DIM_TARGET (default 0.55) so the scene can precompute
 * dimmed variants once without three. Invalid input falls back to neutral.
 */
export function dimHex(hex: string, ratio = 0.55): string {
  const body = hex.startsWith('#') ? hex.slice(1) : hex
  const target = DIM_TARGET.slice(1)
  if (!/^[0-9a-fA-F]{6}$/.test(body)) return NEUTRAL_HUE
  const mix = (index: number): string => {
    const channel = parseInt(body.slice(index, index + 2), 16)
    const goal = parseInt(target.slice(index, index + 2), 16)
    return Math.round(channel + (goal - channel) * ratio)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${mix(0)}${mix(2)}${mix(4)}`
}
