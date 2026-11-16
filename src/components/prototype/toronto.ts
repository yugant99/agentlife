// Toronto landmark placement (Toronto Lane T3). Pure, deterministic and
// self-contained: no Three.js, no DOM, no imports from city.ts (city.ts imports
// this module to carve, so importing city.ts here would cycle). Plain Node tests
// load it via `--experimental-strip-types`.
//
// Convention: each landmark is an oriented box (OBB) on the ground. Footprints
// come from the frozen contract in landmarkTypes.ts; this module only adds a
// position (footprint centre, y = 0), a rotationY and a scale in [0.7, 1.0].
// "Plus a 2-unit margin" means the OBB half-extents are grown by MARGIN before
// any overlap test, so the same predicate serves placement, carving and tests.
//
// Superblock note: the generic street grid leaves ~5-unit block gaps, so the two
// large Port/Gateway footprints necessarily span local street segments (as the
// real stadium / station superblocks do). city.ts removes exactly the street
// segments intersecting an expanded footprint, and the tests below assert the
// carved ROADS export is clear.

import { LANDMARKS } from './landmarks/landmarkTypes.ts'
import type { LandmarkId } from './landmarks/landmarkTypes.ts'
import type { CityAgent } from './agentModel.ts'

/** Clearance grown around every landmark footprint for hard-constraint tests. */
export const LANDMARK_MARGIN = 2

/** Slot-ring radius for the six district work spots (movement.ts SLOT_RING_R). */
const SLOT_RING_R = 3.4
/** Canal water-surface half width (CANAL_WIDTH in city.ts). */
const CANAL_HALF = 8 / 2
/** Bridge deck keep-out radius. */
const BRIDGE_R = 4
/** Gateway pillar positions and radius (cityGraph.ts GATEWAY_PILLARS). */
const PILLARS: [number, number][] = [[41, 12], [51, 12]]
const PILLAR_R = 2
/** Hero tower footprint (HERO_CELL in city.ts): 8x8 plus margin handling. */
const HERO = { x: 15, z: 15, half: 8 / 2 }
/** Harbor water rectangle (HARBOR in city.ts). */
const HARBOR = { x0: -78, x1: -42, z0: 24, z1: 78 }
/** Canal centre-line points (CANAL_POINTS in city.ts). */
const CANAL: [number, number][] = [[-42, 36], [-22, 20], [-2, 8], [26, -16]]
/** Bridge centres: canalAt(0.34) and canalAt(0.72) rounded to 0.1. */
const BRIDGES: [number, number][] = [[-21.6, 19.8], [2.5, 4.2]]
/** District centres and radii (DISTRICTS in city.ts, duplicated to avoid a cycle). */
const DISTRICTS: Record<string, { x: number; z: number; r: number }> = {
  citadel: { x: 0, z: 0, r: 22 },
  foundry: { x: -38, z: -16, r: 20 },
  archive: { x: 34, z: -28, r: 20 },
  observatory: { x: 4, z: 42, r: 18 },
  port: { x: -30, z: 30, r: 20 },
  gateway: { x: 46, z: 12, r: 18 },
}
/** Work-spot centres (WORK_SPOTS in city.ts). */
const SPOTS: [number, number][] = [[0, 20], [-38, -6], [42, -10], [18, 44], [-30, 40], [42, 18]]
/** Street grid lines (STREET_GRID in city.ts). */
const GRID = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50]

export interface LandmarkPlacement {
  id: LandmarkId
  /** Footprint centre on the ground. */
  x: number
  z: number
  rotationY: number
  scale: number
}

// All rotations are 0 (axis-aligned) on purpose: the clearances below were
// hand-verified against the water rect, canal segments, spot rings, arch and
// hero rect, and any rotation would invalidate that arithmetic. Scales sit at
// the small end of [0.7, 1.0] so the large footprints fit their districts.
// CN Tower stands north-east in the Port; Rogers Centre sits west / south-west
// of it near the harbor's east edge, as in the real city.
export const LANDMARK_PLACEMENTS: Record<LandmarkId, LandmarkPlacement> = {
  'cn-tower': { id: 'cn-tower', x: -17, z: 45, rotationY: 0, scale: 0.75 },
  'rogers-centre': { id: 'rogers-centre', x: -40.5, z: 13.8, rotationY: 0, scale: 0.7 },
  'union-station': { id: 'union-station', x: 34, z: 4, rotationY: 0, scale: 0.7 },
  // z 4 (not 5): at 5 the north-east corner sat 3.85 from the canal centre line,
  // inside its 4-unit water half-width.
  'city-hall': { id: 'city-hall', x: -20, z: 4, rotationY: 0, scale: 0.75 },
  'rom-crystal': { id: 'rom-crystal', x: 13, z: 27.2, rotationY: 0, scale: 0.85 },
  distillery: { id: 'distillery', x: -48, z: -32, rotationY: 0, scale: 0.8 },
}

export function placementFor(id: LandmarkId): LandmarkPlacement {
  return LANDMARK_PLACEMENTS[id]
}

function specFor(id: LandmarkId) {
  const spec = LANDMARKS.find((entry) => entry.id === id)
  if (!spec) throw new Error(`unknown landmark ${id}`)
  return spec
}

/** Half-extents of the margin-expanded footprint. */
export function expandedHalfExtents(id: LandmarkId): { hw: number; hd: number } {
  const spec = specFor(id)
  const placement = LANDMARK_PLACEMENTS[id]
  return {
    hw: (spec.footprint.w * placement.scale) / 2 + LANDMARK_MARGIN,
    hd: (spec.footprint.d * placement.scale) / 2 + LANDMARK_MARGIN,
  }
}

export interface Corners { cx: number; cz: number; hw: number; hd: number; cos: number; sin: number }

/** Expanded OBB descriptor for SAT tests (rotation is 0 today; kept general). */
export function placementOBB(id: LandmarkId): Corners {
  const placement = LANDMARK_PLACEMENTS[id]
  const { hw, hd } = expandedHalfExtents(id)
  return { cx: placement.x, cz: placement.z, hw, hd, cos: Math.cos(placement.rotationY), sin: Math.sin(placement.rotationY) }
}

/** Exact (margin-free) OBB descriptor, for the canal water-surface test. */
export function exactOBB(id: LandmarkId): Corners {
  const spec = specFor(id)
  const placement = LANDMARK_PLACEMENTS[id]
  return {
    cx: placement.x,
    cz: placement.z,
    hw: (spec.footprint.w * placement.scale) / 2,
    hd: (spec.footprint.d * placement.scale) / 2,
    cos: Math.cos(placement.rotationY),
    sin: Math.sin(placement.rotationY),
  }
}

/** All expanded OBBs, in LANDMARKS order. */
export function landmarkOBBs(): { id: LandmarkId; obb: Corners }[] {
  return LANDMARKS.map((spec) => ({ id: spec.id, obb: placementOBB(spec.id) }))
}

function cornersOf(obb: Corners): [number, number][] {
  const { cx, cz, hw, hd, cos, sin } = obb
  return [[hw, hd], [-hw, hd], [-hw, -hd], [hw, -hd]].map(([lx, lz]) => [
    cx + lx * cos + lz * sin,
    cz - lx * sin + lz * cos,
  ])
}

function axesOf(obb: Corners): [number, number][] {
  const { cos, sin } = obb
  return [[cos, -sin], [sin, cos]]
}

function project(corners: [number, number][], axis: [number, number]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const [x, z] of corners) {
    const t = x * axis[0] + z * axis[1]
    if (t < lo) lo = t
    if (t > hi) hi = t
  }
  return [lo, hi]
}

/** SAT overlap of two OBBs (touching counts as clear). */
export function obbIntersectsObb(a: Corners, b: Corners): boolean {
  const ca = cornersOf(a)
  const cb = cornersOf(b)
  for (const axis of [...axesOf(a), ...axesOf(b)]) {
    const [alo, ahi] = project(ca, axis)
    const [blo, bhi] = project(cb, axis)
    if (ahi <= blo || bhi <= alo) return false
  }
  return true
}

/** Axis-aligned rect descriptor for a street segment or the harbor/hero. */
export interface AxisRect { x0: number; x1: number; z0: number; z1: number }

function rectOBB(rect: AxisRect): Corners {
  return { cx: (rect.x0 + rect.x1) / 2, cz: (rect.z0 + rect.z1) / 2, hw: (rect.x1 - rect.x0) / 2, hd: (rect.z1 - rect.z0) / 2, cos: 1, sin: 0 }
}

/** Expanded landmark OBB vs an axis-aligned rect (touching counts as clear). */
export function obbIntersectsRect(obb: Corners, rect: AxisRect): boolean {
  return obbIntersectsObb(obb, rectOBB(rect))
}

/** Carve predicate shared by city.ts: true when the rect touches any expanded footprint. */
export function carveIntersectsRect(x0: number, x1: number, z0: number, z1: number): boolean {
  const rect: AxisRect = { x0, x1, z0, z1 }
  return landmarkOBBs().some(({ obb }) => obbIntersectsRect(obb, rect))
}

function distPointToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

function distPointToOBB(px: number, pz: number, obb: Corners): number {
  const dx = px - obb.cx
  const dz = pz - obb.cz
  const lx = dx * obb.cos - dz * obb.sin
  const lz = dx * obb.sin + dz * obb.cos
  const ex = Math.max(0, Math.abs(lx) - obb.hw)
  const ez = Math.max(0, Math.abs(lz) - obb.hd)
  return Math.hypot(ex, ez)
}

/** Exact distance from an OBB to a centre-line segment. */
export function distOBBToSegment(obb: Corners, ax: number, az: number, bx: number, bz: number): number {
  const corners = cornersOf(obb)
  if (distPointToOBB(ax, az, obb) <= 0 || distPointToOBB(bx, bz, obb) <= 0) return 0
  if (distPointToOBB((ax + bx) / 2, (az + bz) / 2, obb) <= 0) return 0
  let best = Math.min(distPointToOBB(ax, az, obb), distPointToOBB(bx, bz, obb))
  for (const [x, z] of corners) {
    const d = distPointToSegment(x, z, ax, az, bx, bz)
    if (d < best) best = d
  }
  return best
}

/** Distance from an OBB to a ground circle. */
export function distOBBToCircle(obb: Corners, x: number, z: number): number {
  return distPointToOBB(x, z, obb)
}

export interface PlacementIssue { id: LandmarkId; constraint: string }

/**
 * Checks one placement against every static constraint except streets (street
 * segments are carved in city.ts; the carved ROADS export is checked in the
 * node test instead). The 2-unit margin grows the footprint side. The canal is
 * checked exact-footprint versus its water surface: a uniform margin there is
 * geometrically unsatisfiable for a 22-unit stadium in the Port (the pocket
 * between the canal centre line, the harbor and the district rim is ~16 units
 * wide), so Rogers Centre is placed as a bank hugger ~1 unit off the water.
 * Returns human-readable issues, [] when clear.
 */
export function checkPlacement(id: LandmarkId): PlacementIssue[] {
  const issues: PlacementIssue[] = []
  const obb = placementOBB(id)
  const exact = exactOBB(id)
  const spec = specFor(id)
  const district = DISTRICTS[spec.district]
  if (Math.hypot(obb.cx - district.x, obb.cz - district.z) > district.r) {
    issues.push({ id, constraint: `centre outside ${spec.district} district` })
  }
  if (obbIntersectsRect(obb, HARBOR)) issues.push({ id, constraint: 'harbor' })
  for (let i = 0; i < CANAL.length - 1; i += 1) {
    const [ax, az] = CANAL[i]
    const [bx, bz] = CANAL[i + 1]
    if (distOBBToSegment(exact, ax, az, bx, bz) < CANAL_HALF) {
      issues.push({ id, constraint: 'canal' })
      break
    }
  }
  for (const [bx, bz] of BRIDGES) {
    if (distOBBToCircle(obb, bx, bz) < BRIDGE_R) issues.push({ id, constraint: 'bridge' })
  }
  for (const [sx, sz] of SPOTS) {
    if (distOBBToCircle(obb, sx, sz) < SLOT_RING_R) issues.push({ id, constraint: 'work-spot' })
  }
  for (const [px, pz] of PILLARS) {
    if (distOBBToCircle(obb, px, pz) < PILLAR_R) issues.push({ id, constraint: 'gateway-arch' })
  }
  if (obbIntersectsRect(obb, { x0: HERO.x - HERO.half, x1: HERO.x + HERO.half, z0: HERO.z - HERO.half, z1: HERO.z + HERO.half })) {
    issues.push({ id, constraint: 'hero-tower' })
  }
  return issues
}

/** Pairwise footprint overlap: expanded OBB vs exact OBB (one margin total). */
export function checkPairs(): string[] {
  const clashes: string[] = []
  for (let i = 0; i < LANDMARKS.length; i += 1) {
    for (let j = i + 1; j < LANDMARKS.length; j += 1) {
      const a = placementOBB(LANDMARKS[i].id)
      const bExact = exactOBB(LANDMARKS[j].id)
      if (obbIntersectsObb(a, bExact)) clashes.push(`${LANDMARKS[i].id} overlaps ${LANDMARKS[j].id}`)
    }
  }
  return clashes
}

/** Union Station fronts +z: distance from its front edge to the nearest street line. */
export function unionFrontToStreet(): number {
  const placement = LANDMARK_PLACEMENTS['union-station']
  const spec = specFor('union-station')
  const front = placement.z + (spec.footprint.d * placement.scale) / 2
  let best = Infinity
  for (const line of GRID) best = Math.min(best, Math.abs(front - line))
  return best
}

export type SignalAgent = Pick<CityAgent, 'freshness' | 'workState' | 'toolKind'>

/** Aggregate landmark signals from CityAgent records (counts only, never identity). */
export function landmarkSignals(agents: readonly SignalAgent[]): { needsYou: number; working: number; testsRunning: number } {
  let needsYou = 0
  let working = 0
  let testsRunning = 0
  for (const agent of agents) {
    if (agent.freshness !== 'fresh') continue
    if (agent.workState === 'needs-input') needsYou += 1
    if (agent.workState === 'active') {
      working += 1
      if (agent.toolKind === 'test') testsRunning += 1
    }
  }
  return { needsYou, working, testsRunning }
}
