import type { AgentRecord, DistrictId } from '../types'

export const districtMeta: Record<DistrictId, { name: string; kicker: string; description: string }> = {
  'great-hall': {
    name: 'Great Hall',
    kicker: 'Canonical acceptance',
    description: 'Astra is the sole authority for accepting work into the canonical record.',
  },
  watchtower: {
    name: 'War Council',
    kicker: 'Challenge and integration',
    description: 'Spec critique, adversarial API and schema review, negative tests, and ambiguity detection.',
  },
  forge: {
    name: 'Forge Yard',
    kicker: 'Delivery',
    description: 'Terra coordinates bounded implementation; leaf builders execute; Sol handles difficult cross-cutting work.',
  },
  'proving-grounds': {
    name: 'Proving Grounds',
    kicker: 'Independent QA',
    description: 'Luna runs independent checks and reports evidence without self-accepting the result.',
  },
  'scribe-hall': {
    name: 'Rune Hall',
    kicker: 'Evidence and accounting',
    description: 'Preserves lineage, usage, decisions, and the boundary between demonstration and proof.',
  },
  oracle: {
    name: 'Oracle Shrine',
    kicker: 'Advisory milestone review',
    description: 'Fable reviews milestones and risks. Advice is non-canonical and cannot accept work.',
  },
  dock: {
    name: 'Portability Dock',
    kicker: 'Three bounded handoffs',
    description: 'Spencer owns one portability finish line per day, never the shared schema or core integration.',
  },
}

const now = Date.now()
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()

// Every hall except the Great Hall, in the fixed order used for staging.
const secondaryDistricts = (Object.keys(districtMeta) as DistrictId[]).filter((id) => id !== 'great-hall')

// Visual staging only. Placement is decided purely by record age: a chat updated within
// the recency window is staged in the Great Hall, and older chats are spread across the
// other halls. Timestamp is the user's chosen visual grouping, so a prior keyword/role
// district routing is not preserved. This is never a claim about the worker's actual job,
// and it never changes a provider-reported status, activity, model or id.
const RECENT_MINUTES = 60
const RECENT_MS = RECENT_MINUTES * 60_000

const byId = (a: AgentRecord, b: AgentRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const updatedMs = (record: AgentRecord) => {
  const value = new Date(record.updatedAt).getTime()
  return Number.isFinite(value) ? value : 0
}

// Newest first, tie-broken by id, so ordering never depends on input order.
const byRecencyThenId = (a: AgentRecord, b: AgentRecord) => updatedMs(b) - updatedMs(a) || byId(a, b)

const isRecent = (record: AgentRecord, now: number) => {
  const updated = new Date(record.updatedAt).getTime()
  return Number.isFinite(updated) && now - updated < RECENT_MS
}

/**
 * The simplest deterministic age layout for live records:
 * (a) every record updated within the recency window is staged in the Great Hall;
 * (b) the older records are sorted by updatedAt descending, tie-broken by id;
 * (c) with no recent records, the freshest older record is reserved for the Great Hall;
 * (d) every remaining older record is placed across the six secondary halls,
 *     filling empty halls first and then balancing counts.
 *
 * All fields other than `district` are copied unchanged. `stagedIds` lists every record
 * whose displayed hall came from this staging. When the roster is too small the layout
 * leaves the true (zero) counts in place rather than inventing workers.
 */
export function stageRecords(records: AgentRecord[], now = Date.now()): { records: AgentRecord[]; stagedIds: ReadonlySet<string> } {
  const stagedIds = new Set<string>()
  if (records.length === 0) return { records, stagedIds }

  const recent = records.filter((record) => isRecent(record, now))
  const older = records.filter((record) => !isRecent(record, now)).sort(byRecencyThenId)

  const staged = new Map<string, DistrictId>()

  // (a) Recent records: great hall.
  for (const record of recent) {
    if (record.district !== 'great-hall') staged.set(record.id, 'great-hall')
  }

  // (c) With nothing recent, keep the freshest older record in the Great Hall.
  const reservedId = recent.length === 0 && older.length > 0 ? older[0].id : null
  if (reservedId && older[0].district !== 'great-hall') staged.set(reservedId, 'great-hall')

  // (d) Spread every remaining older record across the six secondary halls.
  const spreadable = older.filter((record) => record.id !== reservedId)
  if (spreadable.length > 0) {
    // Least-filled hall first, so empty halls fill before counts balance.
    const totals = new Map<DistrictId, number>(secondaryDistricts.map((id) => [id, 0]))
    for (const record of spreadable) {
      let best = secondaryDistricts[0]
      let bestCount = Infinity
      for (const id of secondaryDistricts) {
        const count = totals.get(id) ?? 0
        if (count < bestCount) { best = id; bestCount = count }
      }
      totals.set(best, bestCount + 1)
      staged.set(record.id, best)
    }
  }

  if (staged.size === 0) return { records, stagedIds }
  for (const id of staged.keys()) stagedIds.add(id)
  return {
    records: records.map((record) => {
      const district = staged.get(record.id)
      return district ? { ...record, district } : record
    }),
    stagedIds,
  }
}

export const demoRecords: AgentRecord[] = [
  {
    id: 'astra', provider: 'codex', model: 'gpt-6-astra', title: 'Astra', status: 'needs-input',
    activity: 'Holding the acceptance gate for a human decision', updatedAt: ago(3), role: 'Main lead · canonical authority', district: 'great-hall',
    usage: { inputTokens: 128_442, outputTokens: 11_908, cachedInputTokens: 74_220 },
  },
  {
    id: 'grok-47', parentId: 'astra', provider: 'opencode', model: 'grok-4.7', title: 'Grok 4.7', status: 'review',
    activity: 'Reviewing API boundaries and failure modes', updatedAt: ago(7), role: 'Challenge and integration sublead', district: 'watchtower',
  },
  {
    id: 'grok-46', parentId: 'grok-47', provider: 'opencode', model: 'grok-4.6', title: 'Grok 4.6', status: 'active',
    activity: 'Scouting ambiguous dependencies and edge cases', updatedAt: ago(2), role: 'Scout and research worker', district: 'watchtower',
  },
  {
    id: 'terra', parentId: 'astra', provider: 'opencode', model: 'unavailable', title: 'Terra', status: 'waiting',
    activity: 'Waiting for a verified provider/model ID', updatedAt: ago(12), role: 'Delivery sublead', district: 'forge',
  },
  {
    id: 'deepseek-a', parentId: 'terra', provider: 'opencode', model: 'deepseek-builder-a', title: 'DeepSeek A', status: 'active',
    activity: 'Building the bounded adapter slice', updatedAt: ago(4), role: 'Leaf builder', district: 'forge',
  },
  {
    id: 'deepseek-b', parentId: 'terra', provider: 'opencode', model: 'deepseek-builder-b', title: 'DeepSeek B', status: 'complete',
    activity: 'Completed the district normalization map', updatedAt: ago(18), role: 'Leaf builder', district: 'forge',
  },
  {
    id: 'sol', parentId: 'terra', provider: 'codex', model: 'gpt-5.6-sol', title: 'Sol', status: 'review',
    activity: 'Inspecting a cross-cutting implementation plan', updatedAt: ago(5), role: 'Escalation model', district: 'forge',
  },
  {
    id: 'luna', parentId: 'astra', provider: 'codex', model: 'gpt-5.6-luna', title: 'Luna', status: 'active',
    activity: 'Executing independent UI acceptance checks', updatedAt: ago(1), role: 'Independent QA', district: 'proving-grounds',
  },
  {
    id: 'scribe', parentId: 'astra', provider: 'manual', model: 'evidence-ledger', title: 'Rune Scribe', status: 'review',
    activity: 'Reconciling evidence and usage boundaries', updatedAt: ago(9), role: 'Evidence and accounting', district: 'scribe-hall',
  },
  {
    id: 'fable', parentId: 'astra', provider: 'opencode', model: 'fable', title: 'Fable', status: 'waiting',
    activity: 'Advisory only · awaiting the next milestone', updatedAt: ago(24), role: 'Milestone reviewer', district: 'oracle',
  },
  {
    id: 'spencer', parentId: 'astra', provider: 'manual', model: 'human', title: 'Spencer', status: 'active',
    activity: 'Day 1 · inventorying endpoints and mock/live boundaries', updatedAt: ago(6), role: 'Portability lane owner', district: 'dock',
  },
]
