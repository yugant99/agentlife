import { Instance, Instances } from '@react-three/drei'
import { useMemo } from 'react'
import type { LandmarkProps } from './landmarkTypes.ts'
import {
  UNION_COLUMN,
  unionBlocks,
  unionColumnPositions,
  unionWindowPositions,
} from './civicGeometry.ts'

// Union Station: long Beaux-Arts stone front, 22 instanced columns, heavy
// cornice, raised central portico, warm windows between columns. Scenery only.
export function UnionStation(props: LandmarkProps) {
  const { position, rotationY, scale, quality } = props
  const columns = useMemo(() => unionColumnPositions(), [])
  const windows = useMemo(() => unionWindowPositions(), [])
  const blocks = useMemo(() => unionBlocks(), [])
  const radial = quality === 'low' ? 6 : 10
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      {blocks.map((b, i) => (
        <mesh key={i} position={[b.x, b.y0 + b.h / 2, b.z]} receiveShadow>
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshStandardMaterial
            color={i === blocks.length - 1 ? '#a89a86' : '#8f887c'}
            roughness={0.9}
            metalness={0.05}
          />
        </mesh>
      ))}
      <Instances limit={columns.length} receiveShadow>
        <cylinderGeometry args={[UNION_COLUMN.radius, UNION_COLUMN.radius * 1.12, UNION_COLUMN.height, radial]} />
        <meshStandardMaterial color="#b3a894" roughness={0.85} />
        {columns.map((c, i) => (
          <Instance key={i} position={[c.x, UNION_COLUMN.y0 + UNION_COLUMN.height / 2, c.z]} />
        ))}
      </Instances>
      <Instances limit={Math.max(1, windows.length)}>
        <boxGeometry args={[0.55, 2.0, 0.12]} />
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
