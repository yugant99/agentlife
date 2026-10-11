// Movement planner for walking workers (plan 002, Lane B). Pure: trip-time clamp,
// hysteresis, slot assignment, render cap, gestures and status rings. No Three.js, no
// DOM, no clocks; every function takes explicit inputs so plain Node tests can drive
// it. The frame loop in Workers.tsx only walks the polylines this module retargets.

import {
  DOMINANCE_WINDOW_MS, DWELL_MIN_MS, MAX_RENDERED_WORKERS, TOOL_DISTRICT, TRIP_MAX_MS, TRIP_MIN_MS,
} from './agentModel.ts'
import type { CityAgent, DistrictId, ToolKind } from './agentModel.ts'

/** Brisk-walk baseline; long trips scale up toward a jog via the trip clamp. */
export const WALK_SPEED = 3

/** Clamp a trip into [TRIP_MIN_MS, TRIP_MAX_MS] by scaling speed for long trips. */
export function tripDurationMs(length: number, baseSpeed = WALK_SPEED): number {
  if (!(length > 0) || !Number.isFinite(length)) return TRIP_MIN_MS
  return Math.min(TRIP_MAX_MS, Math.max(TRIP_MIN_MS, (length / baseSpeed) * 1000))
}

/** The constant speed that covers `length` units inside the clamped duration. */
export function tripSpeed(length: number, baseSpeed = WALK_SPEED): number {
  const durationMs = tripDurationMs(length, baseSpeed)
  return length / (durationMs / 1000)
}

// --- Hysteresis ---------------------------------------------------------------

export interface ToolSample {
  toolKind: ToolKind | undefined
  at: number
}

/**
 * The dominant tool kind over DOMINANCE_WINDOW_MS. Ties break toward the most
 * recent sample, so a worker never ping-pongs between districts every few seconds.
 */
export function dominantToolKind(history: ToolSample[], now: number): ToolKind | undefined {
  const cutoff = now - DOMINANCE_WINDOW_MS
  const counts = new Map<ToolKind, { n: number; last: number }>()
  for (const sample of history) {
    if (sample.toolKind === undefined || sample.at < cutoff) continue
    const entry = counts.get(sample.toolKind) ?? { n: 0, last: 0 }
    entry.n += 1
    if (sample.at > entry.last) entry.last = sample.at
    counts.set(sample.toolKind, entry)
  }
  let best: ToolKind | undefined
  let bestN = -1
  let bestLast = -1
  for (const [kind, entry] of counts) {
    if (entry.n > bestN || (entry.n === bestN && entry.last > bestLast)) {
      best = kind
      bestN = entry.n
      bestLast = entry.last
    }
  }
  return best
}

/** A worker leaves its spot only after dwelling there for DWELL_MIN_MS. */
export function canLeaveSpot(arrivedAt: number, now: number): boolean {
  return now - arrivedAt >= DWELL_MIN_MS
}

export type TargetAgent = Pick<CityAgent, 'workState' | 'freshness' | 'toolKind'>

/**
 * Where the worker should be right now. Needs-input overrides everything (Citadel
 * steps); historical agents head for the Gateway; otherwise the dominant tool kind
 * over the window wins, falling back to the latest tool kind.
 */
export function targetDistrict(agent: TargetAgent, dominant: ToolKind | undefined): DistrictId {
  if (agent.freshness === 'historical') return 'gateway'
  if (agent.workState === 'needs-input') return 'citadel'
  return TOOL_DISTRICT[dominant ?? agent.toolKind ?? 'other']
}

// --- Slot assignment ------------------------------------------------------------

export const SLOT_RING_R = 3.4

/**
 * A slot on the district's work ring. The ring grows past 8 occupants so several
 * workers never overlap. Deterministic for (index, total).
 */
export function slotPosition(
  center: readonly [number, number],
  index: number,
  total: number,
): [number, number] {
  const n = Math.max(1, total)
  const radius = SLOT_RING_R + 0.6 * Math.max(0, n - 8)
  const angle = (index / n) * Math.PI * 2 + 0.5
  return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]
}

/** A child stands beside its parent instead of taking a ring slot. */
export function childOffset(sibling: number, siblings: number): [number, number] {
  const angle = 0.9 + (sibling / Math.max(1, siblings)) * Math.PI * 2
  return [Math.cos(angle) * 2.1, Math.sin(angle) * 2.1]
}

export type SlotAgent = Pick<CityAgent, 'id' | 'parentId' | 'depth' | 'workState' | 'freshness' | 'toolKind'>

export interface SlotAssignment {
  district: DistrictId
  /** Ring slot for roots; sibling index for children. */
  slot: number
  total: number
}

/**
 * Deterministic slots: roots share their district ring in id order, children attach
 * to their parent's district. Historical agents keep a Gateway slot for the walk out.
 */
export function assignDistrictSlots<T extends SlotAgent>(agents: T[]): Map<string, SlotAssignment> {
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const roots = agents.filter((agent) => !(agent.depth > 0 && agent.parentId && byId.has(agent.parentId)))
  const grouped = new Map<DistrictId, T[]>()
  for (const agent of roots) {
    const district = targetDistrict(agent, agent.toolKind)
    const list = grouped.get(district) ?? []
    list.push(agent)
    grouped.set(district, list)
  }
  const out = new Map<string, SlotAssignment>()
  for (const list of grouped.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    list.forEach((agent, slot) => {
      const district = targetDistrict(agent, agent.toolKind)
      out.set(agent.id, { district, slot, total: list.length })
    })
  }
  // Children inherit the parent assignment; the slot field carries the sibling
  // index so layoutTargets can spread them around the parent.
  const siblings = new Map<string, T[]>()
  for (const agent of agents) {
    if (agent.depth > 0 && agent.parentId && byId.has(agent.parentId)) {
      const list = siblings.get(agent.parentId) ?? []
      list.push(agent)
      siblings.set(agent.parentId, list)
    }
  }
  for (const list of siblings.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    list.forEach((agent, sibling) => {
      const parent = out.get(agent.parentId ?? '')
      out.set(agent.id, {
        district: parent?.district ?? 'gateway',
        slot: sibling,
        total: parent?.total ?? 1,
      })
    })
  }
  return out
}

export type LayoutAgent = SlotAgent

/**
 * World-space targets for every agent: roots on their district ring, children
 * offset beside their parent. Pure; the scene uses it for camera targets and the
 * frame loop uses it for retargeting.
 */
export function layoutTargets<T extends LayoutAgent>(
  agents: T[],
  centers: Record<DistrictId, readonly [number, number]>,
): Map<string, { district: DistrictId; x: number; z: number }> {
  const slots = assignDistrictSlots(agents)
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const out = new Map<string, { district: DistrictId; x: number; z: number }>()
  // Roots first so children always find their parent target, regardless of order.
  const isChild = (agent: T) => agent.depth > 0 && agent.parentId && byId.has(agent.parentId)
  for (const agent of agents) {
    if (isChild(agent)) continue
    const assignment = slots.get(agent.id)
    if (!assignment) continue
    const [x, z] = slotPosition(centers[assignment.district], assignment.slot, assignment.total)
    out.set(agent.id, { district: assignment.district, x, z })
  }
  for (const agent of agents) {
    if (!isChild(agent)) continue
    const parent = out.get(agent.parentId ?? '')
    if (!parent) continue
    const group = agents.filter((entry) => entry.parentId === agent.parentId)
    const sibling = Math.max(
      0,
      group.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).findIndex((entry) => entry.id === agent.id),
    )
    const [ox, oz] = childOffset(sibling, group.length)
    out.set(agent.id, { district: parent.district, x: parent.x + ox, z: parent.z + oz })
  }
  return out
}

// --- Render cap -------------------------------------------------------------------

/** Priority rank: needs-input, then fresh, then stale. Historical never renders. */
export function renderPriority(agent: Pick<CityAgent, 'workState' | 'freshness'>): number {
  if (agent.freshness === 'historical') return 3
  if (agent.workState === 'needs-input' && agent.freshness === 'fresh') return 0
  if (agent.freshness === 'fresh') return 1
  return 2
}

export interface RenderSplit<T> {
  rendered: T[]
  /** Everyone else still belongs in the roster (plus all historical agents). */
  overflow: T[]
}

export function selectRendered<T extends Pick<CityAgent, 'id' | 'workState' | 'freshness' | 'lastSignalAt'>>(
  agents: T[],
): RenderSplit<T> {
  const ordered = agents.slice().sort(
    (a, b) => renderPriority(a) - renderPriority(b)
      || b.lastSignalAt - a.lastSignalAt
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const eligible = ordered.filter((agent) => agent.freshness !== 'historical')
  return { rendered: eligible.slice(0, MAX_RENDERED_WORKERS), overflow: eligible.slice(MAX_RENDERED_WORKERS) }
}

// --- Gestures and status rings ------------------------------------------------------

export type WorkerGesture =
  | 'hammer' | 'scroll' | 'telescope' | 'crate' | 'banner'
  | 'think' | 'talk' | 'idle' | 'sit'

/**
 * The gesture at a spot follows the current phase/toolKind immediately (no dwell
 * gate): hammer (shell/edit), scroll (read/search), telescope (test/web), crate
 * (ship), banner (delegate), hand-on-chin (thinking), glow pulse (talking). Stale
 * agents sit; historical agents walk out idle.
 */
export function gestureForWorker(
  agent: Pick<CityAgent, 'freshness' | 'phase' | 'toolKind'>,
): WorkerGesture {
  if (agent.freshness === 'stale') return 'sit'
  if (agent.freshness === 'historical') return 'idle'
  if (agent.phase === 'thinking') return 'think'
  if (agent.phase === 'talking') return 'talk'
  if (agent.phase === 'tool') {
    switch (agent.toolKind) {
      case 'shell':
      case 'edit':
        return 'hammer'
      case 'read':
      case 'search':
        return 'scroll'
      case 'test':
      case 'web':
        return 'telescope'
      case 'ship':
        return 'crate'
      case 'delegate':
      case 'ask':
      case 'other':
        return 'banner'
      default:
        return 'idle'
    }
  }
  return 'idle'
}

export type RingKind = 'accent' | 'info' | 'success' | 'warning' | 'muted'

/** Five semantic ground-ring colors: selected, thinking/talking, active tool, needs-input, stale. */
export const RING_COLORS: Record<RingKind, string> = {
  accent: '#d9b05a',
  info: '#7fd0ff',
  success: '#6fb3a8',
  warning: '#e0a03b',
  muted: '#8a8f96',
}

export function ringFor(
  agent: Pick<CityAgent, 'workState' | 'freshness' | 'phase'>,
  selected: boolean,
): RingKind {
  if (selected) return 'accent'
  if (agent.freshness !== 'fresh') return 'muted'
  if (agent.workState === 'needs-input') return 'warning'
  if (agent.phase === 'thinking' || agent.phase === 'talking') return 'info'
  if (agent.workState === 'active' && agent.phase === 'tool') return 'success'
  return 'muted'
}
