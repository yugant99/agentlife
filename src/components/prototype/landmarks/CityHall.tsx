import { Instance, Instances } from '@react-three/drei'
import { useMemo } from 'react'
import type { LandmarkProps } from './landmarkTypes.ts'
import {
  CITY_HALL_ARCH,
  CITY_HALL_ARCH_XS,
  CITY_HALL_PLAZA,
  CITY_HALL_PODIUM,
  CITY_HALL_POOL,
  CITY_HALL_SAUCER,
  CITY_HALL_TOWER_DEPTH,
  CITY_HALL_TOWER_THICKNESS,
  cityHallSignBlocks,
  cityHallTowerArcPoints,
} from './civicGeometry.ts'

// City Hall: two concave curved towers (east 30, west 22) cradling a white
// saucer on a podium, with a plaza, reflecting pool, three arches and a
// 7-block multicolour sign. No text. Scenery only.
export function CityHall(props: LandmarkProps) {
  const { position, rotationY, scale, quality } = props
  const segments = quality === 'low' ? 5 : quality === 'medium' ? 7 : 9
  const towers = useMemo(
    () => [
      ...cityHallTowerArcPoints('east', segments),
      ...cityHallTowerArcPoints('west', segments),
    ],
    [segments],
  )
  const sign = useMemo(() => cityHallSignBlocks(), [])
  const saucerSeg = quality === 'low' ? 10 : quality === 'medium' ? 16 : 24
  const archSeg = quality === 'low' ? 6 : 12
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh position={[CITY_HALL_PLAZA.x, CITY_HALL_PLAZA.y0 + CITY_HALL_PLAZA.h / 2, CITY_HALL_PLAZA.z]} receiveShadow>
        <boxGeometry args={[CITY_HALL_PLAZA.w, CITY_HALL_PLAZA.h, CITY_HALL_PLAZA.d]} />
        <meshStandardMaterial color="#3a4149" roughness={0.98} />
      </mesh>
      <mesh position={[CITY_HALL_PODIUM.x, CITY_HALL_PODIUM.y0 + CITY_HALL_PODIUM.h / 2, CITY_HALL_PODIUM.z]} receiveShadow>
        <boxGeometry args={[CITY_HALL_PODIUM.w, CITY_HALL_PODIUM.h, CITY_HALL_PODIUM.d]} />
        <meshStandardMaterial color="#9aa0a8" roughness={0.9} />
      </mesh>
      <mesh position={[CITY_HALL_SAUCER.x, CITY_HALL_SAUCER.y0 + CITY_HALL_SAUCER.height / 2, CITY_HALL_SAUCER.z]} receiveShadow>
        <cylinderGeometry args={[CITY_HALL_SAUCER.radius, CITY_HALL_SAUCER.radius * 0.82, CITY_HALL_SAUCER.height, saucerSeg]} />
        <meshStandardMaterial color="#dfe3e6" roughness={0.7} metalness={0.1} />
      </mesh>
      <Instances limit={towers.length} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#4a5462" roughness={0.85} metalness={0.15} />
        {towers.map((t, i) => (
          <Instance
            key={i}
            position={[t.x, t.top / 2, t.z]}
            scale={[CITY_HALL_TOWER_THICKNESS, t.top, CITY_HALL_TOWER_DEPTH]}
          />
        ))}
      </Instances>
      <mesh position={[CITY_HALL_POOL.x, CITY_HALL_POOL.y0 + CITY_HALL_POOL.h / 2, CITY_HALL_POOL.z]} receiveShadow>
        <boxGeometry args={[CITY_HALL_POOL.w, CITY_HALL_POOL.h, CITY_HALL_POOL.d]} />
        <meshStandardMaterial color="#2c343c" roughness={0.9} />
      </mesh>
      <mesh position={[CITY_HALL_POOL.x, CITY_HALL_POOL.y0 + CITY_HALL_POOL.h + 0.02, CITY_HALL_POOL.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CITY_HALL_POOL.w - 0.4, CITY_HALL_POOL.d - 0.4]} />
        <meshStandardMaterial color="#0a1e26" emissive="#2a7a8a" emissiveIntensity={0.7} roughness={0.25} metalness={0.5} />
      </mesh>
      <Instances limit={CITY_HALL_ARCH_XS.length}>
        <torusGeometry args={[CITY_HALL_ARCH.radius, CITY_HALL_ARCH.tube, 6, archSeg, Math.PI]} />
        <meshStandardMaterial color="#c9c2b0" roughness={0.8} />
        {CITY_HALL_ARCH_XS.map((x, i) => (
          <Instance
            key={i}
            position={[x, CITY_HALL_ARCH.y, CITY_HALL_ARCH.z]}
            rotation={[0, Math.PI / 2, 0]}
          />
        ))}
      </Instances>
      <Instances limit={sign.length}>
        <boxGeometry args={[0.7, 1.1, 0.4]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
        {sign.map((s, i) => (
          <Instance key={i} position={[s.x, s.y, s.z]} color={s.color} />
        ))}
      </Instances>
    </group>
  )
}
