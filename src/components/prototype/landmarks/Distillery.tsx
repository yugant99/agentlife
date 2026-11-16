import { Instance, Instances } from '@react-three/drei'
import { useMemo } from 'react'
import type { LandmarkProps } from './landmarkTypes.ts'
import {
  DISTILLERY_CHIMNEY,
  DISTILLERY_LANE,
  distilleryBuildings,
  distilleryWindows,
} from './civicGeometry.ts'

// Distillery District: red-brick Victorian blocks with pyramid pitched roofs
// around a narrow lane, one tall chimney, warm windows. Scenery only.
export function Distillery(props: LandmarkProps) {
  const { position, rotationY, scale, quality } = props
  const buildings = useMemo(() => distilleryBuildings(), [])
  const windows = useMemo(() => distilleryWindows(), [])
  // Pyramid roofs are already minimal (4 sides); low tier drops height segs.
  const heightSeg = quality === 'low' ? 1 : 2
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh
        position={[DISTILLERY_LANE.x, DISTILLERY_LANE.y0 + DISTILLERY_LANE.h / 2, DISTILLERY_LANE.z]}
        receiveShadow
      >
        <boxGeometry args={[DISTILLERY_LANE.w, DISTILLERY_LANE.h, DISTILLERY_LANE.d]} />
        <meshStandardMaterial color="#2e3138" roughness={0.98} />
      </mesh>
      <Instances limit={buildings.length} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#6b3a2e" roughness={0.95} />
        {buildings.map((b, i) => (
          <Instance key={i} position={[b.x, b.y0 + b.h / 2, b.z]} scale={[b.w, b.h, b.d]} />
        ))}
      </Instances>
      <Instances limit={buildings.length}>
        <coneGeometry args={[1, 1, 4, heightSeg]} />
        <meshStandardMaterial color="#33302e" roughness={0.9} />
        {buildings.map((b, i) => (
          <Instance
            key={i}
            position={[b.x, b.y0 + b.h + b.roofH / 2, b.z]}
            scale={[b.w * 0.53, b.roofH, b.d * 0.53]}
          />
        ))}
      </Instances>
      <mesh
        position={[DISTILLERY_CHIMNEY.x, DISTILLERY_CHIMNEY.y0 + DISTILLERY_CHIMNEY.h / 2, DISTILLERY_CHIMNEY.z]}
        receiveShadow
      >
        <boxGeometry args={[DISTILLERY_CHIMNEY.w, DISTILLERY_CHIMNEY.h, DISTILLERY_CHIMNEY.d]} />
        <meshStandardMaterial color="#5e332a" roughness={0.95} />
      </mesh>
      <Instances limit={Math.max(1, windows.length)}>
        <boxGeometry args={[0.5, 0.6, 0.12]} />
        <meshStandardMaterial
          color="#ffd9a0"
          emissive="#ffbe6a"
          emissiveIntensity={1.8}
          roughness={0.6}
        />
        {windows.map((w, i) => (
          <Instance key={i} position={[w.x, w.y, w.z]} />
        ))}
      </Instances>
    </group>
  )
}
