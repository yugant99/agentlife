import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CourtyardCharacter, STEP_FREQ } from './CourtyardCharacter'
import { GATEWAY_ARCH, WALK_Y, WORK_SPOTS } from './city'
import type { DistrictId } from './city'
import type { CityAgent, ToolKind } from './agentModel'
import { DWELL_MIN_MS, MAX_RENDERED_WORKERS } from './agentModel'
import { heraldryFor } from './heraldry'
import { buildRoadGraph, pathToSpot } from './cityGraph'
import type { RoadGraph } from './cityGraph'
import {
  canLeaveSpot, childOffset, dominantToolKind, gestureForWorker, layoutTargets,
  RIBBON_MAX_POINTS, ribbonPointsFromRoute, ringFor, RING_COLORS, selectRendered, targetDistrict, tripSpeed, selectLeaving,
} from './movement'
import type { ToolSample } from './movement'
import {
  desaturationForAge, effectForPhase, footstepScaleAt, haloFractionForDuration,
  MOTE_COUNT, MOTE_RADIUS, MOTE_SIZE, rateForPhase, rippleFractionAt, rippleScaleFor,
  THEATRE_MAX, toolSigilColor,
} from './theatre.ts'
import { paintFootstepDisc } from './footstepTexture.ts'
import type { FootstepCanvas } from './footstepTexture.ts'
import { ARRIVAL_FADE_MS, arrivalOpacity, departureOpacity, DEPARTURE_FADE_MS, shouldTether } from './lifecycle'

// Walking workers. A thin reconciler (discrete snapshot changes) retargets walkers
// through the pure planner; one frame loop walks polylines, pulses beams and updates
// tethers through refs. No React state per frame: state only ticks on membership
// changes, walk start/stop flips and fade-out removals.
//
// Motion is truthful: a worker walks only because a real (or clearly labelled
// simulated) signal changed its target district. Pause freezes walkers; reduced
// motion snaps them to their destination.

export const WORKER_SCALE = 1.87
const CHILD_SCALE = 0.8
const MAX_LEAVING = 6
const RECONCILE_MS = 500
const MAX_TETHERS = 16
const SLOT_REPATH_DIST = 0.6
// Name-tag culling: Html tags mount only for hovered, selected or fresh
// needs-input workers within TAG_DISTANCE units, at most MAX_TAGS tags.
const TAG_DISTANCE = 40
const MAX_TAGS = 6
const TAG_CULL_MS = 250
// Circulation + theatre (Lane 2A): one additive instanced set each. Ribbons
// are short flat strips along the remaining route in the exact ring colour,
// hidden under reduced motion and pause. Pools are stride-pulsed soft discs.
// Theatre carries motes/ripples/sigils (at most THEATRE_MAX), fresh only.
const RIBBON_SEGMENTS = RIBBON_MAX_POINTS - 1
const RIBBON_TOTAL = MAX_RENDERED_WORKERS * RIBBON_SEGMENTS
const POOL_TOTAL = MAX_RENDERED_WORKERS
const RIBBON_WIDTH = 1.2
const RIBBON_Y = 0.12
const POOL_Y = 0.13
const POOL_OPACITY = 0.32
const THEATRE_OPACITY = 0.55
const SIGIL_SIZE = 2.4
const HEAD_Y = WALK_Y + 3.4
const SIGIL_Y = WALK_Y + 1.8
const HALO_INNER = 1.38
const HALO_OUTER = 1.55
const HALO_COLOR = '#ffd479'

const CENTERS: Record<DistrictId, readonly [number, number]> = {
  citadel: WORK_SPOTS.citadel.center,
  foundry: WORK_SPOTS.foundry.center,
  archive: WORK_SPOTS.archive.center,
  observatory: WORK_SPOTS.observatory.center,
  port: WORK_SPOTS.port.center,
  gateway: WORK_SPOTS.gateway.center,
}

interface Runtime {
  agent: CityAgent
  pos: THREE.Vector3
  heading: number
  route: [number, number][]
  speed: number
  district: DistrictId
  arrivedAt: number
  moving: boolean
  leaving: boolean
  leaveElapsed: number
  appearElapsed: number
  sealed: boolean
  mats: THREE.Material[] | null
}

function collectMaterials(group: THREE.Group): THREE.Material[] {
  const out: THREE.Material[] = []
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) out.push(...material)
    else if (material) out.push(material)
  })
  return out
}

function polyLength(points: [number, number][]): number {
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1])
  }
  return total
}

export interface WorkersProps {
  agents: CityAgent[]
  selectedId?: string
  paused: boolean
  reducedMotion: boolean
  celebrationBy: Record<string, number>
  onSelect: (id: string) => void
}

/** Discrete world-space targets for every agent (camera rig + retargeting). */
export function workerTargets(agents: CityAgent[]): Map<string, { district: DistrictId; x: number; z: number }> {
  return layoutTargets(agents, CENTERS)
}

export function Workers({ agents, selectedId, paused, reducedMotion, celebrationBy, onSelect }: WorkersProps) {
  const graph = useRef<RoadGraph | null>(null)
  if (!graph.current) graph.current = buildRoadGraph()

  const runtimes = useRef(new Map<string, Runtime>())
  const histories = useRef(new Map<string, ToolSample[]>())
  const groups = useRef(new Map<string, THREE.Group>())
  const chars = useRef(new Map<string, THREE.Group>())
  const beams = useRef(new Map<string, THREE.Mesh>())
  const tetherGeom = useRef<THREE.BufferGeometry | null>(null)
  if (!tetherGeom.current) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TETHERS * 6), 3))
    geometry.setDrawRange(0, 0)
    tetherGeom.current = geometry
  }
  // Lane 2A scratch: one dummy, one colour and two route tuples reused every
  // frame, so the ribbon/pool/theatre writers never allocate and never touch
  // React state. The theatre clock holds while reduced motion is on; pause
  // returns from the loop early, which freezes every effect in place.
  const ribbonRef = useRef<THREE.InstancedMesh | null>(null)
  const poolRef = useRef<THREE.InstancedMesh | null>(null)
  const theatreRef = useRef<THREE.InstancedMesh | null>(null)
  const dummy = useRef<THREE.Object3D | null>(null)
  if (!dummy.current) dummy.current = new THREE.Object3D()
  const tmpColor = useRef<THREE.Color | null>(null)
  if (!tmpColor.current) tmpColor.current = new THREE.Color()
  const ribbonScratch = useRef<[number, number][]>([])
  if (ribbonScratch.current.length === 0) {
    for (let i = 0; i < RIBBON_MAX_POINTS; i += 1) ribbonScratch.current.push([0, 0])
  }
  const posScratch = useRef<[number, number]>([0, 0])
  const theatreTime = useRef(0)
  // Wall-clock frozen for age channels while paused or under reduced motion.
  const stillNow = useRef(0)
  // One flat quad shared by all three instanced sets; one soft-disc texture
  // shared by pools and theatre. Built once, disposed on unmount.
  const flatGeom = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1)
    geometry.rotateX(-Math.PI / 2)
    return geometry
  }, [])
  const footTexture = useMemo(() => {
    if (typeof document === 'undefined') return null
    const canvas = paintFootstepDisc((width, height) => {
      const element = document.createElement('canvas')
      element.width = width
      element.height = height
      return element as unknown as FootstepCanvas
    })
    if (!canvas) return null
    return new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement)
  }, [])

  const clock = useRef(0)
  const lastT = useRef<number | null>(null)
  const reconcileAcc = useRef(0)
  const [, bump] = useReducer((value: number) => value + 1, 0)

  // Tag-culling state. Hover is a discrete React state (pointer events only);
  // the culled tag set lives in a ref and re-renders only when membership
  // changes, so the frame loop never sets state per frame.
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hoveredRef = useRef<string | null>(null)
  hoveredRef.current = hoveredId
  const selectedRef = useRef<string | undefined>(selectedId)
  selectedRef.current = selectedId
  const visibleTags = useRef<Set<string>>(new Set())
  const lastCam = useRef({ x: 0, y: 0, z: 0 })
  const cullAcc = useRef(0)
  const cullScratch = useRef<{ id: string; rank: number; dist: number }[]>([])

  function handleHover(id: string | null): void {
    setHoveredId(id)
  }

  // Recompute the mounted tag set: hovered, selected or fresh needs-input
  // workers within TAG_DISTANCE, ranked selected > hovered > needs-input then
  // nearest, capped at MAX_TAGS. Bumps only when membership changes.
  function runCull(): void {
    const scratch = cullScratch.current
    scratch.length = 0
    const cam = lastCam.current
    const selected = selectedRef.current
    const hovered = hoveredRef.current
    for (const [id, runtime] of runtimes.current) {
      const agent = runtime.agent
      const isSelected = selected === id
      const isHovered = hovered === id
      const needy = !runtime.leaving
        && agent.freshness === 'fresh'
        && agent.workState === 'needs-input'
      if (!isSelected && !isHovered && !needy) continue
      const dx = runtime.pos.x - cam.x
      const dy = runtime.pos.y + 1 - cam.y
      const dz = runtime.pos.z - cam.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist > TAG_DISTANCE) continue
      scratch.push({ id, rank: isSelected ? 0 : isHovered ? 1 : 2, dist })
    }
    scratch.sort((a, b) => a.rank - b.rank || a.dist - b.dist || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const count = Math.min(MAX_TAGS, scratch.length)
    const prev = visibleTags.current
    let same = prev.size === count
    if (same) {
      for (let i = 0; i < count; i += 1) {
        if (!prev.has(scratch[i].id)) {
          same = false
          break
        }
      }
    }
    if (!same) {
      prev.clear()
      for (let i = 0; i < count; i += 1) prev.add(scratch[i].id)
      bump()
    }
  }

  const agentsRef = useRef(agents)
  agentsRef.current = agents
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion

  function pushHistory(id: string, toolKind: ToolKind | undefined) {
    const list = histories.current.get(id) ?? []
    const last = list[list.length - 1]
    if (last && last.toolKind === toolKind && clock.current - last.at < 5000) return
    list.push({ toolKind, at: clock.current })
    while (list.length > 40) list.shift()
    histories.current.set(id, list)
  }

  function buildRoute(runtime: Runtime, tx: number, tz: number, district: DistrictId): boolean {
    const poly = pathToSpot(graph.current!, runtime.pos.x, runtime.pos.z, district)
    poly[poly.length - 1] = [tx, tz]
    const rest = poly.slice(1)
    while (rest.length > 0 && Math.hypot(rest[0][0] - runtime.pos.x, rest[0][1] - runtime.pos.z) < 0.3) rest.shift()
    const full: [number, number][] = [[runtime.pos.x, runtime.pos.z], ...rest]
    const wasMoving = runtime.moving
    runtime.route = rest
    runtime.speed = tripSpeed(polyLength(full))
    runtime.district = district
    if (rest.length > 0) {
      runtime.heading = Math.atan2(rest[0][0] - runtime.pos.x, rest[0][1] - runtime.pos.z)
      runtime.moving = true
    } else {
      runtime.moving = false
      runtime.arrivedAt = clock.current
    }
    // Walk starts are discrete render events: the character reads `moving` from
    // props, so a false->true flip must re-render or the legs never swing.
    return runtime.moving && !wasMoving
  }

  // Discrete reconciler: spawn arrivals, retarget on dominant-tool change (gated by
  // dwell), send historical agents back to the arch. Returns true when membership
  // changed and React must re-render.
  function reconcile(): boolean {
    const all = agentsRef.current
    const byId = new Map(all.map((agent) => [agent.id, agent]))
    const { rendered } = selectRendered(all)
    const renderedIds = new Set(rendered.map((agent) => agent.id))
    const historical = selectLeaving(all, new Set(runtimes.current.keys()), MAX_LEAVING)
    const historicalIds = new Set(historical.map((agent) => agent.id))
    const visible = [...rendered, ...historical]
    const targets = layoutTargets(visible, CENTERS)

    // Membership bumps are discrete: creation, leaving transitions, cap drops and
    // walk starts. Never a size pre-check (a fading departure must not re-render
    // twice a second).
    let changed = false
    for (const agent of visible) pushHistory(agent.id, agent.toolKind)

    for (const agent of visible) {
      const target = targets.get(agent.id)
      if (!target) continue
      let runtime = runtimes.current.get(agent.id)
      if (!runtime) {
        // Arrivals: roots walk in through the Gateway arch; sub-agents appear
        // beside their parent at 0.8x scale.
        const parent = agent.parentId ? runtimes.current.get(agent.parentId) : undefined
        const start: [number, number] = parent
          ? (() => {
            const siblings = visible.filter((entry) => entry.parentId === agent.parentId)
            const sibling = Math.max(0, siblings.findIndex((entry) => entry.id === agent.id))
            const [ox, oz] = childOffset(sibling, siblings.length)
            return [parent.pos.x + ox, parent.pos.z + oz] as [number, number]
          })()
          : [...GATEWAY_ARCH] as [number, number]
        runtime = {
          agent,
          pos: new THREE.Vector3(start[0], WALK_Y, start[1]),
          heading: Math.atan2(target.x - start[0], target.z - start[1]),
          route: [],
          speed: 0,
          district: 'gateway',
          // Arrivals walk off immediately: they were "already waiting" at the gate,
          // so the dwell gate must not hold them for another 20 s.
          arrivedAt: clock.current - DWELL_MIN_MS,
          moving: false,
          leaving: false,
          leaveElapsed: 0,
          appearElapsed: 0,
          sealed: false,
          mats: null,
        }
        runtimes.current.set(agent.id, runtime)
        changed = true
      }
      runtime.agent = agent
      const history = histories.current.get(agent.id) ?? []
      const dominant = dominantToolKind(history, clock.current)

      if (agent.freshness === 'historical') {
        if (!runtime.leaving) {
          runtime.leaving = true
          runtime.leaveElapsed = 0
          const poly = pathToSpot(graph.current!, runtime.pos.x, runtime.pos.z, 'gateway', true)
          const rest = poly.slice(1)
          const full: [number, number][] = [[runtime.pos.x, runtime.pos.z], ...rest]
          runtime.route = rest
          runtime.speed = tripSpeed(polyLength(full))
          runtime.moving = rest.length > 0
          changed = true
        }
        continue
      }

      // Stale workers sit where they are: no retargeting while the snapshot is old.
      if (agent.freshness === 'stale') continue
      const district = targetDistrict(agent, dominant)
      const moved = Math.hypot(target.x - runtime.pos.x, target.z - runtime.pos.z)
      if (reducedRef.current) {
        if (district !== runtime.district || moved > 0.01) {
          runtime.pos.set(target.x, WALK_Y, target.z)
          runtime.route = []
          runtime.moving = false
          runtime.district = district
          runtime.arrivedAt = clock.current
        }
        continue
      }
      if (district !== runtime.district) {
        if (!canLeaveSpot(runtime.arrivedAt, clock.current)) continue
        if (buildRoute(runtime, target.x, target.z, district)) changed = true
      } else if (!runtime.moving && moved > SLOT_REPATH_DIST) {
        // Same district, but the ring slot shifted under us (occupancy changed).
        if (buildRoute(runtime, target.x, target.z, district)) changed = true
      }
    }

    // Snapshots that drop an agent entirely read as departures too.
    for (const [id, runtime] of runtimes.current) {
      if (!byId.has(id) && !renderedIds.has(id) && !historicalIds.has(id) && !runtime.leaving) {
        runtime.leaving = true
        runtime.leaveElapsed = 0
        const poly = pathToSpot(graph.current!, runtime.pos.x, runtime.pos.z, 'gateway', true)
        runtime.route = poly.slice(1)
        runtime.speed = tripSpeed(polyLength([[runtime.pos.x, runtime.pos.z], ...runtime.route]))
        runtime.moving = runtime.route.length > 0
        changed = true
      }
    }

    // Cap the leaving crowd: drop the oldest departures beyond the cap.
    const leaving = [...runtimes.current.entries()].filter(([, runtime]) => runtime.leaving)
    if (leaving.length > MAX_LEAVING) {
      leaving
        .sort((a, b) => a[1].leaveElapsed - b[1].leaveElapsed)
        .slice(0, leaving.length - MAX_LEAVING)
        .forEach(([id]) => {
          runtimes.current.delete(id)
          changed = true
        })
    }
    return changed
  }

  useEffect(() => {
    if (reconcile()) bump()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, reducedMotion])

  // Hover and selection flip the tag set immediately (using the last camera
  // position); the frame loop re-culls on a throttle as the camera moves.
  useEffect(() => {
    runCull()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredId, selectedId])

  useEffect(() => () => {
    tetherGeom.current?.dispose()
    tetherGeom.current = null
    flatGeom.dispose()
    footTexture?.dispose()
  }, [flatGeom, footTexture])

  // Freeze the age-channel clock when the still modes engage; the next
  // discrete render then holds desaturation and halo instead of advancing.
  useEffect(() => {
    if (paused || reducedMotion) stillNow.current = Date.now()
  }, [paused, reducedMotion])

  useFrame(({ clock: frameClock, camera }) => {
    const now = frameClock.elapsedTime
    const delta = lastT.current === null ? 0 : Math.max(0, now - lastT.current)
    lastT.current = now
    if (pausedRef.current) return
    if (typeof document !== 'undefined' && document.hidden) return
    lastCam.current.x = camera.position.x
    lastCam.current.y = camera.position.y
    lastCam.current.z = camera.position.z
    const dtMs = Math.min(delta, 0.06) * 1000
    clock.current += dtMs

    reconcileAcc.current += dtMs
    if (reconcileAcc.current > RECONCILE_MS) {
      reconcileAcc.current = 0
      if (reconcile()) bump()
    }

    cullAcc.current += dtMs
    if (cullAcc.current > TAG_CULL_MS) {
      cullAcc.current = 0
      runCull()
    }

    let flipped = false
    let removed = false
    for (const [id, runtime] of runtimes.current) {
      if (!runtime.mats) {
        const charGroup = chars.current.get(id)
        if (charGroup) {
          runtime.mats = collectMaterials(charGroup)
          for (const material of runtime.mats) material.transparent = true
        }
      }
      if (runtime.moving && runtime.route.length > 0) {
        let step = runtime.speed * (dtMs / 1000)
        while (step > 0 && runtime.route.length > 0) {
          const [wx, wz] = runtime.route[0]
          const dx = wx - runtime.pos.x
          const dz = wz - runtime.pos.z
          const dist = Math.hypot(dx, dz)
          if (dist < 1e-6) {
            runtime.route.shift()
            continue
          }
          runtime.heading = Math.atan2(dx, dz)
          if (step >= dist) {
            runtime.pos.x = wx
            runtime.pos.z = wz
            runtime.route.shift()
            step -= dist
          } else {
            runtime.pos.x += (dx / dist) * step
            runtime.pos.z += (dz / dist) * step
            step = 0
          }
        }
        if (runtime.route.length === 0 && runtime.moving) {
          runtime.moving = false
          runtime.arrivedAt = clock.current
          flipped = true
        }
      }

      if (!runtime.leaving) runtime.appearElapsed += dtMs
      else runtime.leaveElapsed += dtMs
      const fade = runtime.leaving
        ? departureOpacity(runtime.leaveElapsed)
        : arrivalOpacity(Math.min(runtime.appearElapsed, ARRIVAL_FADE_MS))
      if (runtime.mats) {
        if (!runtime.leaving && fade >= 1) {
          if (!runtime.sealed) {
            for (const material of runtime.mats) {
              material.opacity = 1
              material.transparent = false
              material.needsUpdate = true
            }
            runtime.sealed = true
          }
        } else {
          if (runtime.sealed) {
            for (const material of runtime.mats) {
              material.transparent = true
              material.needsUpdate = true
            }
            runtime.sealed = false
          }
          for (const material of runtime.mats) material.opacity = fade
        }
      }

      if (runtime.leaving && runtime.leaveElapsed > DEPARTURE_FADE_MS + 2000) {
        runtimes.current.delete(id)
        histories.current.delete(id)
        removed = true
        continue
      }

      const group = groups.current.get(id)
      if (group) {
        group.position.set(runtime.pos.x, WALK_Y, runtime.pos.z)
        group.rotation.y = runtime.heading
      }
    }
    if (flipped || removed) bump()

    // Needs-input beams pulse slowly; static under reduced motion.
    const pulse = reducedRef.current ? 0.34 : 0.28 + 0.12 * Math.sin(clock.current / 1000 * 1.5)
    for (const mesh of beams.current.values()) {
      const material = mesh.material as THREE.MeshBasicMaterial
      material.opacity = pulse
    }

    // Child-parent tethers while both ends are fresh.
    const geometry = tetherGeom.current
    if (geometry) {
      const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
      const array = attribute.array as Float32Array
      let pairs = 0
      for (const [id, runtime] of runtimes.current) {
        if (pairs >= MAX_TETHERS) break
        const parentId = runtime.agent.parentId
        if (!parentId) continue
        // Runtimes carry the agent from the last reconcile, so no per-frame lookup map.
        const parent = runtimes.current.get(parentId)
        if (!parent) continue
        if (!shouldTether(runtime.agent, parent.agent)) continue
        array[pairs * 6] = runtime.pos.x
        array[pairs * 6 + 1] = runtime.pos.y + 1.4
        array[pairs * 6 + 2] = runtime.pos.z
        array[pairs * 6 + 3] = parent.pos.x
        array[pairs * 6 + 4] = parent.pos.y + 1.4
        array[pairs * 6 + 5] = parent.pos.z
        pairs += 1
      }
      geometry.setDrawRange(0, pairs * 2)
      attribute.needsUpdate = true
    }

    // Circulation + theatre writers (Lane 2A). Ribbons skip under reduced
    // motion (the mesh hides via its visible flag); pools and theatre keep
    // writing with a held clock so the still scene stays legible but frozen.
    const dummyObj = dummy.current
    const colorObj = tmpColor.current
    const ribbonMesh = ribbonRef.current
    const poolMesh = poolRef.current
    const theatreMesh = theatreRef.current
    if (dummyObj && colorObj && ribbonMesh && poolMesh && theatreMesh) {
      const reducedNow = reducedRef.current
      if (!reducedNow) theatreTime.current += dtMs / 1000
      const tNow = theatreTime.current
      const selectedNow = selectedRef.current
      let ribbonUsed = 0
      let poolUsed = 0
      let theatreUsed = 0
      for (const [, runtime] of runtimes.current) {
        const agentNow = runtime.agent
        const freshNow = !runtime.leaving && agentNow.freshness === 'fresh'
        const ringNow = ringFor(agentNow, selectedNow === agentNow.id)
        if (!reducedNow && freshNow && runtime.moving && runtime.route.length > 0) {
          posScratch.current[0] = runtime.pos.x
          posScratch.current[1] = runtime.pos.z
          const points = ribbonPointsFromRoute(
            posScratch.current, runtime.route, RIBBON_MAX_POINTS, ribbonScratch.current,
          )
          colorObj.set(RING_COLORS[ringNow])
          for (let j = 0; j + 1 < points.length && ribbonUsed < RIBBON_TOTAL; j += 1) {
            const dx = points[j + 1][0] - points[j][0]
            const dz = points[j + 1][1] - points[j][1]
            const length = Math.hypot(dx, dz)
            if (length < 1e-4) continue
            dummyObj.position.set(points[j][0] + dx / 2, RIBBON_Y, points[j][1] + dz / 2)
            dummyObj.rotation.set(0, Math.atan2(dx, dz), 0)
            dummyObj.scale.set(RIBBON_WIDTH, 1, length + 0.4)
            dummyObj.updateMatrix()
            ribbonMesh.setMatrixAt(ribbonUsed, dummyObj.matrix)
            ribbonMesh.setColorAt(ribbonUsed, colorObj)
            ribbonUsed += 1
          }
        }
        if (freshNow && runtime.moving && poolUsed < POOL_TOTAL) {
          dummyObj.position.set(runtime.pos.x, POOL_Y, runtime.pos.z)
          dummyObj.rotation.set(0, 0, 0)
          const swell = footstepScaleAt(tNow * STEP_FREQ + poolUsed * 1.7)
          dummyObj.scale.set(swell, 1, swell)
          dummyObj.updateMatrix()
          poolMesh.setMatrixAt(poolUsed, dummyObj.matrix)
          colorObj.set(RING_COLORS[ringNow])
          poolMesh.setColorAt(poolUsed, colorObj)
          poolUsed += 1
        }
        if (freshNow && theatreUsed < THEATRE_MAX) {
          const effect = effectForPhase(agentNow)
          const rate = rateForPhase(agentNow.phase)
          if (effect === 'motes' && theatreUsed + MOTE_COUNT <= THEATRE_MAX) {
            colorObj.set(RING_COLORS.info)
            for (let k = 0; k < MOTE_COUNT; k += 1) {
              // Same orbit as moteOffsetAt, inlined so the loop never allocates.
              const angle = tNow * rate * Math.PI * 2 + (k / MOTE_COUNT) * Math.PI * 2
              dummyObj.position.set(
                runtime.pos.x + Math.cos(angle) * MOTE_RADIUS,
                HEAD_Y,
                runtime.pos.z + Math.sin(angle) * MOTE_RADIUS,
              )
              dummyObj.rotation.set(0, 0, 0)
              dummyObj.scale.set(MOTE_SIZE, 1, MOTE_SIZE)
              dummyObj.updateMatrix()
              theatreMesh.setMatrixAt(theatreUsed, dummyObj.matrix)
              theatreMesh.setColorAt(theatreUsed, colorObj)
              theatreUsed += 1
            }
          } else if (effect === 'ripple') {
            const fraction = rippleFractionAt(tNow, rate)
            const size = rippleScaleFor(fraction)
            dummyObj.position.set(runtime.pos.x, POOL_Y + 0.01, runtime.pos.z)
            dummyObj.rotation.set(0, 0, 0)
            dummyObj.scale.set(size, 1, size)
            dummyObj.updateMatrix()
            theatreMesh.setMatrixAt(theatreUsed, dummyObj.matrix)
            colorObj.set(RING_COLORS.info).multiplyScalar(1 - fraction * 0.75)
            theatreMesh.setColorAt(theatreUsed, colorObj)
            theatreUsed += 1
          } else if (effect === 'sigil') {
            dummyObj.position.set(runtime.pos.x, SIGIL_Y, runtime.pos.z)
            dummyObj.rotation.set(0, 0, 0)
            dummyObj.scale.set(SIGIL_SIZE, 1, SIGIL_SIZE)
            dummyObj.updateMatrix()
            theatreMesh.setMatrixAt(theatreUsed, dummyObj.matrix)
            colorObj.set(toolSigilColor(agentNow.toolKind))
            theatreMesh.setColorAt(theatreUsed, colorObj)
            theatreUsed += 1
          }
        }
      }
      // Park unused instances far below at zero scale so no glow sticks.
      dummyObj.rotation.set(0, 0, 0)
      dummyObj.scale.set(0, 0, 0)
      dummyObj.position.set(0, -10, 0)
      for (let i = ribbonUsed; i < RIBBON_TOTAL; i += 1) {
        dummyObj.updateMatrix()
        ribbonMesh.setMatrixAt(i, dummyObj.matrix)
      }
      for (let i = poolUsed; i < POOL_TOTAL; i += 1) {
        dummyObj.updateMatrix()
        poolMesh.setMatrixAt(i, dummyObj.matrix)
      }
      for (let i = theatreUsed; i < THEATRE_MAX; i += 1) {
        dummyObj.updateMatrix()
        theatreMesh.setMatrixAt(i, dummyObj.matrix)
      }
      ribbonMesh.instanceMatrix.needsUpdate = true
      poolMesh.instanceMatrix.needsUpdate = true
      theatreMesh.instanceMatrix.needsUpdate = true
      if (ribbonMesh.instanceColor) ribbonMesh.instanceColor.needsUpdate = true
      if (poolMesh.instanceColor) poolMesh.instanceColor.needsUpdate = true
      if (theatreMesh.instanceColor) theatreMesh.instanceColor.needsUpdate = true
    }
  })

  // Age channels freeze in still modes: the frozen wall clock holds the last
  // desaturation and halo instead of advancing them.
  const nowWall = paused || reducedMotion ? stillNow.current || Date.now() : Date.now()
  const entries = [...runtimes.current.entries()]
  return (
    <group>
      {entries.map(([id, runtime], index) => {
        const agent = runtime.agent
        const isChild = agent.depth > 0 && !!agent.parentId
        const spotGesture = gestureForWorker(agent)
        // A worker that is still walking its arrival leg reads as walking, even
        // when the snapshot is already stale; sitting starts at the spot.
        const gesture = runtime.leaving || !runtime.moving ? spotGesture : spotGesture === 'sit' ? 'idle' : spotGesture
        const ring = ringFor(agent, selectedId === id)
        const showBeam = !runtime.leaving && agent.freshness === 'fresh' && agent.workState === 'needs-input'
        // Heraldry is pure and discrete-render only: computed here, consumed by
        // the character (livery) and the culled tag set above.
        const heraldry = heraldryFor(agent)
        const showTag = visibleTags.current.has(id)
        // Age channels: desaturation ramps with signal age while fresh (stale
        // pins to full dim through `dimmed`); the halo arc grows with work
        // duration, capped at 30 min and quantized so geometry rarely churns.
        const desaturation = agent.freshness === 'fresh'
          ? desaturationForAge(nowWall - agent.lastSignalAt)
          : 1
        const haloFraction = agent.freshness === 'fresh' && agent.startedAt !== undefined
          ? haloFractionForDuration(nowWall - agent.startedAt)
          : 0
        const haloStep = Math.round(haloFraction * 24) / 24
        return (
          <group
            key={id}
            ref={(node) => {
              if (node) groups.current.set(id, node)
              else groups.current.delete(id)
            }}
            position={[runtime.pos.x, WALK_Y, runtime.pos.z]}
            rotation={[0, runtime.heading, 0]}
            scale={isChild ? WORKER_SCALE * CHILD_SCALE : WORKER_SCALE}
          >
            <group
              ref={(node) => {
                if (node) chars.current.set(id, node)
                else chars.current.delete(id)
              }}
            >
              <CourtyardCharacter
                agent={agent}
                gesture={gesture}
                moving={runtime.moving}
                index={index}
                celebrationId={celebrationBy[id]}
                paused={paused}
                reducedMotion={reducedMotion}
                selected={selectedId === id}
                dimmed={agent.freshness !== 'fresh'}
                desaturation={desaturation}
                heraldry={heraldry}
                showTag={showTag}
                onHover={handleHover}
                onSelect={onSelect}
              />
            </group>
            {/* Ground status ring: five semantic colors. */}
            <mesh position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[1.02, 1.28, 40]} />
              <meshBasicMaterial color={RING_COLORS[ring]} transparent opacity={0.9} depthWrite={false} />
            </mesh>
            {/* Work-duration halo: arc grows with startedAt, capped at 30 min. */}
            {haloStep > 0.01 && (
              <mesh position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[HALO_INNER, HALO_OUTER, 40, 1, 0, haloStep * Math.PI * 2]} />
                <meshBasicMaterial color={HALO_COLOR} transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
            )}
            {/* Tall amber beam marks needs-input from the whole city view. */}
            {showBeam && (
              <mesh
                ref={(node) => {
                  if (node) beams.current.set(id, node)
                  else beams.current.delete(id)
                }}
                position={[0, 20, 0]}
              >
                <cylinderGeometry args={[0.55, 0.9, 40, 12, 1, true]} />
                <meshBasicMaterial
                  color="#e0a03b"
                  transparent
                  opacity={0.34}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                  fog={false}
                />
              </mesh>
            )}
          </group>
        )
      })}
      <lineSegments geometry={tetherGeom.current} frustumCulled={false}>
        <lineBasicMaterial color="#9fd8ff" transparent opacity={0.7} depthWrite={false} />
      </lineSegments>
      {/* Walk ribbons: one additive instanced set in exact ring colours. */}
      <instancedMesh
        ref={(node) => {
          ribbonRef.current = node
        }}
        args={[undefined, undefined, RIBBON_TOTAL]}
        frustumCulled={false}
        visible={!paused && !reducedMotion}
      >
        <primitive object={flatGeom} attach="geometry" />
        <meshBasicMaterial
          transparent
          opacity={0.5}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </instancedMesh>
      {/* Footstep pools: one instanced set of stride-pulsed soft discs. */}
      <instancedMesh
        ref={(node) => {
          poolRef.current = node
        }}
        args={[undefined, undefined, POOL_TOTAL]}
        frustumCulled={false}
      >
        <primitive object={flatGeom} attach="geometry" />
        <meshBasicMaterial
          transparent
          opacity={POOL_OPACITY}
          map={footTexture ?? undefined}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
      {/* State theatre: one additive set (at most 32), no new lights. */}
      <instancedMesh
        ref={(node) => {
          theatreRef.current = node
        }}
        args={[undefined, undefined, THEATRE_MAX]}
        frustumCulled={false}
      >
        <primitive object={flatGeom} attach="geometry" />
        <meshBasicMaterial
          transparent
          opacity={THEATRE_OPACITY}
          map={footTexture ?? undefined}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  )
}
