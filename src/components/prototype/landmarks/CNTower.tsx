// CN Tower landmark (Toronto lane T1). Stylised low-poly silhouette, not a
// replica: Y-shaped three-finned concrete base tapering into a slim hexagonal
// shaft, main pod at ~60% (dark glass band + white observation ring with a
// thin outer lip + cap), SkyPod ring at ~79%, slender mast to 120 with red
// scenery beacons. LED strips up the shaft follow landmarkSignals (amber slow
// pulse while needsYou > 0, else cool glow scaled by working, dim at rest).
// Easing >= 1.5 s, frozen while paused, snapped under reduced motion.
// Local origin: footprint centre on the ground, front faces +z.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { CNTowerProps } from './landmarkTypes.ts'
import {
  AVIATION_STEADY_LEVEL,
  LANDMARK_EASE_SECONDS,
  TOWER_LED_AMBER,
  TOWER_LED_COOL,
  aviationOnAt,
  ledPulseAt,
  ledTargetFor,
  stepEased,
} from './landmarkSignals.ts'

const HEIGHT = 120
const POD_Y = HEIGHT * 0.6
const SKYPOD_Y = HEIGHT * 0.79
const FIN_COUNT = 3
const LED_COUNT = 3
const BEACON_TOP_Y = HEIGHT - 0.3
const BEACON_MID_Y = SKYPOD_Y + 1.7

const FIN_ANGLES = [Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6]
const LED_ANGLES = [Math.PI / 6, (Math.PI * 5) / 6, (Math.PI * 3) / 2]

export function CNTower({ position, rotationY, scale, paused, reducedMotion, quality, needsYou, working }: CNTowerProps) {
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion
  const needsRef = useRef(needsYou)
  needsRef.current = needsYou
  const workingRef = useRef(working)
  workingRef.current = working

  const detailed = quality !== 'low'
  const radial = quality === 'high' ? 12 : quality === 'medium' ? 8 : 6
  const windowCount = quality === 'high' ? 16 : quality === 'medium' ? 12 : 0

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const amberColor = useMemo(() => new THREE.Color(TOWER_LED_AMBER), [])
  const coolColor = useMemo(() => new THREE.Color(TOWER_LED_COOL), [])

  const geo = useMemo(() => ({
    fin: new THREE.CylinderGeometry(0.9, 2.4, 34, 4, 1),
    shaft: new THREE.CylinderGeometry(1.15, 1.3, 44, 6, 1),
    led: new THREE.BoxGeometry(0.16, 38, 0.16),
    glass: new THREE.CylinderGeometry(3.4, 3.4, 1.8, radial, 1),
    ring: new THREE.CylinderGeometry(4.05, 4.05, 1.3, radial, 1),
    lip: new THREE.TorusGeometry(4.05, 0.14, 6, detailed ? 24 : 12),
    cap: new THREE.CylinderGeometry(2.0, 4.05, 1.6, radial, 1),
    upper: new THREE.CylinderGeometry(0.85, 1.0, 18, 6, 1),
    skyGlass: new THREE.CylinderGeometry(1.75, 1.75, 1.0, radial, 1),
    skyRing: new THREE.CylinderGeometry(2.1, 2.1, 0.7, radial, 1),
    mast: new THREE.CylinderGeometry(0.16, 0.3, HEIGHT - SKYPOD_Y - 0.7, 6, 1),
    beacon: new THREE.SphereGeometry(0.3, 8, 6),
    window: new THREE.PlaneGeometry(0.55, 0.75),
    pad: new THREE.BoxGeometry(8, 0.5, 8),
  }), [radial, detailed])
  useEffect(() => () => { for (const g of Object.values(geo)) g.dispose() }, [geo])

  const mat = useMemo(() => ({
    concrete: new THREE.MeshStandardMaterial({ color: '#9aa2ad', roughness: 0.9, metalness: 0 }),
    white: new THREE.MeshStandardMaterial({ color: '#e8ecf1', roughness: 0.7, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({ color: '#0d1420', roughness: 0.35, metalness: 0.2 }),
    slate: new THREE.MeshStandardMaterial({ color: '#1a2230', roughness: 0.95, metalness: 0 }),
    led: new THREE.MeshStandardMaterial({ color: '#0a0d12', roughness: 0.5, metalness: 0, emissive: TOWER_LED_COOL, emissiveIntensity: 0.25 }),
    beaconTop: new THREE.MeshStandardMaterial({ color: '#1a0505', roughness: 0.5, metalness: 0, emissive: '#ff2a33', emissiveIntensity: 2 }),
    beaconMid: new THREE.MeshStandardMaterial({ color: '#1a0505', roughness: 0.5, metalness: 0, emissive: '#ff2a33', emissiveIntensity: 2 }),
    window: new THREE.MeshStandardMaterial({ color: '#201409', roughness: 0.6, metalness: 0, emissive: '#ff9b47', emissiveIntensity: 1.6 }),
  }), [])
  useEffect(() => () => { for (const m of Object.values(mat)) m.dispose() }, [mat])

  const fins = useRef<THREE.InstancedMesh>(null)
  const leds = useRef<THREE.InstancedMesh>(null)
  const windows = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const node = fins.current
    if (!node) return
    for (let i = 0; i < FIN_COUNT; i += 1) {
      const a = FIN_ANGLES[i]
      dummy.position.set(Math.cos(a) * 1.2, 17, Math.sin(a) * 1.2)
      dummy.rotation.set(0, -a, 0)
      dummy.scale.set(1, 1, 0.32)
      dummy.updateMatrix()
      node.setMatrixAt(i, dummy.matrix)
    }
    node.instanceMatrix.needsUpdate = true
  }, [dummy, geo])

  useLayoutEffect(() => {
    const node = leds.current
    if (!node) return
    for (let i = 0; i < LED_COUNT; i += 1) {
      const a = LED_ANGLES[i]
      dummy.position.set(Math.cos(a) * 1.36, 49, Math.sin(a) * 1.36)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      node.setMatrixAt(i, dummy.matrix)
    }
    node.instanceMatrix.needsUpdate = true
  }, [dummy, geo])

  useLayoutEffect(() => {
    const node = windows.current
    if (!node || windowCount === 0) return
    for (let i = 0; i < windowCount; i += 1) {
      const a = (i / windowCount) * Math.PI * 2
      dummy.position.set(Math.cos(a) * 3.44, POD_Y + 0.9, Math.sin(a) * 3.44)
      dummy.rotation.set(0, Math.PI / 2 - a, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      node.setMatrixAt(i, dummy.matrix)
    }
    node.instanceMatrix.needsUpdate = true
  }, [dummy, windowCount, geo])

  // Eased LED level + own clock (no per-frame allocations, no React state).
  // The target is re-derived only when the counts change.
  const ledLevel = useRef(-1)
  const cachedTarget = useRef({ needs: Number.NaN, work: Number.NaN, amber: false, level: 0.25 })
  const time = useRef(1.7)
  const last = useRef<number | null>(null)
  const started = useRef(false)

  useFrame(({ clock }) => {
    const now = clock.elapsedTime
    const prev = last.current
    last.current = now
    const needs = needsRef.current
    const work = workingRef.current
    const cached = cachedTarget.current
    if (needs !== cached.needs || work !== cached.work) {
      const target = ledTargetFor(needs, work)
      cached.needs = needs
      cached.work = work
      cached.amber = target.color === TOWER_LED_AMBER
      cached.level = target.intensity
    }
    const targetColor = cached.amber ? amberColor : coolColor
    if (reducedRef.current) {
      ledLevel.current = cached.level
      mat.led.emissive.copy(targetColor)
      mat.led.emissiveIntensity = cached.level
      mat.beaconTop.emissiveIntensity = AVIATION_STEADY_LEVEL
      mat.beaconMid.emissiveIntensity = AVIATION_STEADY_LEVEL
      time.current = 1.7
      started.current = true
      return
    }
    if (pausedRef.current || (typeof document !== 'undefined' && document.hidden)) {
      if (!started.current) {
        ledLevel.current = cached.level
        mat.led.emissive.copy(targetColor)
        mat.led.emissiveIntensity = cached.level
        started.current = true
      }
      return
    }
    const delta = prev === null ? 0 : Math.min(0.06, Math.max(0, now - prev))
    if (!started.current) {
      ledLevel.current = cached.level
      mat.led.emissive.copy(targetColor)
      started.current = true
    } else if (delta > 0) {
      ledLevel.current = stepEased(ledLevel.current, cached.level, delta)
      mat.led.emissive.lerp(targetColor, Math.min(1, delta / LANDMARK_EASE_SECONDS))
    }
    time.current += delta
    const pulse = cached.amber ? ledPulseAt(time.current) : 1
    mat.led.emissiveIntensity = ledLevel.current * pulse
    mat.beaconTop.emissiveIntensity = aviationOnAt(time.current, 0) ? 2.5 : 0.15
    mat.beaconMid.emissiveIntensity = aviationOnAt(time.current, 0.8) ? 2.5 : 0.15
  })

  const mastH = HEIGHT - SKYPOD_Y - 0.7
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh geometry={geo.pad} material={mat.slate} position={[0, 0.25, 0]} />
      <instancedMesh ref={fins} args={[geo.fin, mat.concrete, FIN_COUNT]} />
      <mesh geometry={geo.shaft} material={mat.concrete} position={[0, 50, 0]} />
      <instancedMesh ref={leds} args={[geo.led, mat.led, LED_COUNT]} frustumCulled={false} />
      <mesh geometry={geo.glass} material={mat.glass} position={[0, POD_Y + 0.9, 0]} />
      {windowCount > 0 && (
        <instancedMesh ref={windows} args={[geo.window, mat.window, windowCount]} frustumCulled={false} />
      )}
      <mesh geometry={geo.ring} material={mat.white} position={[0, POD_Y + 2.45, 0]} />
      {detailed && (
        <mesh geometry={geo.lip} material={mat.white} position={[0, POD_Y + 3.1, 0]} rotation={[Math.PI / 2, 0, 0]} />
      )}
      <mesh geometry={geo.cap} material={mat.white} position={[0, POD_Y + 3.9, 0]} />
      <mesh geometry={geo.upper} material={mat.concrete} position={[0, POD_Y + 13.7, 0]} />
      <mesh geometry={geo.skyGlass} material={mat.glass} position={[0, SKYPOD_Y - 0.5, 0]} />
      <mesh geometry={geo.skyRing} material={mat.white} position={[0, SKYPOD_Y + 0.35, 0]} />
      <mesh geometry={geo.mast} material={mat.concrete} position={[0, SKYPOD_Y + 0.7 + mastH / 2, 0]} />
      <mesh geometry={geo.beacon} material={mat.beaconMid} position={[0, BEACON_MID_Y, 0]} />
      <mesh geometry={geo.beacon} material={mat.beaconTop} position={[0, BEACON_TOP_Y, 0]} />
    </group>
  )
}
