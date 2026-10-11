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
export interface WindowPanel { x: number; y: number; z: number; rot: number; w: number; h: number }
export interface RoofCap { x: number; z: number; y: number; w: number; d: number; h: number }
export interface Spire { x: number; z: number; y: number; r: number; h: number }

const COLORS: Record<DistrictId, string[]> = {
  citadel: ['#3a4860', '#44536c', '#3f4c62'],
  foundry: ['#463a38', '#52413a', '#3f342f'],
  archive: ['#3b4a46', '#45564f', '#37443f'],
  observatory: ['#37424f', '#41505f', '#3a4653'],
  port: ['#39464a', '#445256', '#3c4a4c'],
  gateway: ['#443f5c', '#4f4869', '#3d3850'],
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

function nearPlaza(x: number, z: number) {
  return (Object.keys(PLAZAS) as StationId[]).some((id) => Math.hypot(x - PLAZAS[id][0], z - PLAZAS[id][1]) < PLAZA_CARVE)
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
    const h = lo + rng() * (hi - lo)
    const archetype = Math.floor(rng() * 4)
    const parts: BuildingPart[] = []
    let roof: RoofKind = rng() < 0.5 ? 'cap' : 'flat'

    if (archetype === 0) {
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
    BUILDINGS.push({ x, z, district: district.id, color, height: topY, roof, parts })
    if (roof === 'spire') {
      const r = Math.min(top.w, top.d) * 0.22
      SPIRES.push({ x, z, y: topY, r, h: 6 + rng() * 7 })
    } else {
      ROOFCAPS.push({ x, z, y: topY + 0.45, w: top.w * 1.06, d: top.d * 1.06, h: 0.9 })
    }

    // Sparse windows on vertical facades only: 1-2 chosen facades, a few rows/columns,
    // ~45% lit. Never on top/bottom faces.
    if (top.h >= 5) {
      const cols = Math.max(1, Math.min(3, Math.round(top.w / 2.2)))
      const rows = Math.max(1, Math.min(5, Math.round(top.h / 3.4)))
      const colW = top.w / (cols + 0.5)
      const rowH = top.h / (rows + 0.6)
      const facadeOrder = rng() < 0.5 ? [0, 2] : [1, 3]
      let placed = 0
      for (const facade of facadeOrder) {
        for (let c = 0; c < cols && placed < 10; c += 1) {
          for (let r = 0; r < rows && placed < 10; r += 1) {
            if (rng() > 0.45) continue
            const along = (c + 0.75) * colW - top.w / 2
            const y = top.y0 + (r + 0.9) * rowH
            let wx = x
            let wz = z
            let rot = 0
            if (facade === 0) { wx = x + along; wz = z + top.d / 2 + 0.07 }
            else if (facade === 1) { wx = x - along; wz = z - top.d / 2 - 0.07; rot = Math.PI }
            else if (facade === 2) { wx = x + top.w / 2 + 0.07; wz = z + along; rot = Math.PI / 2 }
            else { wx = x - top.w / 2 - 0.07; wz = z - along; rot = -Math.PI / 2 }
            WINDOWS.push({ x: wx, y, z: wz, rot, w: 0.85, h: 0.7 })
            placed += 1
          }
        }
      }
    }
  }
}

const byKind = (kind: PartKind) => BUILDINGS.flatMap((b) => b.parts.filter((p) => p.kind === kind))
export const PODIUM_PARTS = byKind('podium')
export const MAIN_PARTS = byKind('main')
export const UPPER_PARTS = byKind('upper')

// --- Streets ----------------------------------------------------------------

export interface RoadSegment { x: number; z: number; len: number; along: 'x' | 'z'; wide: number; lit: boolean }
const GRID = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50]

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
