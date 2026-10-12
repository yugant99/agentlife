// Procedural footstep-pool texture (plan 003, Wave 2 Lane 2A). Pure layout math
// plus injected canvas painting so Node tests could verify the falloff without
// a DOM. The scene wraps the painted canvas in one THREE.CanvasTexture (built
// once, disposed on unmount) shared by every pool instance; a null canvas
// degrades to untextured additive discs.

export const FOOTSTEP_SIZE = 128
/** Concentric paint steps; more steps means a smoother falloff, same texture. */
export const FOOTSTEP_RINGS = 16

/**
 * Radial falloff 1 at the centre to 0 at the rim. Cosine ease so the pool
 * reads as a soft light disc instead of a hard coin. Non-finite and negative
 * radii read full (never punch a hole); at or past the rim reads 0.
 */
export function footstepAlphaAt(radius01: number): number {
  if (!Number.isFinite(radius01) || radius01 <= 0) return 1
  if (radius01 >= 1) return 0
  return (Math.cos(radius01 * Math.PI) + 1) / 2
}

export interface Footstep2DContext {
  clearRect: (x: number, y: number, w: number, h: number) => void
  fillStyle: string
  globalAlpha: number
  beginPath: () => void
  arc: (x: number, y: number, r: number, start: number, end: number) => void
  fill: () => void
}

export interface FootstepCanvas {
  width: number
  height: number
  getContext: (contextId: '2d') => Footstep2DContext | null
}

export type FootstepCanvasFactory = (w: number, h: number) => FootstepCanvas | null | undefined

/**
 * Paint a soft white disc (alpha carries the falloff; the scene tints it per
 * instance via instanceColor). Outer-to-inner concentric fills so plain
 * canvas composites into a gradient without needing createRadialGradient.
 * Returns null when the factory is unavailable or throws.
 */
export function paintFootstepDisc(
  createCanvas: FootstepCanvasFactory | null | undefined,
): FootstepCanvas | null {
  try {
    if (!createCanvas) return null
    const canvas = createCanvas(FOOTSTEP_SIZE, FOOTSTEP_SIZE)
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const radius = FOOTSTEP_SIZE / 2
    ctx.clearRect(0, 0, FOOTSTEP_SIZE, FOOTSTEP_SIZE)
    for (let step = FOOTSTEP_RINGS; step >= 1; step -= 1) {
      const fraction = step / FOOTSTEP_RINGS
      ctx.globalAlpha = footstepAlphaAt(fraction)
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(radius, radius, radius * fraction, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    return canvas
  } catch {
    return null
  }
}
