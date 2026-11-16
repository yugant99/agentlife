import { Instance, Instances } from '@react-three/drei'
import { useMemo } from 'react'
import type { LandmarkProps } from './landmarkTypes.ts'
import { ROM_BASE, ROM_CORNICE, ROM_PRISMS, romSlitTransforms } from './civicGeometry.ts'

// ROM Crystal: classical stone base bursting with 5 jagged aluminium/glass
// prisms and diagonal window slits. Scenery only.
export function RomCrystal(props: LandmarkProps) {
  const { position, rotationY, scale, quality } = props
  const alu = useMemo(() => ROM_PRISMS.filter((p) => p.material === 'alu'), [])
  const glass = useMemo(() => ROM_PRISMS.filter((p) => p.material === 'glass'), [])
  const slits = useMemo(() => romSlitTransforms(), [])
  // Low tier halves the slit detail; prisms stay (silhouette-critical).
  const shown = quality === 'low' ? slits.slice(0, 4) : slits
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh position={[ROM_BASE.x, ROM_BASE.y0 + ROM_BASE.h / 2, ROM_BASE.z]} receiveShadow>
        <boxGeometry args={[ROM_BASE.w, ROM_BASE.h, ROM_BASE.d]} />
        <meshStandardMaterial color="#8a8478" roughness={0.92} />
      </mesh>
      <mesh position={[ROM_CORNICE.x, ROM_CORNICE.y0 + ROM_CORNICE.h / 2, ROM_CORNICE.z]} receiveShadow>
        <boxGeometry args={[ROM_CORNICE.w, ROM_CORNICE.h, ROM_CORNICE.d]} />
        <meshStandardMaterial color="#a89e90" roughness={0.9} />
      </mesh>
      <Instances limit={alu.length} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#b9c2c9" roughness={0.35} metalness={0.65} />
        {alu.map((p, i) => (
          <Instance key={i} position={p.position} rotation={p.rotation} scale={p.size} />
        ))}
      </Instances>
      <Instances limit={glass.length} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#9fb6c4" roughness={0.2} metalness={0.3} transparent opacity={0.92} />
        {glass.map((p, i) => (
          <Instance key={i} position={p.position} rotation={p.rotation} scale={p.size} />
        ))}
      </Instances>
      <Instances limit={Math.max(1, shown.length)}>
        <boxGeometry args={[0.9, 0.28, 0.1]} />
        <meshStandardMaterial
          color="#ffd9a0"
          emissive="#ffcf8a"
          emissiveIntensity={1.7}
          roughness={0.5}
        />
        {shown.map((s, i) => (
          <Instance key={i} position={s.position} rotation={s.rotation} />
        ))}
      </Instances>
    </group>
  )
}
