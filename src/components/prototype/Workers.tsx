import { useEffect, useReducer, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CourtyardCharacter } from './CourtyardCharacter'
import { GATEWAY_ARCH, WALK_Y, WORK_SPOTS } from './city'
import type { DistrictId } from './city'
import type { CityAgent, ToolKind } from './agentModel'
import { DWELL_MIN_MS } from './agentModel'
import { buildRoadGraph, pathToSpot } from './cityGraph'
import type { RoadGraph } from './cityGraph'
import {
  canLeaveSpot, childOffset, dominantToolKind, gestureForWorker, layoutTargets,
  ringFor, RING_COLORS, selectRendered, targetDistrict, tripSpeed, selectLeaving,
} from './movement'
import type { ToolSample } from './movement'
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

  const clock = useRef(0)
  const lastT = useRef<number | null>(null)
  const reconcileAcc = useRef(0)
  const [, bump] = useReducer((value: number) => value + 1, 0)

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

  useEffect(() => () => {
    tetherGeom.current?.dispose()
    tetherGeom.current = null
  }, [])

  useFrame(({ clock: frameClock }) => {
    const now = frameClock.elapsedTime
    const delta = lastT.current === null ? 0 : Math.max(0, now - lastT.current)
    lastT.current = now
    if (pausedRef.current) return
    if (typeof document !== 'undefined' && document.hidden) return
    const dtMs = Math.min(delta, 0.06) * 1000
    clock.current += dtMs

    reconcileAcc.current += dtMs
    if (reconcileAcc.current > RECONCILE_MS) {
      reconcileAcc.current = 0
      if (reconcile()) bump()
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
  })

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
                onSelect={onSelect}
              />
            </group>
            {/* Ground status ring: five semantic colors. */}
            <mesh position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[1.02, 1.28, 40]} />
              <meshBasicMaterial color={RING_COLORS[ring]} transparent opacity={0.9} depthWrite={false} />
            </mesh>
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
    </group>
  )
}
