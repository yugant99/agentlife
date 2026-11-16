// Facade window atlas (Lane 1C, repainted for the showcase pass). Pure layout
// math, injected canvas painting and shader-string patching, so node tests can
// verify size, grid, lit counts and the world mapping without a DOM or WebGL.
//
// A 512x1024 atlas holds an 8x16 grid of window bays. Each bay is wall with an
// inset window (sill, floor band and a centre mullion), so windows read as
// windows instead of a checkerboard. The scene builds one color canvas (`map`)
// and one emissive canvas (`emissiveMap`) from the same layout; both degrade to
// null when no canvas factory is available, and the scene falls back to flat
// colour.
//
// Mapping: each building part fits a whole number of window bays (about
// FACADE_BAY_WORLD_W wide) across every wall and whole floors (about
// FACADE_FLOOR_WORLD_H tall) up, starting at a per-part offset into the
// repeating atlas. Windows stay near one size on every building, never get cut
// at a corner or roof edge, and neighbours show different slices of the
// pattern. Roofs and parts too short for a floor show plain wall. The GLSL
// lives in patchFacadeShader; facadeUvAt mirrors it in JS for tests.

export const FACADE_ATLAS_WIDTH = 512
export const FACADE_ATLAS_HEIGHT = 1024
export const FACADE_GRID_COLS = 8
export const FACADE_GRID_ROWS = 16

/** Target world width of one window bay. */
export const FACADE_BAY_WORLD_W = 2.0
/** Target world height of one floor. */
export const FACADE_FLOOR_WORLD_H = 2.6

/** Share of windows lit in the static atlas (live glow stays in DistrictWindows). */
export const FACADE_LIT_RATIO = 0.3

// Window inset inside a 64x64 bay, in atlas pixels.
const WINDOW_MARGIN_X = 13
const WINDOW_MARGIN_TOP = 12
const WINDOW_MARGIN_BOTTOM = 18
const FLOOR_BAND_PX = 2
const SILL_PX = 2
const MULLION_PX = 2

export const FACADE_WALL = '#d8dce2'
const FLOOR_BAND = '#99a0aa'
const SILL = '#e3e6eb'
const MULLION_UNLIT = '#4a525e'
const MULLION_LIT = '#c98f4f'
const BLIND = '#8a6a48'

// Lit glass: warm tungsten mostly, a little daylight white, rare cool screen glow.
// Index-aligned with the emissive palette so a window's color and glow agree.
const LIT_GLASS = ['#ffd59a', '#ffc678', '#fff0d2', '#ffb35c', '#cfe6ff']
const LIT_GLOW = ['#ffc37a', '#ffb060', '#ffe7bf', '#e8954a', '#9fcfff']
const LIT_WEIGHTS = [5, 4, 2, 3, 1]
const UNLIT_GLASS = ['#1d2530', '#243041', '#2b2f3b', '#202833']

export interface FacadeCell {
  col: number
  row: number
  x: number
  y: number
  w: number
  h: number
  lit: boolean
  /** Index into the lit palettes (lit cells) or the unlit palette. */
  tone: number
  /** Lit window with a half-drawn blind. */
  blind: boolean
}

export interface WindowRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Facade2DContext {
  fillStyle: string
  fillRect: (x: number, y: number, w: number, h: number) => void
}

export interface FacadeCanvas {
  width: number
  height: number
  getContext: (contextId: '2d') => Facade2DContext | null
}

export type FacadeCanvasFactory = (w: number, h: number) => FacadeCanvas | null | undefined

/** Clamp any value into the 0..1 lit-ratio range (non-finite → 0). */
export function clampLitRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

/**
 * Window lit ratio for a district from its fresh-active worker count (the same
 * `glowCounts` the scene already computes). Base glow so empty districts stay
 * legible, steep steps for 1–3 workers, capped so a crowd never blows out.
 */
export function litRatioForActiveCount(active: number): number {
  if (!Number.isFinite(active) || active <= 0) return 0.18
  return Math.min(0.92, 0.28 + 0.22 * Math.min(3, active))
}

// Small deterministic PRNG (mulberry32) so the atlas is identical every load.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ATLAS_SEED = 0x5eed1c

function weightedIndex(weights: readonly number[], roll: number): number {
  const total = weights.reduce((sum, w) => sum + w, 0)
  let acc = 0
  for (let i = 0; i < weights.length; i += 1) {
    acc += weights[i] / total
    if (roll < acc) return i
  }
  return weights.length - 1
}

function shuffled(count: number, random: () => number): number[] {
  const order = Array.from({ length: count }, (_, index) => index)
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const swap = order[i]
    order[i] = order[j]
    order[j] = swap
  }
  return order
}

/**
 * Grid layout for an atlas. Exactly round(ratio * cols*rows) cells are lit,
 * spread evenly over floors (each floor gets its share, +1 on a few) and
 * scattered within each floor by a seeded shuffle, so no slice of the atlas a
 * short building shows is a fully dark band. Tones and blinds come from the
 * same seed: deterministic per cell.
 */
export function describeFacadeAtlas(litRatio: number): FacadeCell[] {
  const ratio = clampLitRatio(litRatio)
  const total = FACADE_GRID_COLS * FACADE_GRID_ROWS
  const litCount = Math.round(ratio * total)
  const cellW = FACADE_ATLAS_WIDTH / FACADE_GRID_COLS
  const cellH = FACADE_ATLAS_HEIGHT / FACADE_GRID_ROWS
  const random = mulberry32(ATLAS_SEED)
  const perRow = Math.floor(litCount / FACADE_GRID_ROWS)
  const extraRows = new Set(shuffled(FACADE_GRID_ROWS, random).slice(0, litCount - perRow * FACADE_GRID_ROWS))
  const lit = new Set<number>()
  for (let row = 0; row < FACADE_GRID_ROWS; row += 1) {
    const count = perRow + (extraRows.has(row) ? 1 : 0)
    for (const col of shuffled(FACADE_GRID_COLS, random).slice(0, count)) lit.add(row * FACADE_GRID_COLS + col)
  }
  const cells: FacadeCell[] = []
  for (let row = 0; row < FACADE_GRID_ROWS; row += 1) {
    for (let col = 0; col < FACADE_GRID_COLS; col += 1) {
      const index = row * FACADE_GRID_COLS + col
      const isLit = lit.has(index)
      const toneRoll = random()
      const blindRoll = random()
      cells.push({
        col,
        row,
        x: col * cellW,
        y: row * cellH,
        w: cellW,
        h: cellH,
        lit: isLit,
        tone: isLit ? weightedIndex(LIT_WEIGHTS, toneRoll) : Math.floor(toneRoll * UNLIT_GLASS.length),
        blind: isLit && blindRoll < 0.25,
      })
    }
  }
  return cells
}

/** The glass rectangle inside a bay: wall on every side, a deeper sill below. */
export function windowRect(cell: Pick<FacadeCell, 'x' | 'y' | 'w' | 'h'>): WindowRect {
  return {
    x: cell.x + WINDOW_MARGIN_X,
    y: cell.y + WINDOW_MARGIN_TOP,
    w: cell.w - 2 * WINDOW_MARGIN_X,
    h: cell.h - WINDOW_MARGIN_TOP - WINDOW_MARGIN_BOTTOM,
  }
}

function openCanvas(createCanvas: FacadeCanvasFactory | null | undefined): { canvas: FacadeCanvas; ctx: Facade2DContext } | null {
  if (!createCanvas) return null
  const canvas = createCanvas(FACADE_ATLAS_WIDTH, FACADE_ATLAS_HEIGHT)
  if (!canvas) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  return { canvas, ctx }
}

/**
 * Paint the color atlas: light wall (so instance colors survive as `map`),
 * floor bands, sills, then glass with a centre mullion. Returns null when the
 * factory is unavailable or throws (scene degrades to flat colour).
 */
export function paintFacadeColorMap(
  createCanvas: FacadeCanvasFactory | null | undefined,
  litRatio: number,
): FacadeCanvas | null {
  try {
    const opened = openCanvas(createCanvas)
    if (!opened) return null
    const { canvas, ctx } = opened
    ctx.fillStyle = FACADE_WALL
    ctx.fillRect(0, 0, FACADE_ATLAS_WIDTH, FACADE_ATLAS_HEIGHT)
    for (const cell of describeFacadeAtlas(litRatio)) {
      const glass = windowRect(cell)
      ctx.fillStyle = FLOOR_BAND
      ctx.fillRect(cell.x, cell.y + cell.h - FLOOR_BAND_PX, cell.w, FLOOR_BAND_PX)
      ctx.fillStyle = SILL
      ctx.fillRect(glass.x - 2, glass.y + glass.h, glass.w + 4, SILL_PX)
      ctx.fillStyle = cell.lit ? LIT_GLASS[cell.tone] : UNLIT_GLASS[cell.tone]
      ctx.fillRect(glass.x, glass.y, glass.w, glass.h)
      if (cell.blind) {
        ctx.fillStyle = BLIND
        ctx.fillRect(glass.x, glass.y, glass.w, Math.round(glass.h * 0.4))
      }
      ctx.fillStyle = cell.lit ? MULLION_LIT : MULLION_UNLIT
      ctx.fillRect(glass.x + Math.round((glass.w - MULLION_PX) / 2), glass.y, MULLION_PX, glass.h)
    }
    return canvas
  } catch {
    return null
  }
}

/**
 * Paint the emissive atlas: black, with lit glass glowing in its tone (blinds
 * and mullions stay dark). Used as `emissiveMap`; same layout as the color map.
 */
export function paintFacadeEmissiveMap(
  createCanvas: FacadeCanvasFactory | null | undefined,
  litRatio: number,
): FacadeCanvas | null {
  try {
    const opened = openCanvas(createCanvas)
    if (!opened) return null
    const { canvas, ctx } = opened
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, FACADE_ATLAS_WIDTH, FACADE_ATLAS_HEIGHT)
    for (const cell of describeFacadeAtlas(litRatio)) {
      if (!cell.lit) continue
      const glass = windowRect(cell)
      ctx.fillStyle = LIT_GLOW[cell.tone]
      ctx.fillRect(glass.x, glass.y, glass.w, glass.h)
      ctx.fillStyle = '#000000'
      if (cell.blind) ctx.fillRect(glass.x, glass.y, glass.w, Math.round(glass.h * 0.4))
      ctx.fillRect(glass.x + Math.round((glass.w - MULLION_PX) / 2), glass.y, MULLION_PX, glass.h)
    }
    return canvas
  } catch {
    return null
  }
}

// --- Per-part mapping -------------------------------------------------------------

/** Parts shorter than this paint plain wall: too short for a whole floor. */
export const FACADE_MIN_WINDOW_PART_H = 1.8

/** A building part as the scene instances it: a unit box scaled and centred. */
export interface FacadePart {
  x: number
  z: number
  y0: number
  w: number
  h: number
  d: number
}

/** Whole floors fitted to a part's height (0 means plain wall). */
export function facadeFloors(height: number): number {
  if (!(height >= FACADE_MIN_WINDOW_PART_H)) return 0
  return Math.max(1, Math.round(height / FACADE_FLOOR_WORLD_H))
}

/** Whole window bays fitted to a wall's width (at least one). */
export function facadeBays(width: number): number {
  if (!(width > 0)) return 1
  return Math.max(1, Math.round(width / FACADE_BAY_WORLD_W))
}

// Per-part offset into the atlas, in whole cells, so neighbours show different
// slices. Mirrors the GLSL hash (results can differ in the last float bits
// between JS and the GPU; only the "whole cells" property matters).
function partPhase(x: number, z: number): [number, number] {
  const raw = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  const h = raw - Math.floor(raw)
  const h2raw = h * 7.31
  const h2 = h2raw - Math.floor(h2raw)
  return [Math.floor(h * FACADE_GRID_COLS), Math.floor(h2 * FACADE_GRID_ROWS)]
}

/**
 * Atlas UV for a point on a part's facade, mirroring the GLSL in
 * patchFacadeShader. Each wall fits a whole number of bays across and floors
 * up, so windows never get cut at a corner or under a roof edge; window size
 * stays near FACADE_BAY_WORLD_W x FACADE_FLOOR_WORLD_H. Walls facing ±x run
 * along z, walls facing ±z run along x. Roofs, floors and parts too short for
 * a floor return null: they paint plain wall.
 */
export function facadeUvAt(
  world: readonly [number, number, number],
  normal: readonly [number, number, number],
  part: FacadePart,
): [number, number] | null {
  if (Math.abs(normal[1]) > 0.5) return null
  const floors = facadeFloors(part.h)
  if (floors === 0) return null
  const alongZ = Math.abs(normal[0]) > 0.5
  const width = alongZ ? part.d : part.w
  const start = (alongZ ? part.z : part.x) - width / 2
  const along = (alongZ ? world[2] : world[0]) - start
  const up = world[1] - part.y0
  const [phaseU, phaseV] = partPhase(part.x, part.z)
  return [
    ((along / width) * facadeBays(width) + phaseU) / FACADE_GRID_COLS,
    ((up / part.h) * floors + phaseV) / FACADE_GRID_ROWS,
  ]
}

function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Linear-space RGB of a #rrggbb colour (the shader works in linear space). */
export function hexToLinearRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  const channel = (shift: number) => srgbChannelToLinear(((value >> shift) & 0xff) / 255)
  return [channel(16), channel(8), channel(0)]
}

const glslFloat = (value: number) => (Number.isInteger(value) ? `${value}.0` : `${value}`)

export interface PatchableShader {
  vertexShader: string
  fragmentShader: string
}

/**
 * Patch a MeshStandardMaterial shader (three r180 chunk names) so the facade
 * maps use per-part fitted UVs (see facadeUvAt) and roofs and short parts show
 * plain wall with no glow. Reads each part's size and centre from the instance
 * matrix (axis-aligned unit boxes, scaled). Returns false (and leaves the
 * shader alone) if an expected chunk is missing, so a three upgrade degrades
 * to stretched UVs instead of a broken shader.
 */
export function patchFacadeShader(shader: PatchableShader): boolean {
  const uvChunk = '#include <uv_vertex>'
  const mapChunk = '#include <map_fragment>'
  const emissiveChunk = '#include <emissivemap_fragment>'
  if (!shader.vertexShader.includes(uvChunk)) return false
  if (!shader.fragmentShader.includes(mapChunk) || !shader.fragmentShader.includes(emissiveChunk)) return false
  const [r, g, b] = hexToLinearRgb(FACADE_WALL)
  const wall = `vec3( ${glslFloat(r)}, ${glslFloat(g)}, ${glslFloat(b)} )`
  shader.vertexShader = `varying float vFacadeRoof;\n${shader.vertexShader.replace(uvChunk, `${uvChunk}
	{
		#ifdef USE_INSTANCING
			mat4 facadeModel = modelMatrix * instanceMatrix;
		#else
			mat4 facadeModel = modelMatrix;
		#endif
		vec3 facadeWorld = ( facadeModel * vec4( position, 1.0 ) ).xyz;
		vec3 facadeNormal = normalize( mat3( facadeModel ) * normal );
		vec3 partSize = vec3( length( facadeModel[ 0 ].xyz ), length( facadeModel[ 1 ].xyz ), length( facadeModel[ 2 ].xyz ) );
		vec3 partCentre = facadeModel[ 3 ].xyz;
		bool facadeAlongZ = abs( facadeNormal.x ) > 0.5;
		float facadeWidth = facadeAlongZ ? partSize.z : partSize.x;
		float facadeAlong = ( facadeAlongZ ? facadeWorld.z : facadeWorld.x ) - ( ( facadeAlongZ ? partCentre.z : partCentre.x ) - 0.5 * facadeWidth );
		float facadeUp = facadeWorld.y - ( partCentre.y - 0.5 * partSize.y );
		float facadeBays = max( 1.0, floor( facadeWidth / ${glslFloat(FACADE_BAY_WORLD_W)} + 0.5 ) );
		float facadeFloors = partSize.y >= ${glslFloat(FACADE_MIN_WINDOW_PART_H)} ? max( 1.0, floor( partSize.y / ${glslFloat(FACADE_FLOOR_WORLD_H)} + 0.5 ) ) : 0.0;
		float facadeHash = fract( sin( partCentre.x * 12.9898 + partCentre.z * 78.233 ) * 43758.5453 );
		float facadePhaseU = floor( facadeHash * ${glslFloat(FACADE_GRID_COLS)} );
		float facadePhaseV = floor( fract( facadeHash * 7.31 ) * ${glslFloat(FACADE_GRID_ROWS)} );
		vFacadeRoof = ( abs( facadeNormal.y ) > 0.5 || facadeFloors < 1.0 ) ? 1.0 : 0.0;
		vec2 facadeUv = vec2(
			( facadeAlong / facadeWidth * facadeBays + facadePhaseU ) / ${glslFloat(FACADE_GRID_COLS)},
			( facadeUp / partSize.y * max( facadeFloors, 1.0 ) + facadePhaseV ) / ${glslFloat(FACADE_GRID_ROWS)}
		);
		#ifdef USE_MAP
			vMapUv = facadeUv;
		#endif
		#ifdef USE_EMISSIVEMAP
			vEmissiveMapUv = facadeUv;
		#endif
	}`)}`
  shader.fragmentShader = `varying float vFacadeRoof;\n${shader.fragmentShader
    .replace(mapChunk, `#ifdef USE_MAP
		vec4 sampledDiffuseColor = texture2D( map, vMapUv );
		sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, ${wall}, vFacadeRoof );
		diffuseColor *= sampledDiffuseColor;
	#endif`)
    .replace(emissiveChunk, `#ifdef USE_EMISSIVEMAP
		vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
		totalEmissiveRadiance *= emissiveColor.rgb * ( 1.0 - vFacadeRoof );
	#endif`)}`
  return true
}
