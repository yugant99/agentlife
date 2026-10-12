// Adaptive quality ladder (Wave 3 Lane 3C). Pure: no DOM, no three.js, so plain
// Node tests can load it. The shell feeds smoothed fps from onFrameRate (~1 Hz)
// into updateQuality and passes the tier to CourtyardScene.
//
// Start 'high': <50 fps for 2 s drops high -> medium, <35 fps for 2 s drops any
// tier -> low, >=58 fps for 10 s steps up one tier. The 50-58 band is a dead
// zone resetting every timer, so borderline rates cannot flap. `?quality=`
// pins the tier.

import type { QualityTier } from './sceneControl.ts'

export type { QualityTier }

/** Sustained fps below this for QUALITY_DOWN_MS drops high -> medium. */
export const QUALITY_MEDIUM_FPS = 50
/** Sustained fps below this for QUALITY_DOWN_MS drops any tier -> low. */
export const QUALITY_LOW_FPS = 35
/** Sustained fps at or above this for QUALITY_UP_MS steps up one tier. */
export const QUALITY_UP_FPS = 58
/** Time below a down-threshold before the tier drops. */
export const QUALITY_DOWN_MS = 2000
/** Time at/above the up-threshold before the tier steps up one tier. */
export const QUALITY_UP_MS = 10000

export interface QualityState {
  tier: QualityTier
  /** Pinned tier from ?quality=; when set the ladder never moves. */
  pinned: QualityTier | null
  below50Ms: number
  below35Ms: number
  above58Ms: number
}

/** Read ?quality=low|medium|high from a URL search string. Anything else -> null. */
export function parseQualityOverride(search: string): QualityTier | null {
  let value: string | null = null
  try {
    value = new URLSearchParams(search).get('quality')
  } catch {
    return null
  }
  return value === 'low' || value === 'medium' || value === 'high' ? value : null
}

export function createQualityState(pinned: QualityTier | null): QualityState {
  return { tier: pinned ?? 'high', pinned, below50Ms: 0, below35Ms: 0, above58Ms: 0 }
}

function capped(value: number, cap: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(value, cap)
}

/**
 * Fold one smoothed fps sample into the ladder. dtMs is the wall-clock time the
 * sample covers (about 1000 ms at the scene's report rate). Never mutates.
 */
export function updateQuality(state: QualityState, fps: number, dtMs: number): QualityState {
  if (state.pinned) return { ...state, tier: state.pinned }
  if (!Number.isFinite(fps) || fps < 0) return state
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? Math.min(dtMs, QUALITY_UP_MS) : 0

  if (fps < QUALITY_LOW_FPS) {
    const below35Ms = capped(state.below35Ms + dt, QUALITY_DOWN_MS)
    const below50Ms = capped(state.below50Ms + dt, QUALITY_DOWN_MS)
    if (below35Ms >= QUALITY_DOWN_MS) {
      return { ...state, tier: 'low', below50Ms: 0, below35Ms: 0, above58Ms: 0 }
    }
    return { ...state, below50Ms, below35Ms, above58Ms: 0 }
  }

  if (fps < QUALITY_MEDIUM_FPS) {
    const below50Ms = capped(state.below50Ms + dt, QUALITY_DOWN_MS)
    if (state.tier === 'high' && below50Ms >= QUALITY_DOWN_MS) {
      return { ...state, tier: 'medium', below50Ms: 0, below35Ms: 0, above58Ms: 0 }
    }
    return { ...state, below50Ms, below35Ms: 0, above58Ms: 0 }
  }

  if (fps >= QUALITY_UP_FPS) {
    const above58Ms = capped(state.above58Ms + dt, QUALITY_UP_MS)
    if (above58Ms >= QUALITY_UP_MS) {
      const tier: QualityTier = state.tier === 'low' ? 'medium' : 'high'
      return { ...state, tier, below50Ms: 0, below35Ms: 0, above58Ms: 0 }
    }
    return { ...state, below50Ms: 0, below35Ms: 0, above58Ms }
  }

  // Dead zone (50-58): healthy enough to hold, too weak to climb. Reset so a
  // borderline rate can never accumulate a transition in either direction.
  return { ...state, below50Ms: 0, below35Ms: 0, above58Ms: 0 }
}
