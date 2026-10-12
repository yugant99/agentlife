// Wave 3 contract between the app shell (prototype-main: tier ladder, arrival glide,
// attract tour) and the scene (CourtyardScene: render pipeline, camera rig). Frozen for
// the wave: lanes consume it, the lead changes it. Pure and self-contained so node tests
// can import it.

export type QualityTier = 'high' | 'medium' | 'low'

export interface QualitySettings {
  /** Upper bound for the device pixel ratio. */
  dprMax: number
  /** Bloom resolution relative to the canvas, or off (analytic glow only). */
  bloom: 'half' | 'quarter' | 'off'
  shadows: boolean
  shadowMapSize: number
  /** 0..1 multiplier for optional effect density (ribbons, glitter, stars, motes). */
  effectDensity: number
}

export const QUALITY_SETTINGS: Record<QualityTier, QualitySettings> = {
  high: { dprMax: 1.6, bloom: 'half', shadows: true, shadowMapSize: 1024, effectDensity: 1 },
  medium: { dprMax: 1.25, bloom: 'quarter', shadows: true, shadowMapSize: 1024, effectDensity: 0.6 },
  low: { dprMax: 1, bloom: 'off', shadows: false, shadowMapSize: 512, effectDensity: 0.4 },
}

/** A camera move requested by the shell. The scene eases to it from the current pose. */
export interface CameraShot {
  /** Stable id; a new id starts a new move, the same id never restarts one. */
  id: string
  position: [number, number, number]
  target: [number, number, number]
  durationMs: number
}

/**
 * Optional scene props for wave 3. Absent values mean: quality 'high', no shot (the
 * normal city/district/agent views own the camera), no reporting.
 */
export interface SceneControlProps {
  quality?: QualityTier
  /** null or absent hands the camera back to the normal views. */
  shot?: CameraShot | null
  /** Smoothed frames per second, reported about once per second. */
  onFrameRate?: (fps: number) => void
  /** Any user camera input (drag, wheel, touch), so a tour can yield immediately. */
  onUserInteract?: () => void
}
