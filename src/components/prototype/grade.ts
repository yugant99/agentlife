// Render-pipeline helpers (Wave 3 Lane 3A). Pure and self-contained: no three.js,
// no React, so node tests can import this directly. Scene code in
// CourtyardScene.tsx, postfx.tsx and haze.tsx stays thin and calls into here.

import { QUALITY_SETTINGS } from './sceneControl.ts'
import type { CameraShot, QualitySettings, QualityTier } from './sceneControl.ts'

export type BloomMode = QualitySettings['bloom']

/** Only emissives pushed above 1.0 halate; the sky and lit diffuse stay under it. */
export const BLOOM_THRESHOLD = 1.0
export const BLOOM_RADIUS = 0.55
export const BLOOM_STRENGTH: Record<BloomMode, number> = { half: 0.75, quarter: 0.55, off: 0 }
/** Bloom resolution relative to the canvas per tier. */
export const BLOOM_SCALE: Record<BloomMode, number> = { half: 0.5, quarter: 0.25, off: 0 }

/** Single ACES exposure for both the direct and composer paths (no double map). */
export const GRADE_EXPOSURE = 1.1
export const GRADE_VIGNETTE = 0.3
export const GRADE_GRAIN = 0.055

/** Unknown or absent tiers fall back to 'high' (the pre-Wave-3 look). */
export function resolveQualityTier(tier: unknown): QualityTier {
  return tier === 'high' || tier === 'medium' || tier === 'low' ? tier : 'high'
}

export function pipelineSettingsForTier(tier?: QualityTier): QualitySettings {
  return QUALITY_SETTINGS[resolveQualityTier(tier)]
}

export function bloomScaleForMode(mode: BloomMode): number {
  return BLOOM_SCALE[mode] ?? 0
}

/** Half/quarter-res bloom target for a canvas; null when bloom is off. */
export function bloomResolution(
  width: number,
  height: number,
  mode: BloomMode,
): { width: number; height: number } | null {
  if (mode === 'off') return null
  const scale = bloomScaleForMode(mode)
  if (!(scale > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}

export function bloomParamsForTier(tier?: QualityTier): {
  enabled: boolean
  mode: BloomMode
  scale: number
  threshold: number
  strength: number
  radius: number
} {
  const settings = pipelineSettingsForTier(tier)
  const mode = settings.bloom
  return {
    enabled: mode !== 'off',
    mode,
    scale: bloomScaleForMode(mode),
    threshold: BLOOM_THRESHOLD,
    strength: BLOOM_STRENGTH[mode] ?? 0,
    radius: BLOOM_RADIUS,
  }
}

export function gradeParamsForState(paused: boolean, reducedMotion: boolean): {
  exposure: number
  vignetteStrength: number
  grainAmount: number
  /** Paused or reduced-motion frames keep a fixed grain field (readable still). */
  freezeGrain: boolean
} {
  return {
    exposure: GRADE_EXPOSURE,
    vignetteStrength: GRADE_VIGNETTE,
    grainAmount: GRADE_GRAIN,
    freezeGrain: paused || reducedMotion,
  }
}

/** Visible instance count for a density-scaled effect set (haze, cones). */
export function effectCountForDensity(base: number, density: number): number {
  if (!Number.isFinite(base) || base <= 0) return 0
  const clamped = Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : 1
  return Math.floor(base * clamped)
}

/** Smoothstep ease shared by the camera rig and the shot tests. */
export function smoothstep01(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped * clamped * (3 - 2 * clamped)
}

/** Linear 0..1 progress of a shot; non-positive durations snap (1). */
export function shotAlpha(elapsedMs: number, durationMs: number): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 1
  return Math.min(1, Math.max(0, elapsedMs / durationMs))
}

export function shotDurationSec(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0
  return durationMs / 1000
}

export type Vec3 = [number, number, number]

/** Eased camera pose at linear progress alpha (0 = from, 1 = to). */
export function easedShotPose(
  fromPos: Vec3,
  fromTarget: Vec3,
  toPos: Vec3,
  toTarget: Vec3,
  alpha01: number,
): { position: Vec3; target: Vec3 } {
  const eased = smoothstep01(alpha01)
  const lerp = (a: number, b: number): number => a + (b - a) * eased
  return {
    position: [lerp(fromPos[0], toPos[0]), lerp(fromPos[1], toPos[1]), lerp(fromPos[2], toPos[2])],
    target: [
      lerp(fromTarget[0], toTarget[0]),
      lerp(fromTarget[1], toTarget[1]),
      lerp(fromTarget[2], toTarget[2]),
    ],
  }
}

/**
 * Same-id no-restart rule: a shot starts a move only when its id differs from
 * the active one. Absent shots never start.
 */
export function shouldStartShotMove(
  activeId: string | null,
  shot: Pick<CameraShot, 'id'> | null | undefined,
): boolean {
  if (!shot) return false
  return shot.id !== activeId
}
