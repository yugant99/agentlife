// Lamp glitter + district spill streaks (Wave 2 Lane 2B). One instanced set of
// ~40 additive quads laid flat on the water. Spill brightness follows the
// per-district fresh-active count; the beam streak follows the needs-you beam.
// Static while paused or under reduced motion; no per-frame allocations.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import * as city from './city'
import type { DistrictId } from './city'

export const GLITTER_COUNT = 40

interface Streak {
  x: number
  z: number
  w: number
  l: number
  color: string
  district?: DistrictId
  kind: 'beam' | 'spill' | 'lamp' | 'smear'
}

function buildStreaks(): Streak[] {
  const out: Streak[] = []
  out.push({ x: 0, z: 20, w: 1.2, l: 14, color: '#ff9b47', kind: 'beam' })
  out.push({ x: -60, z: 51, w: 2.2, l: 22, color: '#8a9fd0', kind: 'smear' })
  out.push({ x: -63, z: 55, w: 1.6, l: 16, color: '#8a9fd0', kind: 'smear' })
  for (let i = 0; i < 9; i += 1) {
    out.push({ x: -40.5, z: 26 + i * 6, w: 0.7, l: 8 + (i % 3) * 2, color: '#ffbf6a', district: 'port', kind: 'spill' })
  }
  const spillDistricts: DistrictId[] = ['citadel', 'foundry', 'archive', 'observatory', 'port', 'citadel']
  for (let i = 0; i + 1 < city.CANAL_POINTS.length && out.length < 30; i += 1) {
    const [ax, az] = city.CANAL_POINTS[i]
    const [bx, bz] = city.CANAL_POINTS[i + 1]
    for (let k = 0; k < 4 && out.length < 30; k += 1) {
      const t = 0.15 + k * 0.22
      const side = k % 2 === 0 ? 4.6 : -4.6
      const dx = bx - ax
      const dz = bz - az
      const len = Math.hypot(dx, dz) || 1
      out.push({
        x: ax + dx * t + (-dz / len) * side,
        z: az + dz * t + (dx / len) * side,
        w: 0.6, l: 7,
        color: '#ffd9a0',
        district: spillDistricts[(i * 4 + k) % spillDistricts.length],
        kind: 'spill',
      })
    }
  }
  let lamp = 0
  while (out.length < GLITTER_COUNT) {
    const edge = city.HARBOR
    out.push({
      x: edge.x0 + 4 + (lamp % 5) * 7, z: edge.z1 - 3 - Math.floor(lamp / 5) * 8,
      w: 0.6, l: 6, color: '#ffbf6a', kind: 'lamp',
    })
    lamp += 1
  }
  return out.slice(0, GLITTER_COUNT)
}

function spillScale(count: number): number {
  return 0.1 + 0.9 * (Math.min(3, Math.max(0, count)) / 3)
}

export function WaterGlitter({ counts, beamXZ, beamOn, animate }: {
  counts: Record<DistrictId, number>
  beamXZ: [number, number] | null
  beamOn: boolean
  animate: boolean
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const scratch = useMemo(() => new THREE.Color(), [])
  const streaks = useMemo(() => buildStreaks(), [])
  const alphaMap = useMemo(() => {
    try {
      if (typeof document === 'undefined') return null
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 256
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      const grad = ctx.createLinearGradient(0, 0, 0, 256)
      grad.addColorStop(0, 'rgba(255,255,255,0.9)')
      grad.addColorStop(0.6, 'rgba(255,255,255,0.35)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 64, 256)
      const texture = new THREE.CanvasTexture(canvas)
      return texture
    } catch {
      return null
    }
  }, [])
  useEffect(() => () => { alphaMap?.dispose() }, [alphaMap])

  useEffect(() => {
    const node = mesh.current
    if (!node) return
    for (let i = 0; i < streaks.length; i += 1) {
      const streak = streaks[i]
      const x = streak.kind === 'beam' && beamXZ ? beamXZ[0] : streak.x
      const z = streak.kind === 'beam' && beamXZ ? beamXZ[1] : streak.z
      dummy.position.set(x, 0.32, z)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.set(streak.w, streak.l, 1)
      dummy.updateMatrix()
      node.setMatrixAt(i, dummy.matrix)
      if (streak.kind === 'beam') {
        scratch.set(streak.color).multiplyScalar(beamOn ? 0.85 : 0)
      } else if (streak.kind === 'smear') {
        scratch.set(streak.color).multiplyScalar(0.14)
      } else if (streak.kind === 'spill' && streak.district) {
        scratch.set(streak.color).multiplyScalar(0.32 * spillScale(counts[streak.district] ?? 0) + 0.04)
      } else {
        scratch.set(streak.color).multiplyScalar(0.16)
      }
      node.setColorAt(i, scratch)
    }
    node.instanceMatrix.needsUpdate = true
    if (node.instanceColor) node.instanceColor.needsUpdate = true
  }, [streaks, counts, beamXZ, beamOn, dummy, scratch])

  useFrame(({ clock }) => {
    const mat = material.current
    if (!mat || !animate) {
      if (mat && mat.opacity !== 0.8) mat.opacity = 0.8
      return
    }
    mat.opacity = 0.72 + 0.08 * Math.sin(clock.elapsedTime * 1.4)
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, GLITTER_COUNT]} renderOrder={2} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={material}
        map={alphaMap ?? undefined}
        color="#ffffff"
        transparent
        opacity={0.8}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  )
}
