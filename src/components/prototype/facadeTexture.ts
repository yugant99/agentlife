// Facade window atlas (Lane 1C). Pure layout math + injected canvas painting so
// node tests can verify size, grid and lit-ratio clamping without a DOM.
//
// A single 256x512 atlas holds a 4x8 window grid with 1px mullions. The scene
// builds one color canvas (used as `map`) and one emissive canvas (used as
// `emissiveMap`) from the same layout; both degrade to null when no canvas
// factory is available, and the scene then falls back to flat colour.

export const FACADE_ATLAS_WIDTH = 256
export const FACADE_ATLAS_HEIGHT = 512
export const FACADE_GRID_COLS = 4
export const FACADE_GRID_ROWS = 8

export interface FacadeCell {
  col: number
  row: number
  x: number
  y: number
  w: number
  h: number
  lit: boolean
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

/**
 * Grid layout for an atlas. Exactly round(ratio * cols*rows) cells are lit,
 * chosen in a deterministic scattered order (stride 13, coprime to 32) so lit
 * windows spread across floors instead of filling top-down.
 */
export function describeFacadeAtlas(litRatio: number): FacadeCell[] {
  const ratio = clampLitRatio(litRatio)
  const total = FACADE_GRID_COLS * FACADE_GRID_ROWS
  const litCount = Math.round(ratio * total)
  const cellW = FACADE_ATLAS_WIDTH / FACADE_GRID_COLS
  const cellH = FACADE_ATLAS_HEIGHT / FACADE_GRID_ROWS
  // Scattered pick order: permutation of 0..31 via stride 13.
  const order: number[] = []
  for (let k = 0; k < total; k += 1) order.push((k * 13) % total)
  const lit = new Set(order.slice(0, litCount))
  const cells: FacadeCell[] = []
  for (let row = 0; row < FACADE_GRID_ROWS; row += 1) {
    for (let col = 0; col < FACADE_GRID_COLS; col += 1) {
      const index = row * FACADE_GRID_COLS + col
      cells.push({
        col,
        row,
        x: col * cellW,
        y: row * cellH,
        w: cellW,
        h: cellH,
        lit: lit.has(index),
      })
    }
  }
  return cells
}

function paintCells(ctx: Facade2DContext, cells: FacadeCell[], paint: (ctx: Facade2DContext, cell: FacadeCell) => void): void {
  for (const cell of cells) paint(ctx, cell)
}

/**
 * Paint the color atlas (light spandrel so instance colors survive as `map`).
 * Returns null when the factory is unavailable or throws (scene degrades to
 * flat colour).
 */
export function paintFacadeColorMap(
  createCanvas: FacadeCanvasFactory | null | undefined,
  litRatio: number,
): FacadeCanvas | null {
  try {
    if (!createCanvas) return null
    const canvas = createCanvas(FACADE_ATLAS_WIDTH, FACADE_ATLAS_HEIGHT)
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#d0d4da'
    ctx.fillRect(0, 0, FACADE_ATLAS_WIDTH, FACADE_ATLAS_HEIGHT)
    const cells = describeFacadeAtlas(litRatio)
    paintCells(ctx, cells, (c, cell) => {
      // 1px mullion frame, then glass inset.
      c.fillStyle = '#7a828c'
      c.fillRect(cell.x, cell.y, cell.w, cell.h)
      c.fillStyle = cell.lit ? '#ffcf8a' : '#2e3844'
      c.fillRect(cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2)
    })
    return canvas
  } catch {
    return null
  }
}

/**
 * Paint the emissive atlas (black with warm lit cells only, used as
 * `emissiveMap` with emissive #ffcf8a). Same layout as the color map.
 */
export function paintFacadeEmissiveMap(
  createCanvas: FacadeCanvasFactory | null | undefined,
  litRatio: number,
): FacadeCanvas | null {
  try {
    if (!createCanvas) return null
    const canvas = createCanvas(FACADE_ATLAS_WIDTH, FACADE_ATLAS_HEIGHT)
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, FACADE_ATLAS_WIDTH, FACADE_ATLAS_HEIGHT)
    const cells = describeFacadeAtlas(litRatio)
    paintCells(ctx, cells, (c, cell) => {
      if (!cell.lit) return
      c.fillStyle = '#ffc37a'
      c.fillRect(cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2)
    })
    return canvas
  } catch {
    return null
  }
}
