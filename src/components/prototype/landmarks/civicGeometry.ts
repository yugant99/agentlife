// Toronto Lane T2 "Civic + heritage" shared geometry (plan 004 wave).
// Pure and self-contained: no three.js here, so node tests can load it with
// `node --experimental-strip-types`. The four scene components stay thin over
// these helpers. All coordinates are local: origin is the footprint centre on
// the ground (y = 0), width along x, depth along z, front faces +z.

export interface Footprint {
  w: number
  d: number
}

/** Axis-aligned solid: centre (x, z), base y0, size (w, h, d). */
export interface BoxPart {
  x: number
  y0: number
  z: number
  w: number
  h: number
  d: number
}

const EPS = 1e-6

export function boxWithinFootprint(box: BoxPart, footprint: Footprint, height: number): boolean {
  if (box.w <= 0 || box.h <= 0 || box.d <= 0) return false
  if (box.y0 < -EPS || box.y0 + box.h > height + EPS) return false
  if (Math.abs(box.x) + box.w / 2 > footprint.w / 2 + EPS) return false
  if (Math.abs(box.z) + box.d / 2 > footprint.d / 2 + EPS) return false
  return true
}

export function pointWithinFootprint(x: number, z: number, footprint: Footprint, margin = 0): boolean {
  return Math.abs(x) <= footprint.w / 2 - margin + EPS && Math.abs(z) <= footprint.d / 2 - margin + EPS
}

// --- Union Station (24 x 7, 9 high) -------------------------------------------

export const UNION_FOOTPRINT: Footprint = { w: 24, d: 7 }
export const UNION_HEIGHT = 9
export const UNION_COLUMN_COUNT = 22
export const UNION_COLUMN = { radius: 0.22, height: 4.6, y0: 0.8, z: 2.7, span: 21 }

export const UNION_PLINTH: BoxPart = { x: 0, y0: 0, z: 0, w: 24, h: 0.8, d: 7 }
export const UNION_WALL: BoxPart = { x: 0, y0: 0.8, z: -0.7, w: 23, h: 5.4, d: 5.6 }
export const UNION_CORNICE: BoxPart = { x: 0, y0: 6.2, z: -0.3, w: 24, h: 0.7, d: 6.4 }
export const UNION_ROOF: BoxPart = { x: 0, y0: 6.9, z: -0.7, w: 20, h: 0.6, d: 4.5 }
export const UNION_PORTICO: BoxPart = { x: 0, y0: 6.9, z: 2.0, w: 5, h: 1.3, d: 2.6 }

export function unionBlocks(): BoxPart[] {
  return [UNION_PLINTH, UNION_WALL, UNION_CORNICE, UNION_ROOF, UNION_PORTICO]
}

/** 22 column centres across the front facade, evenly spaced. */
export function unionColumnPositions(count = UNION_COLUMN_COUNT): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : i / (count - 1)
    out.push({ x: -UNION_COLUMN.span / 2 + UNION_COLUMN.span * t, z: UNION_COLUMN.z })
  }
  return out
}

export interface WindowDot {
  x: number
  y: number
  z: number
}

/** Warm windows on the wall face, one in each gap between columns. */
export function unionWindowPositions(count = UNION_COLUMN_COUNT): WindowDot[] {
  const cols = unionColumnPositions(count)
  const out: WindowDot[] = []
  for (let i = 0; i + 1 < cols.length; i += 1) {
    out.push({ x: (cols[i].x + cols[i + 1].x) / 2, y: 3.1, z: 2.15 })
  }
  return out
}

// --- City Hall (18 x 14, 30 high) ----------------------------------------------

export const CITY_HALL_FOOTPRINT: Footprint = { w: 18, d: 14 }
export const CITY_HALL_HEIGHT = 30
export const CITY_HALL_TOWER_EAST_HEIGHT = 30
export const CITY_HALL_TOWER_WEST_HEIGHT = 22
export const CITY_HALL_TOWER_THICKNESS = 2.0
export const CITY_HALL_TOWER_DEPTH = 1.5

export const CITY_HALL_PLAZA: BoxPart = { x: 0, y0: 0, z: 4.0, w: 16, h: 0.25, d: 5 }
export const CITY_HALL_PODIUM: BoxPart = { x: 0, y0: 0.25, z: -2.0, w: 12, h: 1.0, d: 6 }
export const CITY_HALL_SAUCER = { x: 0, z: -2.0, y0: 1.25, radius: 3.4, height: 1.8 }
export const CITY_HALL_POOL: BoxPart = { x: 0, y0: 0.25, z: 4.0, w: 8, h: 0.3, d: 2.6 }
export const CITY_HALL_ARCH_XS: readonly number[] = [-2.5, 0, 2.5]
export const CITY_HALL_ARCH = { radius: 1.4, tube: 0.09, y: 0.6, z: 4.0 }

export const CITY_HALL_SIGN_COLORS: readonly string[] = [
  '#ff9b47',
  '#ffd479',
  '#6fd8b8',
  '#7fd0ff',
  '#b9a8ff',
  '#ff7a6b',
  '#8fd18f',
]

export interface SignBlock {
  x: number
  y: number
  z: number
  color: string
}

/** Seven small emissive blocks forming a stylised sign bar near the pool edge. */
export function cityHallSignBlocks(): SignBlock[] {
  return CITY_HALL_SIGN_COLORS.map((color, i) => ({
    x: -3 + i * 1.0,
    y: 0.85,
    z: 6.0,
    color,
  }))
}

export type TowerSide = 'east' | 'west'

export interface TowerPoint {
  x: number
  z: number
  top: number
}

/**
 * Concave curved-tower centreline: the middle bows toward the centre so the
 * inner faces look at each other across the saucer. z runs -5.5..0.5.
 */
export function cityHallTowerArcPoints(side: TowerSide, segments = 7): TowerPoint[] {
  const sign = side === 'east' ? 1 : -1
  const top = side === 'east' ? CITY_HALL_TOWER_EAST_HEIGHT : CITY_HALL_TOWER_WEST_HEIGHT
  const out: TowerPoint[] = []
  for (let i = 0; i < segments; i += 1) {
    const t = segments === 1 ? 0.5 : i / (segments - 1)
    const z = -5.5 + t * 6.0
    const x = sign * (6.0 - 1.1 * Math.sin(t * Math.PI))
    out.push({ x, z, top })
  }
  return out
}

// --- ROM Crystal (12 x 12, 16 high) --------------------------------------------

export const ROM_FOOTPRINT: Footprint = { w: 12, d: 12 }
export const ROM_HEIGHT = 16
export const ROM_BASE: BoxPart = { x: 0, y0: 0, z: 0, w: 10, h: 3, d: 10 }
export const ROM_CORNICE: BoxPart = { x: 0, y0: 3.0, z: 0, w: 10.4, h: 0.4, d: 10.4 }

export interface RomPrism {
  position: [number, number, number]
  rotation: [number, number, number]
  size: [number, number, number]
  material: 'alu' | 'glass'
}

export const ROM_PRISMS: readonly RomPrism[] = [
  { position: [0, 8.0, 0], rotation: [0.35, 0.3, 0.2], size: [3.6, 9, 3.2], material: 'glass' },
  { position: [-2.2, 7.2, -1.2], rotation: [-0.3, 0.5, -0.25], size: [3.0, 7.5, 2.8], material: 'alu' },
  { position: [2.3, 7.0, 1.0], rotation: [0.3, -0.4, 0.35], size: [2.8, 7.0, 3.0], material: 'glass' },
  { position: [0.5, 6.5, -2.5], rotation: [-0.35, 0.2, 0.3], size: [2.6, 6.0, 2.6], material: 'alu' },
  { position: [-0.8, 6.8, 2.4], rotation: [0.25, -0.3, -0.35], size: [2.4, 5.5, 2.4], material: 'glass' },
]

type Vec3 = [number, number, number]

function rotationMatrixXYZ(rotation: Vec3): number[][] {
  const [rx, ry, rz] = rotation
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  // Matches three.js Euler 'XYZ' convention used by R3F rotation props.
  return [
    [cy * cz, -cy * sz, sy],
    [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
    [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
  ]
}

/** Eight world-space corners of a prism in landmark-local coordinates. */
export function romPrismCorners(prism: RomPrism): Vec3[] {
  const m = rotationMatrixXYZ(prism.rotation)
  const [sx, sy, sz] = prism.size
  const [cx, cy, cz] = prism.position
  const out: Vec3[] = []
  for (const ox of [-sx / 2, sx / 2]) {
    for (const oy of [-sy / 2, sy / 2]) {
      for (const oz of [-sz / 2, sz / 2]) {
        out.push([
          cx + m[0][0] * ox + m[0][1] * oy + m[0][2] * oz,
          cy + m[1][0] * ox + m[1][1] * oy + m[1][2] * oz,
          cz + m[2][0] * ox + m[2][1] * oy + m[2][2] * oz,
        ])
      }
    }
  }
  return out
}

export interface SlitTransform {
  position: Vec3
  rotation: Vec3
}

/** Diagonal window slits scattered over the crystal faces (stylised, static). */
export function romSlitTransforms(): SlitTransform[] {
  return [
    { position: [0.4, 9.5, 1.7], rotation: [0.35, 0.3, 0.5] },
    { position: [-0.5, 8.2, 1.75], rotation: [0.35, 0.3, 0.5] },
    { position: [-2.0, 8.0, 0.35], rotation: [-0.3, 0.5, 0.5] },
    { position: [-2.4, 6.8, -0.2], rotation: [-0.3, 0.5, 0.5] },
    { position: [2.5, 7.8, 2.1], rotation: [0.3, -0.4, -0.5] },
    { position: [2.1, 6.6, 2.4], rotation: [0.3, -0.4, -0.5] },
    { position: [0.7, 7.0, -1.1], rotation: [-0.35, 0.2, 0.5] },
    { position: [-0.6, 7.4, 3.4], rotation: [0.25, -0.3, -0.5] },
  ]
}

// --- Distillery District (16 x 10, 10 high) -------------------------------------

export const DISTILLERY_FOOTPRINT: Footprint = { w: 16, d: 10 }
export const DISTILLERY_HEIGHT = 10

export interface DistilleryBuilding extends BoxPart {
  roofH: number
}

export function distilleryBuildings(): DistilleryBuilding[] {
  return [
    { x: -4.5, y0: 0, z: 3.0, w: 6.0, h: 5.5, d: 3.2, roofH: 1.8 },
    { x: 4.5, y0: 0, z: 3.0, w: 6.0, h: 4.5, d: 3.2, roofH: 1.6 },
    { x: -4.8, y0: 0, z: -3.0, w: 5.5, h: 6.0, d: 3.0, roofH: 2.0 },
    { x: 4.2, y0: 0, z: -2.8, w: 6.5, h: 5.0, d: 3.4, roofH: 1.7 },
  ]
}

export const DISTILLERY_CHIMNEY: BoxPart = { x: 7.0, y0: 0, z: -3.8, w: 0.9, h: 9.0, d: 0.9 }
export const DISTILLERY_LANE: BoxPart = { x: 0, y0: 0.02, z: 0, w: 16, h: 0.08, d: 2.0 }
/** Roof diamonds (4-sided cones, unrotated) overhang the walls by ~6%. */
export const DISTILLERY_ROOF_OVERHANG = 1.06

/** Axis-aligned bound of a pyramid roof base for footprint checks. */
export function distilleryRoofBase(b: DistilleryBuilding): BoxPart {
  return {
    x: b.x,
    y0: b.y0 + b.h,
    z: b.z,
    w: b.w * DISTILLERY_ROOF_OVERHANG,
    h: b.roofH,
    d: b.d * DISTILLERY_ROOF_OVERHANG,
  }
}

/** Warm windows dotted over the street and lane faces of each block. */
export function distilleryWindows(): WindowDot[] {
  const out: WindowDot[] = []
  for (const b of distilleryBuildings()) {
    const rows = Math.max(1, Math.floor(b.h / 1.8))
    const cols = Math.max(2, Math.floor(b.w / 1.4))
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if ((r + c) % 2 === 0) continue
        const x = b.x - b.w / 2 + ((c + 0.5) / cols) * b.w
        const y = 1.2 + r * 1.6
        if (y > b.h - 0.6) continue
        // Alternate street face (+z side) and lane face to keep both edges lit.
        const z = b.z > 0 ? b.z - b.d / 2 - 0.06 : b.z + b.d / 2 + 0.06
        out.push({ x, y, z })
      }
    }
  }
  return out
}
