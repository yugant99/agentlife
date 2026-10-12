import { useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { placeWedgeInto } from './attention.ts'
import type { WedgeOut } from './attention.ts'

export interface AttentionTarget {
  id: string
  x: number
  z: number
}

// R3F edge wedges for the needs-you queue. Rendered inside the Canvas; the lead
// mounts it. Each frame projects the given world positions and moves
// edge-of-screen pointer buttons through refs — no React state per frame, one
// reused Vector3 and one reused out object, so the loop never allocates.
const WEDGE_MARGIN = 30
const WEDGE_Y = 2.5

export function AttentionWedge({ targets, onSelect }: {
  targets: AttentionTarget[]
  onSelect?: (id: string) => void
}) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const out = useMemo<WedgeOut>(() => ({ x: 0, y: 0, angleDeg: 0, onScreen: true }), [])
  const viewport = useMemo(() => ({ width: 0, height: 0 }), [])
  const targetsRef = useRef(targets)
  targetsRef.current = targets
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect

  useFrame(() => {
    const list = targetsRef.current
    const w = size.width
    const h = size.height
    if (w <= 0 || h <= 0) return
    viewport.width = w
    viewport.height = h
    for (let i = 0; i < list.length; i += 1) {
      const el = buttons.current[i]
      if (!el) continue
      const target = list[i]
      // View-space z tells behind vs. in front (camera looks down -Z).
      tmp.set(target.x, WEDGE_Y, target.z).applyMatrix4(camera.matrixWorldInverse)
      const behind = tmp.z > 0
      tmp.set(target.x, WEDGE_Y, target.z).project(camera)
      const ndcX = tmp.x
      const ndcY = tmp.y
      placeWedgeInto(ndcX, ndcY, behind, viewport, WEDGE_MARGIN, out)
      if (out.onScreen) {
        if (el.style.display !== 'none') el.style.display = 'none'
        continue
      }
      if (el.style.display !== 'block') el.style.display = 'block'
      // Position the pill; the arrow glyph rotates toward the target.
      el.style.left = `${out.x.toFixed(1)}px`
      el.style.top = `${out.y.toFixed(1)}px`
      const arrow = el.firstElementChild as HTMLElement | null
      if (arrow) arrow.style.transform = `rotate(${out.angleDeg.toFixed(1)}deg)`
      if (el.dataset.wedge !== target.id) el.dataset.wedge = target.id
    }
  })

  if (targets.length === 0) return null
  return (
    <Html fullscreen zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div className="proto-wedges" aria-label="Off-screen needs-you pointers">
        {targets.map((target, index) => (
          <button
            key={target.id}
            ref={(node) => { buttons.current[index] = node }}
            type="button"
            className="proto-wedge"
            style={{ display: 'none' }}
            onClick={() => selectRef.current?.(target.id)}
            aria-label={`Needs you off-screen: ${target.id}`}
          >
            <span className="proto-wedge-arrow" aria-hidden="true">➤</span>
            <span className="proto-wedge-label">Needs you</span>
          </button>
        ))}
      </div>
    </Html>
  )
}
