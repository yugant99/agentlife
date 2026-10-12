// Edge-of-screen attention math (Wave 2 Lane 2C). Pure and dependency-free so
// plain Node tests (`--experimental-strip-types`) can load it. The R3F component
// (AttentionWedge.tsx) projects world positions with THREE and calls into these
// helpers, writing into a reused out object so the frame loop never allocates.

export interface WedgeViewport {
  width: number
  height: number
}

export interface WedgeOut {
  /** Pixel x inside the viewport (CSS px, origin top-left). */
  x: number
  /** Pixel y inside the viewport (CSS px, origin top-left). */
  y: number
  /** Pointer angle in degrees: atan2(dy, dx), 0 = east, 90 = south (screen y down). */
  angleDeg: number
  /** True when the target is in front of the camera and inside NDC [-1, 1]. */
  onScreen: boolean
}

/** True when the projected point is visible (in front of the camera, inside NDC). */
export function isOnScreen(ndcX: number, ndcY: number, behind: boolean): boolean {
  if (behind) return false
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return false
  return ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1
}

/**
 * Clamp a projected point to the viewport edge. Behind-camera points are flipped
 * to the opposite side so the wedge still points the right way. Writes into `out`
 * (no allocation) for the per-frame path; see `placeWedge` for the allocating wrapper.
 */
export function placeWedgeInto(
  ndcX: number,
  ndcY: number,
  behind: boolean,
  viewport: WedgeViewport,
  margin: number,
  out: WedgeOut,
): void {
  const w = viewport.width
  const h = viewport.height
  const m = Math.max(0, margin)
  if (!(w > 0 && h > 0) || !Number.isFinite(ndcX) || !Number.isFinite(ndcY)) {
    out.x = w / 2
    out.y = m
    out.angleDeg = -90
    out.onScreen = false
    return
  }
  let nx = ndcX
  let ny = ndcY
  if (behind) {
    // Projected coords mirror when behind; flip so the edge side stays correct.
    nx = -nx
    ny = -ny
    // A dead-center behind target still needs a direction: push it downwards.
    if (Math.abs(nx) < 1e-4 && Math.abs(ny) < 1e-4) ny = -1
  }
  const onScreen = isOnScreen(ndcX, ndcY, behind)
  out.onScreen = onScreen
  // NDC -> pixels (origin top-left, y down).
  const px = (nx * 0.5 + 0.5) * w
  const py = (1 - (ny * 0.5 + 0.5)) * h
  const cx = w / 2
  const cy = h / 2
  const dx = px - cx
  const dy = py - cy
  out.angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
  if (onScreen) {
    out.x = px
    out.y = py
    return
  }
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    out.x = cx
    out.y = m
    return
  }
  const halfW = Math.max(0, w / 2 - m)
  const halfH = Math.max(0, h / 2 - m)
  const sx = Math.abs(dx) > 1e-6 ? halfW / Math.abs(dx) : Infinity
  const sy = Math.abs(dy) > 1e-6 ? halfH / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  const clamped = Number.isFinite(s) ? s : 0
  out.x = Math.min(Math.max(cx + dx * clamped, m), Math.max(m, w - m))
  out.y = Math.min(Math.max(cy + dy * clamped, m), Math.max(m, h - m))
}

/** Allocating wrapper for tests and one-shot callers. */
export function placeWedge(
  ndcX: number,
  ndcY: number,
  behind: boolean,
  viewport: WedgeViewport,
  margin = 28,
): WedgeOut {
  const out: WedgeOut = { x: 0, y: 0, angleDeg: 0, onScreen: false }
  placeWedgeInto(ndcX, ndcY, behind, viewport, margin, out)
  return out
}
