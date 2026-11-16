// Rogers Centre landmark (Toronto lane T1). Stylised low-poly silhouette, not
// a replica: round stepped stadium bowl with a band of arched concourse
// openings, and a white segmented retractable dome of 4 panels (3 sliding
// arcs + 1 fixed) shown about half open as static scenery, green field visible
// through the opening. Field-light rings around the rim glow warm white while
// testsRunning > 0, otherwise off, eased >= 1.5 s, frozen while paused,
// snapped under reduced motion.
// Local origin: footprint centre on the ground, front faces +z.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { RogersCentreProps } from './landmarkTypes.ts'
import { stadiumTargetFor, stepEased } from './landmarkSignals.ts'

const RIM_Y = 10
const RIM_R = 9.6
const DOME_R = 14
const DOME_TILT = 0.775
const LIGHT_COUNT = 12

export function RogersCentre({ position, rotationY, scale, paused, reducedMotion, quality, testsRunning }: RogersCentreProps) {
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion
  const testsRef = useRef(testsRunning)
  testsRef.current = testsRunning

  const radial = quality === 'high' ? 28 : quality === 'medium' ? 20 : 12
  const domeSeg = quality === 'high' ? 12 : quality === 'medium' ? 8 : 6
  const archCount = quality === 'high' ? 16 : quality === 'medium' ? 12 : 8

  const dummy = useMemo(() => new THREE.Object3D(), [])

  const geo = useMemo(() => ({
    apron: new THREE.CylinderGeometry(11, 11, 0.5, radial, 1),
    wallLow: new THREE.CylinderGeometry(11, 11, 4, radial, 1),
    wallMid: new THREE.CylinderGeometry(10.3, 10.3, 3, radial, 1),
    wallTop: new THREE.CylinderGeometry(RIM_R, RIM_R, 2.5, radial, 1),
    arch: new THREE.PlaneGeometry(0.9, 1.6),
    rim: new THREE.TorusGeometry(RIM_R, 0.25, 6, radial),
    field: new THREE.CircleGeometry(7, radial),
    // Back half covered (phi pi..2pi), front half open toward +z. The three
    // sliding arcs sit as concentric shells with staggered edges so the
    // segmentation reads. Each cap is the top of its sphere, so the sphere
    // centres sit at y 0: rim edge lands on the rim ring, apex tops out at
    // the 14-unit spec height.
    domeFixed: new THREE.SphereGeometry(DOME_R, domeSeg, 3, Math.PI, Math.PI / 2, 0, DOME_TILT),
    domeSlideA: new THREE.SphereGeometry(DOME_R + 0.12, domeSeg, 3, Math.PI, Math.PI / 2, 0, DOME_TILT),
    domeSlideB: new THREE.SphereGeometry(DOME_R + 0.24, domeSeg, 3, (Math.PI * 3) / 2, Math.PI / 2, 0, DOME_TILT),
    domeSlideC: new THREE.SphereGeometry(DOME_R + 0.36, domeSeg, 3, (Math.PI * 3) / 2 + 0.1, Math.PI / 2, 0, DOME_TILT),
    bulb: new THREE.SphereGeometry(0.22, 8, 6),
  }), [radial, domeSeg])
  useEffect(() => () => { for (const g of Object.values(geo)) g.dispose() }, [geo])

  const mat = useMemo(() => ({
    slate: new THREE.MeshStandardMaterial({ color: '#1a2230', roughness: 0.95, metalness: 0 }),
    wall: new THREE.MeshStandardMaterial({ color: '#232c3d', roughness: 0.85, metalness: 0.05 }),
    concrete: new THREE.MeshStandardMaterial({ color: '#9aa2ad', roughness: 0.9, metalness: 0 }),
    dome: new THREE.MeshStandardMaterial({ color: '#e8ecf1', roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide }),
    field: new THREE.MeshStandardMaterial({ color: '#1f6b46', roughness: 1, metalness: 0 }),
    arch: new THREE.MeshStandardMaterial({ color: '#201409', roughness: 0.6, metalness: 0, emissive: '#ff9b47', emissiveIntensity: 1.2 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#14100a', roughness: 0.5, metalness: 0, emissive: '#fff1d6', emissiveIntensity: 0 }),
  }), [])
  useEffect(() => () => { for (const m of Object.values(mat)) m.dispose() }, [mat])

  const arches = useRef<THREE.InstancedMesh>(null)
  const lamps = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const node = arches.current
    if (!node) return
    for (let i = 0; i < archCount; i += 1) {
      const a = (i / archCount) * Math.PI * 2
      dummy.position.set(Math.cos(a) * 10.36, 6, Math.sin(a) * 10.36)
      dummy.rotation.set(0, Math.PI / 2 - a, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      node.setMatrixAt(i, dummy.matrix)
    }
    node.instanceMatrix.needsUpdate = true
  }, [dummy, archCount, geo])

  useLayoutEffect(() => {
    const node = lamps.current
    if (!node) return
    for (let i = 0; i < LIGHT_COUNT; i += 1) {
      const a = (i / LIGHT_COUNT) * Math.PI * 2
      dummy.position.set(Math.cos(a) * RIM_R, RIM_Y + 0.45, Math.sin(a) * RIM_R)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      node.setMatrixAt(i, dummy.matrix)
    }
    node.instanceMatrix.needsUpdate = true
  }, [dummy, geo])

  // Eased lamp level (no per-frame allocations, no React state).
  const lampLevel = useRef(-1)
  const last = useRef<number | null>(null)
  const started = useRef(false)

  useFrame(({ clock }) => {
    const now = clock.elapsedTime
    const prev = last.current
    last.current = now
    const target = stadiumTargetFor(testsRef.current)
    if (reducedRef.current) {
      lampLevel.current = target
      mat.lamp.emissiveIntensity = target
      started.current = true
      return
    }
    if (pausedRef.current || (typeof document !== 'undefined' && document.hidden)) {
      if (!started.current) {
        lampLevel.current = target
        mat.lamp.emissiveIntensity = target
        started.current = true
      }
      return
    }
    const delta = prev === null ? 0 : Math.min(0.06, Math.max(0, now - prev))
    if (!started.current) {
      lampLevel.current = target
      started.current = true
    } else if (delta > 0) {
      lampLevel.current = stepEased(lampLevel.current, target, delta)
    }
    mat.lamp.emissiveIntensity = lampLevel.current
  })

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh geometry={geo.apron} material={mat.slate} position={[0, 0.25, 0]} />
      <mesh geometry={geo.wallLow} material={mat.wall} position={[0, 2.5, 0]} />
      <mesh geometry={geo.wallMid} material={mat.wall} position={[0, 6, 0]} />
      <mesh geometry={geo.wallTop} material={mat.wall} position={[0, 8.75, 0]} />
      <instancedMesh ref={arches} args={[geo.arch, mat.arch, archCount]} frustumCulled={false} />
      <mesh geometry={geo.rim} material={mat.concrete} position={[0, RIM_Y, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh geometry={geo.field} material={mat.field} position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      <mesh geometry={geo.domeFixed} material={mat.dome} position={[0, 0, 0]} />
      <mesh geometry={geo.domeSlideA} material={mat.dome} position={[0, 0, 0]} />
      <mesh geometry={geo.domeSlideB} material={mat.dome} position={[0, 0, 0]} />
      <mesh geometry={geo.domeSlideC} material={mat.dome} position={[0, 0, 0]} />
      <instancedMesh ref={lamps} args={[geo.bulb, mat.lamp, LIGHT_COUNT]} frustumCulled={false} />
    </group>
  )
}
