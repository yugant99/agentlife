// Canal haze + lamp cones + blob AO (Wave 3 Lane 3A). Three instanced sets, no
// SSAO. Density scales the haze/cone counts via mesh.count (no realloc); the AO
// set always draws fully so grounding survives the low tier (shadows off).
// Opacity pulses freeze while paused or under reduced motion.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import * as city from './city'
import { effectCountForDensity } from './grade'

const HAZE_Y = 1.4
const CONE_HEIGHT = 5
const HAZE_OPACITY = 0.09
const CONE_OPACITY = 0.08
const AO_OPACITY = 0.42

function makeRadialTexture(): THREE.CanvasTexture | null {
  try {
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,255,255,0.85)')
    grad.addColorStop(0.55, 'rgba(255,255,255,0.32)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(canvas)
  } catch {
    return null
  }
}

/** Deterministic samples along the canal polyline (no RNG, stable per reload). */
function canalSamples(count: number): Array<[number, number]> {
  const points = city.CANAL_POINTS
  const lengths: number[] = []
  let total = 0
  for (let i = 0; i + 1 < points.length; i += 1) {
    const len = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1])
    lengths.push(len)
    total += len
  }
  const out: Array<[number, number]> = []
  for (let k = 0; k < count; k += 1) {
    const dist = ((k + 0.5) / count) * total
    let acc = 0
    for (let i = 0; i < lengths.length; i += 1) {
      if (dist <= acc + lengths[i] || i === lengths.length - 1) {
        const t = lengths[i] > 0 ? (dist - acc) / lengths[i] : 0
        out.push([
          points[i][0] + (points[i + 1][0] - points[i][0]) * t,
          points[i][1] + (points[i + 1][1] - points[i][1]) * t,
        ])
        break
      }
      acc += lengths[i]
    }
  }
  return out
}

export function Haze({ density = 1, animate = true }: {
  density?: number
  animate?: boolean
}) {
  const hazeMesh = useRef<THREE.InstancedMesh>(null)
  const coneMesh = useRef<THREE.InstancedMesh>(null)
  const aoMesh = useRef<THREE.InstancedMesh>(null)
  const hazeMat = useRef<THREE.MeshBasicMaterial>(null)
  const coneMat = useRef<THREE.MeshBasicMaterial>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const radial = useMemo(() => makeRadialTexture(), [])
  useEffect(() => () => { radial?.dispose() }, [radial])

  const hazeSpots = useMemo(() => {
    const spots: Array<{ x: number; z: number; w: number; l: number }> = canalSamples(16).map(([x, z], i) => ({
      x: x + Math.sin(i * 12.9898) * 2.2,
      z: z + Math.cos(i * 7.233) * 2.2,
      w: 9 + (i % 4) * 1.8,
      l: 5.5 + (i % 3) * 1.4,
    }))
    for (let k = 0; k < 10; k += 1) {
      const col = k % 5
      const row = Math.floor(k / 5)
      spots.push({
        x: city.HARBOR.x0 + 5 + col * ((city.HARBOR.x1 - city.HARBOR.x0 - 10) / 4) + Math.sin(k * 3.7) * 1.5,
        z: city.HARBOR.z0 + 10 + row * (city.HARBOR.d - 20) + Math.cos(k * 2.3) * 2,
        w: 12 + (k % 3) * 2,
        l: 8 + (k % 2) * 2,
      })
    }
    return spots
  }, [])

  const coneSpots = useMemo(() => [
    ...city.LAMPS.map((lamp) => ({ x: lamp.x, z: lamp.z })),
    ...city.PLAZA_LAMPS.map(([x, z]) => ({ x, z })),
  ], [])

  const aoSpots = useMemo(() => city.BUILDINGS.map((building) => {
    let w = 6
    let d = 6
    for (const part of building.parts) {
      w = Math.max(w, part.w)
      d = Math.max(d, part.d)
    }
    return { x: building.x, z: building.z, r: Math.max(w, d) * 0.72 }
  }), [])

  useEffect(() => {
    const haze = hazeMesh.current
    if (haze) {
      hazeSpots.forEach((spot, i) => {
        dummy.position.set(spot.x, HAZE_Y, spot.z)
        dummy.rotation.set(-Math.PI / 2, 0, 0)
        dummy.scale.set(spot.w, spot.l, 1)
        dummy.updateMatrix()
        haze.setMatrixAt(i, dummy.matrix)
      })
      haze.instanceMatrix.needsUpdate = true
    }
    const cones = coneMesh.current
    if (cones) {
      coneSpots.forEach((spot, i) => {
        dummy.position.set(spot.x, CONE_HEIGHT / 2, spot.z)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        cones.setMatrixAt(i, dummy.matrix)
      })
      cones.instanceMatrix.needsUpdate = true
    }
    const ao = aoMesh.current
    if (ao) {
      aoSpots.forEach((spot, i) => {
        dummy.position.set(spot.x, 0.03, spot.z)
        dummy.rotation.set(-Math.PI / 2, 0, 0)
        dummy.scale.set(spot.r, spot.r, 1)
        dummy.updateMatrix()
        ao.setMatrixAt(i, dummy.matrix)
      })
      ao.instanceMatrix.needsUpdate = true
    }
  }, [hazeSpots, coneSpots, aoSpots, dummy])

  useEffect(() => {
    if (hazeMesh.current) {
      hazeMesh.current.count = Math.max(1, effectCountForDensity(hazeSpots.length, density))
    }
    if (coneMesh.current) {
      coneMesh.current.count = Math.max(1, effectCountForDensity(coneSpots.length, density))
    }
    // AO always draws fully: grounding must survive shadows-off tiers.
  }, [hazeSpots.length, coneSpots.length, density])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (hazeMat.current) {
      hazeMat.current.opacity = animate ? HAZE_OPACITY + 0.015 * Math.sin(t * 0.5) : HAZE_OPACITY
    }
    if (coneMat.current) {
      coneMat.current.opacity = animate ? CONE_OPACITY + 0.012 * Math.sin(t * 0.8 + 1) : CONE_OPACITY
    }
  })

  return (
    <group>
      <instancedMesh ref={hazeMesh} args={[undefined, undefined, hazeSpots.length]} renderOrder={3} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={hazeMat}
          map={radial ?? undefined}
          color="#8fb4c4"
          transparent
          opacity={HAZE_OPACITY}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh ref={coneMesh} args={[undefined, undefined, Math.max(1, coneSpots.length)]} renderOrder={3} frustumCulled={false}>
        <coneGeometry args={[2.3, CONE_HEIGHT, 12, 1, true]} />
        <meshBasicMaterial
          ref={coneMat}
          color="#ffbf6a"
          transparent
          opacity={CONE_OPACITY}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh ref={aoMesh} args={[undefined, undefined, Math.max(1, aoSpots.length)]} renderOrder={1} frustumCulled={false}>
        <circleGeometry args={[1, 20]} />
        <meshBasicMaterial
          map={radial ?? undefined}
          color="#000000"
          transparent
          opacity={AO_OPACITY}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  )
}
