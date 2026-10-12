// Deterministic Mythic City layout. Pure data + math, computed once at module load with a
// seeded PRNG so every reload builds the exact same city. No Three.js here: the scene
// consumes these descriptors and instances shared geometry.
//
// Convention: y = 0 is street level. Buildings sit on a 10-unit lattice so streets are
// always clear. Work plazas get a generous building carve (PLAZA_CARVE) which guarantees a
// clear camera corridor for agent focus, and are dressed with low landscaping.

export type DistrictId = 'citadel' | 'foundry' | 'archive' | 'observatory' | 'port' | 'gateway'
export type StationId = 'forge' | 'planning-table' | 'signal-post'

export interface District {
  id: DistrictId
  name: string
  center: [number, number]
  radius: number
  blurb: string
}

export const DISTRICTS: District[] = [
  { id: 'citadel', name: 'Citadel', center: [0, 0], radius: 22, blurb: 'Stepped core and spires' },
  { id: 'foundry', name: 'Foundry', center: [-38, -16], radius: 20, blurb: 'Chimneys, cranes, smoke' },
  { id: 'archive', name: 'Archive', center: [34, -28], radius: 20, blurb: 'Rotunda and courtyards' },
  { id: 'observatory', name: 'Observatory', center: [4, 42], radius: 18, blurb: 'Dome and turning dish' },
  { id: 'port', name: 'Port', center: [-30, 30], radius: 20, blurb: 'Piers, boats, cranes' },
  { id: 'gateway', name: 'Gateway', center: [46, 12], radius: 18, blurb: 'Arch and transit line' },
]

export const CITY_RADIUS = 62

export const STATION_DISTRICT: Record<StationId, DistrictId> = {
  forge: 'foundry',
  'planning-table': 'archive',
  'signal-post': 'gateway',
}

// Open work plazas (world x/z). Buildings are excluded within PLAZA_CARVE of any plaza.
export const PLAZAS: Record<StationId, [number, number]> = {
  forge: [-38, -6],
  // Kept clear of the archive rotunda (center [34, -28], radius 9): the table and Halvard
  // would otherwise sit inside the landmark cylinder.
  'planning-table': [42, -10],
  'signal-post': [42, 18],
}

// Generous carve: larger than the agent-focus camera distance (~14 units) so no building
// can ever sit between the camera and a worker.
export const PLAZA_CARVE = 18

// Shared plaza walking surface. Paving is raised to this height and stations/workers stand
// on it, so boots never sink into the paving. Paving top === WALK_Y.
export const WALK_Y = 0.15

export type View =
  | { scale: 'city' }
  | { scale: 'district'; districtId: DistrictId }
  | { scale: 'agent'; agentId: string }

// --- Water ------------------------------------------------------------------

const WATER = { x0: -78, x1: -42, z0: 24, z1: 78 }
export const HARBOR = {
  x: (WATER.x0 + WATER.x1) / 2,
  z: (WATER.z0 + WATER.z1) / 2,
  w: WATER.x1 - WATER.x0,
  d: WATER.z1 - WATER.z0,
  x0: WATER.x0, x1: WATER.x1, z0: WATER.z0, z1: WATER.z1,
}

export const CANAL_POINTS: [number, number][] = [[-42, 36], [-22, 20], [-2, 8], [26, -16]]
export const CANAL_WIDTH = 8

function inWater(x: number, z: number) {
  return x > WATER.x0 - 1 && x < WATER.x1 + 1 && z > WATER.z0 - 1 && z < WATER.z1 + 1
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

function nearCanal(x: number, z: number, pad: number) {
  for (let i = 0; i < CANAL_POINTS.length - 1; i += 1) {
    if (distToSegment(x, z, CANAL_POINTS[i][0], CANAL_POINTS[i][1], CANAL_POINTS[i + 1][0], CANAL_POINTS[i + 1][1]) < pad) return true
  }
  return false
}

// --- Buildings (archetypes, layers, sparse facade windows) -------------------

export type PartKind = 'podium' | 'main' | 'upper'
export interface BuildingPart {
  kind: PartKind
  x: number
  z: number
  y0: number
  w: number
  d: number
  h: number
  color: string
}
export type RoofKind = 'flat' | 'cap' | 'spire'
export interface Building {
  x: number
  z: number
  district: DistrictId
  color: string
  height: number
  roof: RoofKind
  parts: BuildingPart[]
}
export interface WindowPanel { x: number; y: number; z: number; rot: number; w: number; h: number; district: DistrictId }
export interface RoofCap { x: number; z: number; y: number; w: number; d: number; h: number; district: DistrictId }
export interface Spire { x: number; z: number; y: number; r: number; h: number; district: DistrictId }

// Lane 1C material reboot: hues separated by district (value stays 20–45% for
// midnight legibility). citadel 215° blue-slate, foundry 12° rust, archive 160°
// jade, observatory 225° indigo, port 190° tar-teal, gateway 265° violet.
const COLORS: Record<DistrictId, string[]> = {
  citadel: ['#33465e', '#3d546f', '#2e3d52'],
  foundry: ['#5a3630', '#6b4034', '#4a2e28'],
  archive: ['#2f4a44', '#3d5c52', '#33463f'],
  observatory: ['#343c5c', '#404a6e', '#2e3450'],
  port: ['#2e444a', '#3a545b', '#2a3e42'],
  gateway: ['#4e3f68', '#5e4a7a', '#443757'],
}

// Per-district parapet/trim tint for the single instanced trim mesh in the scene.
// Keeps silhouette-first reads at city zoom without extra draws.
export const TRIM: Record<DistrictId, string> = {
  citadel: '#c9c2b0',
  foundry: '#8a4a34',
  archive: '#6fd8b8',
  observatory: '#c9884a',
  port: '#7a6a4f',
  gateway: '#9a86d0',
}
const HEIGHTS: Record<DistrictId, [number, number]> = {
  citadel: [24, 48],
  foundry: [8, 20],
  archive: [10, 24],
  observatory: [7, 17],
  port: [6, 14],
  gateway: [12, 26],
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function nearestDistrict(x: number, z: number): District {
  let best = DISTRICTS[0]
  let bestDist = Infinity
  for (const district of DISTRICTS) {
    const d = (x - district.center[0]) ** 2 + (z - district.center[1]) ** 2
    if (d < bestDist) { best = district; bestDist = d }
  }
  return best
}

// --- Work spots (Lane B: every district staffs at least one ring of slots) -----
//
// The three original plazas stay exactly where they are (forge, planning-table,
// signal-post). The Citadel steps, the Observatory dish terrace and the Port quay are
// new spots placed on open ground with a clear camera corridor. Every spot holds a
// ring of worker slots (see slotPosition in movement.ts) so several workers never
// overlap.

export interface WorkSpot {
  district: DistrictId
  center: [number, number]
  slots: number
  label: string
}

export const WORK_SPOTS: Record<DistrictId, WorkSpot> = {
  citadel: { district: 'citadel', center: [0, 20], slots: 6, label: 'Citadel Steps' },
  foundry: { district: 'foundry', center: [-38, -6], slots: 6, label: 'Forge Plaza' },
  archive: { district: 'archive', center: [42, -10], slots: 6, label: 'Planning Plaza' },
  observatory: { district: 'observatory', center: [18, 44], slots: 6, label: 'Dish Terrace' },
  port: { district: 'port', center: [-30, 40], slots: 6, label: 'Quay' },
  gateway: { district: 'gateway', center: [42, 18], slots: 6, label: 'Signal Court' },
}

/** Where root agents enter and historical agents leave: the portal arch. */
export const GATEWAY_ARCH: [number, number] = [46, 12]

// The three original plazas keep their generous carve; the three new spots take the
// smallest carve (10) that still clears the ~14-unit agent-focus camera corridor.
export const SPOT_CARVE = 10
const SPOT_CARVES: [number, number][] = [
  WORK_SPOTS.citadel.center,
  WORK_SPOTS.observatory.center,
  WORK_SPOTS.port.center,
]

function nearPlaza(x: number, z: number) {
  if ((Object.keys(PLAZAS) as StationId[]).some((id) => Math.hypot(x - PLAZAS[id][0], z - PLAZAS[id][1]) < PLAZA_CARVE)) return true
  return SPOT_CARVES.some(([px, pz]) => Math.hypot(x - px, z - pz) < SPOT_CARVE)
}

// --- Hero tower (Lane 1C skyline surgery) -----------------------------------
//
// The hero sits on an existing 10-unit building lattice cell so it never lands on
// streets, plazas, work spots, water or the canal, and the street graph
// (cityGraph.ts) is untouched. (15,15) is a citadel-district cell outside every
// carve: hypot 21.2 >= 18 core, clear of harbor/canal/plaza/spot pads.
export const HERO_CELL: [number, number] = [15, 15]
export const HERO_HEIGHT = 62
export const HERO_SPIRE_HEIGHT = 14

/** True for 10-unit lattice cells (buildings sit at i*10+5, streets at multiples of 10). */
export function isLatticeCell(x: number, z: number): boolean {
  return (x - 5) % 10 === 0 && (z - 5) % 10 === 0
}

/** True when a ground point clears every building carve (core, water, canal, plazas, spots). */
export function isCarveClear(x: number, z: number): boolean {
  if (Math.hypot(x, z) < 18) return false
  if (inWater(x, z)) return false
  if (nearCanal(x, z, CANAL_WIDTH * 0.5 + 2.4)) return false
  if (nearPlaza(x, z)) return false
  return true
}

const rng = mulberry32(20240928)

export const BUILDINGS: Building[] = []
export const WINDOWS: WindowPanel[] = []
export const ROOFCAPS: RoofCap[] = []
export const SPIRES: Spire[] = []

for (let i = -6; i <= 5; i += 1) {
  for (let j = -6; j <= 5; j += 1) {
    const x = i * 10 + 5
    const z = j * 10 + 5
    if (Math.hypot(x, z) < 18) continue // citadel core is authored separately
    if (inWater(x, z)) continue
    if (nearCanal(x, z, CANAL_WIDTH * 0.5 + 2.4)) continue
    if (nearPlaza(x, z)) continue
    const district = nearestDistrict(x, z)
    const [lo, hi] = HEIGHTS[district.id]
    const palette = COLORS[district.id]
    const color = palette[Math.floor(rng() * palette.length) % palette.length]
    const w = 5.0 + rng() * 2.0
    const d = 5.0 + rng() * 2.0
    // Skyline surgery: height falls off from the district centre so centres read
    // taller. Factor 1.35 at the centre → 0.65 at the rim (plan M2).
    const rawH = lo + rng() * (hi - lo)
    const distC = Math.hypot(x - district.center[0], z - district.center[1])
    const falloff = 1.35 - 0.7 * Math.min(1, distC / district.radius)
    const h = Math.max(4, rawH * falloff)
    const isHeroCell = x === HERO_CELL[0] && z === HERO_CELL[1]
    // 15% of buildings take the tower path: main 70%, mid 20% at 0.72 scale,
    // crown 10% at 0.45 scale (two setbacks).
    const isTower = isHeroCell || rng() < 0.15
    let archetype = Math.floor(rng() * 4)
    // Cut podium where h < 10 (invisible at city scale): merge into main.
    if (h < 10) archetype = 0
    // Cut random spires outside the Citadel/Gateway: spires only crown those towers.
    if (archetype === 3 && district.id !== 'citadel' && district.id !== 'gateway') archetype = 2
    const parts: BuildingPart[] = []
    let roof: RoofKind = rng() < 0.5 ? 'cap' : 'flat'

    if (isHeroCell) {
      // Hero needle on its lattice cell: three setbacks totalling HERO_HEIGHT plus
      // a spire. Citadel palette so it reads as the district crown.
      const heroColor = COLORS.citadel[1]
      parts.push({ kind: 'main', x, z, y0: 0, w: 8, d: 8, h: 34, color: heroColor })
      parts.push({ kind: 'main', x, z, y0: 34, w: 5.8, d: 5.8, h: 18, color: heroColor })
      parts.push({ kind: 'upper', x, z, y0: 52, w: 3.6, d: 3.6, h: 10, color: heroColor })
      roof = 'spire'
    } else if (isTower) {
      const mainH = h * 0.7
      const midH = h * 0.2
      const crownH = h - mainH - midH
      parts.push({ kind: 'main', x, z, y0: 0, w, d, h: mainH, color })
      parts.push({ kind: 'main', x, z, y0: mainH, w: w * 0.72, d: d * 0.72, h: midH, color })
      parts.push({ kind: 'upper', x, z, y0: mainH + midH, w: w * 0.45, d: d * 0.45, h: crownH, color })
    } else if (archetype === 0) {
      parts.push({ kind: 'main', x, z, y0: 0, w, d, h, color })
    } else if (archetype === 1) {
      const podium = Math.min(9, w * 1.3)
      const podDepth = Math.min(9, d * 1.3)
      const podH = Math.min(4, h * 0.3)
      parts.push({ kind: 'podium', x, z, y0: 0, w: podium, d: podDepth, h: podH, color })
      parts.push({ kind: 'main', x, z, y0: podH, w: w * 0.9, d: d * 0.9, h: h - podH, color })
    } else if (archetype === 2) {
      const podH = Math.min(3.6, h * 0.28)
      const mainH = h * 0.62
      parts.push({ kind: 'podium', x, z, y0: 0, w: Math.min(9, w * 1.25), d: Math.min(9, d * 1.25), h: podH, color })
      parts.push({ kind: 'main', x, z, y0: podH, w, d, h: mainH, color })
      parts.push({ kind: 'upper', x, z, y0: podH + mainH, w: w * 0.6, d: d * 0.6, h: h - podH - mainH, color })
    } else {
      parts.push({ kind: 'main', x, z, y0: 0, w, d, h: h * 0.82, color })
      parts.push({ kind: 'upper', x, z, y0: h * 0.82, w: w * 0.5, d: d * 0.5, h: h * 0.18, color })
      roof = 'spire'
    }

    const top = parts[parts.length - 1]
    const topY = top.y0 + top.h
    const finalColor = isHeroCell ? COLORS.citadel[1] : color
    BUILDINGS.push({ x, z, district: district.id, color: finalColor, height: topY, roof, parts })
    if (roof === 'spire') {
      const r = isHeroCell ? 1.2 : Math.min(top.w, top.d) * 0.22
      const sh = isHeroCell ? HERO_SPIRE_HEIGHT : 6 + rng() * 7
      SPIRES.push({ x, z, y: topY, r, h: sh, district: district.id })
    } else {
      ROOFCAPS.push({ x, z, y: topY + 0.45, w: top.w * 1.06, d: top.d * 1.06, h: 0.9, district: district.id })
    }

    // Facade windows, full-height and denser: per-floor rows (floor(h/3)) on every
    // part with h >= 3, all four facades on towers, two on slabs, capped at
    // 24 per building so the instanced glow set stays bounded. ~45% kept.
    const facadesAll = isTower || isHeroCell ? [0, 1, 2, 3] : rng() < 0.5 ? [0, 2] : [1, 3]
    let placed = 0
    for (const part of parts) {
      if (placed >= 24) break
      if (part.h < 3) continue
      const cols = Math.max(1, Math.min(4, Math.round(part.w / 2.2)))
      const rows = Math.max(1, Math.min(8, Math.floor(part.h / 3)))
      const colW = part.w / (cols + 0.5)
      const rowH = part.h / (rows + 0.6)
      for (const facade of facadesAll) {
        for (let c = 0; c < cols && placed < 24; c += 1) {
          for (let r = 0; r < rows && placed < 24; r += 1) {
            if (rng() > 0.45) continue
            const along = (c + 0.75) * colW - part.w / 2
            const y = part.y0 + (r + 0.9) * rowH
            let wx = x
            let wz = z
            let rot = 0
            if (facade === 0) { wx = x + along; wz = z + part.d / 2 + 0.07 }
            else if (facade === 1) { wx = x - along; wz = z - part.d / 2 - 0.07; rot = Math.PI }
            else if (facade === 2) { wx = x + part.w / 2 + 0.07; wz = z + along; rot = Math.PI / 2 }
            else { wx = x - part.w / 2 - 0.07; wz = z - along; rot = -Math.PI / 2 }
            WINDOWS.push({ x: wx, y, z: wz, rot, w: 0.85, h: 0.7, district: district.id })
            placed += 1
          }
        }
      }
    }
  }
}

// Hero handle for the scene (<HeroTower/>) and for node tests. The loop above
// guarantees the cell exists; the non-null assertion documents that invariant.
export const HERO: Building = BUILDINGS.find((b) => b.x === HERO_CELL[0] && b.z === HERO_CELL[1]) as Building

const byKind = (kind: PartKind) => BUILDINGS.flatMap((b) => b.parts.filter((p) => p.kind === kind))
export const PODIUM_PARTS = byKind('podium')
export const MAIN_PARTS = byKind('main')
export const UPPER_PARTS = byKind('upper')

// --- Streets ----------------------------------------------------------------

export interface RoadSegment { x: number; z: number; len: number; along: 'x' | 'z'; wide: number; lit: boolean }
// Shared with the walking-worker road graph (cityGraph.ts): street intersections.
export const STREET_GRID = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50]
const GRID = STREET_GRID

export const ROADS: RoadSegment[] = []
for (const g of GRID) {
  for (let z = -50; z < 50; z += 10) {
    const zc = z + 5
    if (inWater(g, zc)) continue
    ROADS.push({ x: g, z: zc, len: 9, along: 'z', wide: g === 0 ? 6.5 : 4.4, lit: g === 0 })
  }
  for (let x = -50; x < 50; x += 10) {
    const xc = x + 5
    if (inWater(xc, g)) continue
    ROADS.push({ x: xc, z: g, len: 9, along: 'x', wide: g === 0 ? 6.5 : 4.4, lit: g === 0 })
  }
}

export interface Lamp { x: number; z: number }
export const LAMPS: Lamp[] = []
for (let z = -50; z <= 50; z += 10) if (!inWater(2.8, z)) LAMPS.push({ x: 2.8, z })
for (let x = -50; x <= 50; x += 10) if (!inWater(x, 2.8)) LAMPS.push({ x, z: 2.8 })

// --- Canal segments, bridges, piers ----------------------------------------

export interface CanalSegment { x: number; z: number; len: number; rot: number }
export const CANAL_SEGMENTS: CanalSegment[] = []
for (let i = 0; i < CANAL_POINTS.length - 1; i += 1) {
  const [ax, az] = CANAL_POINTS[i]
  const [bx, bz] = CANAL_POINTS[i + 1]
  CANAL_SEGMENTS.push({ x: (ax + bx) / 2, z: (az + bz) / 2, len: Math.hypot(bx - ax, bz - az), rot: Math.atan2(bx - ax, bz - az) })
}

function canalAt(t: number): { x: number; z: number; rot: number } {
  const total = CANAL_POINTS.length - 1
  const raw = Math.max(0, Math.min(0.9999, t)) * total
  const i = Math.floor(raw)
  const local = raw - i
  const [ax, az] = CANAL_POINTS[i]
  const [bx, bz] = CANAL_POINTS[i + 1]
  return { x: ax + (bx - ax) * local, z: az + (bz - az) * local, rot: Math.atan2(bx - ax, bz - az) }
}

export interface Bridge { x: number; z: number; rot: number; span: number }
export const BRIDGES: Bridge[] = [0.34, 0.72].map((t) => {
  const p = canalAt(t)
  return { x: p.x, z: p.z, rot: p.rot, span: CANAL_WIDTH + 6 }
})

export interface Pier { x: number; z: number; w: number; d: number }
export const PIERS: Pier[] = [32, 44, 56, 68].map((z) => ({ x: -52, z, w: 20, d: 4 }))

// --- Rail loop --------------------------------------------------------------

export const RAIL_POINTS: [number, number, number][] = []
{
  const R = 60
  const N = 72
  for (let i = 0; i < N; i += 1) {
    const t = (i / N) * Math.PI * 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    RAIL_POINTS.push([R * Math.sign(c) * Math.abs(c) ** 0.5, 7, R * Math.sign(s) * Math.abs(s) ** 0.5])
  }
}
export const RAIL_PILLARS: { x: number; z: number }[] = RAIL_POINTS.filter((_, i) => i % 4 === 0).map(([x, , z]) => ({ x, z }))

// --- Moving routes ----------------------------------------------------------
// Couriers stay on grid streets clear of the citadel core, the canal and the authored
// landmarks (archive rotunda, gateway pillar); all open routes are traversed as bounded
// ping-pong so nothing teleports at an endpoint.

export interface CourierRoute { points: [number, number][]; period: number; phase: number }
export const COURIER_ROUTES: CourierRoute[] = [
  { points: [[-10, 20], [50, 20]], period: 30, phase: 0.0 },
  { points: [[-50, -45], [-50, 15]], period: 34, phase: 0.35 },
  { points: [[-45, -50], [45, -50]], period: 28, phase: 0.6 },
  { points: [[50, -40], [50, -2]], period: 32, phase: 0.15 },
]

export interface BoatRoute { points: [number, number][]; period: number; phase: number }
export const BOAT_ROUTES: BoatRoute[] = [
  { points: [[-42, 36], [-22, 20], [-2, 8], [26, -16]], period: 54, phase: 0.0 },
  { points: [[26, -16], [-2, 8], [-22, 20], [-42, 36]], period: 62, phase: 0.4 },
  // Harbor lane sits outside the pier tips (x = -62) and stays in water (x >= -78).
  { points: [[-69, 32], [-69, 70]], period: 46, phase: 0.2 },
]

// --- Plaza landscaping -------------------------------------------------------
// Low paving, railings, lamps and trees dress each plaza as a public square. Props sit at
// radius 10-15, well clear of the worker at radius ~2.4, so the agent corridor stays open.

export const PLAZA_PAVING: [number, number][] = (Object.keys(PLAZAS) as StationId[]).map((id) => PLAZAS[id])
export const PLAZA_PAVING_RADIUS = 15
// Smaller paved discs for the three new work spots (no railings/trees: the smallest
// dressing that still reads as a public square).
export const SPOT_PAVING: [number, number][] = [
  WORK_SPOTS.citadel.center,
  WORK_SPOTS.observatory.center,
  WORK_SPOTS.port.center,
]
export const SPOT_PAVING_RADIUS = 10
export const PLAZA_RAILINGS: [number, number][] = []
export const PLAZA_TREES: [number, number][] = []
export const PLAZA_LAMPS: [number, number][] = []
for (const id of Object.keys(PLAZAS) as StationId[]) {
  const [px, pz] = PLAZAS[id]
  for (let i = 0; i < 20; i += 1) {
    const a = (i / 20) * Math.PI * 2 + 0.2
    if (i % 5 === 0) continue // gaps read as plaza entrances
    PLAZA_RAILINGS.push([px + Math.cos(a) * 14.2, pz + Math.sin(a) * 14.2])
  }
  ;[-1.3, -2.3, 3.0].forEach((a, j) => PLAZA_TREES.push([px + Math.cos(a) * (11 + j), pz + Math.sin(a) * (11 + j)]))
  ;[1.7, -0.5].forEach((a) => PLAZA_LAMPS.push([px + Math.cos(a) * 10.5, pz + Math.sin(a) * 10.5]))
}

export function districtForStation(station: StationId): DistrictId {
  return STATION_DISTRICT[station]
}

export function districtById(id: DistrictId): District {
  return DISTRICTS.find((d) => d.id === id) ?? DISTRICTS[0]
}
