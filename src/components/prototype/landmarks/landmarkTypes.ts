// Toronto landmark contract (plan 004). Frozen for the wave: geometry lanes build each
// landmark to its footprint and height, the placement lane carves and positions them.
// Pure and self-contained so node tests can import it.
//
// Landmarks are stylized, procedural, low-poly silhouettes inspired by Toronto, not
// replicas: no copied models, textures or logos. Two carry real aggregate signals (see
// LandmarkSignals); everything else about them is scenery.

import type { QualityTier } from '../sceneControl.ts'

export type LandmarkId = 'cn-tower' | 'rogers-centre' | 'union-station' | 'city-hall' | 'rom-crystal' | 'distillery'
export type LandmarkDistrict = 'citadel' | 'foundry' | 'archive' | 'observatory' | 'port' | 'gateway'

export interface LandmarkSpec {
  id: LandmarkId
  /** Display name for labels and the legend. */
  name: string
  district: LandmarkDistrict
  /** Ground footprint at scale 1 in world units (x = width, z = depth, before rotation). */
  footprint: { w: number; d: number }
  /** Overall height at scale 1 in world units. The hero tower is about 62; the tallest generic building about 48. */
  height: number
}

export const LANDMARKS: readonly LandmarkSpec[] = [
  { id: 'cn-tower', name: 'CN Tower', district: 'port', footprint: { w: 8, d: 8 }, height: 120 },
  { id: 'rogers-centre', name: 'Rogers Centre', district: 'port', footprint: { w: 22, d: 22 }, height: 14 },
  { id: 'union-station', name: 'Union Station', district: 'gateway', footprint: { w: 24, d: 7 }, height: 9 },
  { id: 'city-hall', name: 'City Hall', district: 'citadel', footprint: { w: 18, d: 14 }, height: 30 },
  { id: 'rom-crystal', name: 'ROM Crystal', district: 'observatory', footprint: { w: 12, d: 12 }, height: 16 },
  { id: 'distillery', name: 'Distillery District', district: 'foundry', footprint: { w: 16, d: 10 }, height: 10 },
]

/** Common props for every landmark component. */
export interface LandmarkProps {
  position: [number, number, number]
  rotationY: number
  scale: number
  paused: boolean
  reducedMotion: boolean
  quality: QualityTier
}

/**
 * Real aggregate signals for the two "working" landmarks. Counts only, never per-agent
 * identity. Computed by the placement lane from CityAgent records:
 * - needsYou: fresh agents with workState 'needs-input'
 * - working: fresh agents with workState 'active'
 * - testsRunning: fresh active agents whose toolKind is 'test'
 */
export interface LandmarkSignals {
  needsYou: number
  working: number
  testsRunning: number
}

/** CN Tower: LED band amber while someone needs you, cool white glow scaled by working, dim at rest. */
export type CNTowerProps = LandmarkProps & Pick<LandmarkSignals, 'needsYou' | 'working'>
/** Rogers Centre: field lights on while tests are running; the roof itself is scenery. */
export type RogersCentreProps = LandmarkProps & Pick<LandmarkSignals, 'testsRunning'>
