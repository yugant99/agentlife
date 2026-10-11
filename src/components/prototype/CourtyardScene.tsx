import { Html, Instance, Instances, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import type { ComponentRef } from 'react'
import * as THREE from 'three'
import { BlackHoleBackdrop } from '../BlackHoleBackdrop'
import { CourtyardCharacter } from './CourtyardCharacter'
import * as city from './city'
import type { DistrictId, StationId } from './city'
import type { ScenarioState } from './scenario'
import { gestureFor } from './scenario'

// ---------------------------------------------------------------------------
// Mythic City. (File name is retained from the earlier courtyard prototype; the
// exported names are unchanged so the entry point does not churn.)
//
// A dense, connected harbor city built entirely from shared/instanced primitives: six
// neighborhoods on a 10-unit lattice, a street grid, a diagonal canal and southwest
// harbor, bridges, piers, an elevated rail loop with a moving tram, boats, street
// couriers and steam. Three viewing scales: city / district / agent. The original
// stylized black-hole sky is restored above the skyline.
// ---------------------------------------------------------------------------

const FOV = 40
const CAMERA_DIR = new THREE.Vector3(0.42, 0.5, 0.76).normalize()
const CITY_TARGET = new THREE.Vector3(0, 8, 0)
// Camera position matches the city overview for the first frame so there is no intro drift.
const CAMERA_CONFIG: { position: [number, number, number]; fov: number } = { position: [79.8, 103, 144.4], fov: FOV }
const DPR_RANGE: [number, number] = [1, 1.6]
const GL_CONFIG = { antialias: true, powerPreference: 'high-performance' as const }
const FORWARD = new THREE.Vector3(0, 0, 1)
const TRAVEL_CITY = 0.65
const TRAVEL_AGENT = 0.42

// Station plazas are staffed; the black-hole direction is in camera space so the hole
// stays in the sky band above the skyline as the camera orbits.
// Camera-space direction for the city's black hole: low enough that the full silhouette
// and lensed arch sit inside the sky band above the skyline.
const BLACK_HOLE_DIRECTION: [number, number, number] = [0.03, 0.21, -1.0]

export interface RenderStats {
  calls: number
  triangles: number
  frameMs: number
  width: number
  height: number
  pixelRatio: number
}

interface MinimalControls {
  target: THREE.Vector3
  enabled: boolean
  update: () => void
}
type ControlsRef = { current: MinimalControls | null }

// --- Shared helpers ---------------------------------------------------------

// A local clock that only advances while the scenario is running, so pausing freezes
// traffic and reduced motion keeps traffic static. Clamped deltas and a hidden-tab guard
// avoid a jump on resume.
function useDrivenTime(animate: boolean) {
  const time = useRef(0)
  const last = useRef<number | null>(null)
  useFrame(({ clock }) => {
    const now = clock.elapsedTime
    const delta = last.current === null ? 0 : Math.max(0, now - last.current)
    last.current = now
    if (!animate || (typeof document !== 'undefined' && document.hidden)) return
    time.current += Math.min(delta, 0.06)
  })
  return time
}

// Buildings are assembled from instanced archetype layers (podium / main / upper) with
// sparse emissive facade-window panels, plus solid roof caps and spires. No per-building
// textures are created, so there is nothing to dispose.

// --- Camera -----------------------------------------------------------------

function CameraRig({ view, revision, reducedMotion, controlsRef, agentPositions }: {
  view: city.View
  revision: number
  reducedMotion: boolean
  controlsRef: ControlsRef
  agentPositions: Record<string, [number, number, number]>
}) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const clock = useThree((state) => state.clock)
  const anim = useRef({
    active: false,
    start: 0,
    duration: TRAVEL_CITY,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
  })

  const districtId = view.scale === 'district' ? view.districtId : undefined
  const agentId = view.scale === 'agent' ? view.agentId : undefined

  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return
    const target = new THREE.Vector3()
    let radius = city.CITY_RADIUS
    let pixelTarget = 0
    let duration = TRAVEL_CITY
    if (districtId) {
      const district = city.districtById(districtId)
      target.set(district.center[0], 16, district.center[1])
      radius = district.radius * 1.2
    } else if (agentId) {
      const position = agentPositions[agentId]
      if (position) target.set(position[0], position[1] + 0.95, position[2])
      radius = 2.6
      pixelTarget = 150
      duration = TRAVEL_AGENT
    } else {
      target.copy(CITY_TARGET)
    }

    const vFov = (FOV * Math.PI) / 180
    const aspect = Math.max(0.4, size.width / Math.max(1, size.height))
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
    const fit = (r: number, margin: number) => Math.max(r / Math.sin(vFov / 2), r / Math.sin(hFov / 2)) * margin
    const pixelDist = (charHeight: number, charPx: number) => (charHeight * size.height) / (2 * Math.tan(vFov / 2) * charPx)
    const needed = Math.max(fit(radius, 1.05), pixelTarget ? pixelDist(1.7, pixelTarget) : 0)
    const distance = THREE.MathUtils.clamp(needed, 5, 420)

    const toPos = target.clone().addScaledVector(CAMERA_DIR, distance)
    const controls = controlsRef.current
    const toTarget = target.clone()

    if (reducedMotion) {
      camera.position.copy(toPos)
      if (controls) {
        controls.target.copy(toTarget)
        controls.enabled = true
        controls.update()
      } else {
        camera.lookAt(toTarget)
      }
      anim.current.active = false
      return
    }

    anim.current.active = true
    anim.current.start = clock.getElapsedTime()
    anim.current.duration = duration
    anim.current.fromPos.copy(camera.position)
    anim.current.fromTarget.copy(controls ? controls.target : toTarget)
    anim.current.toPos.copy(toPos)
    anim.current.toTarget.copy(toTarget)
    if (controls) controls.enabled = false
  }, [districtId, agentId, revision, size.width, size.height, reducedMotion, camera, clock, controlsRef, agentPositions])

  useFrame(() => {
    const a = anim.current
    if (!a.active) return
    const t = Math.min(1, (clock.elapsedTime - a.start) / a.duration)
    const eased = t * t * (3 - 2 * t)
    camera.position.lerpVectors(a.fromPos, a.toPos, eased)
    const controls = controlsRef.current
    if (controls) {
      controls.target.lerpVectors(a.fromTarget, a.toTarget, eased)
      controls.update()
      if (t >= 1) {
        controls.enabled = true
        a.active = false
      }
    } else {
      camera.lookAt(a.toTarget)
      if (t >= 1) a.active = false
    }
  })

  return null
}

// Bounded, opt-in renderer stats; writes to a shared sink a few times per second.
function StatsReporter({ sink, enabled }: { sink: { current: RenderStats }; enabled: boolean }) {
  const gl = useThree((state) => state.gl)
  const size = useThree((state) => state.size)
  const acc = useRef({ frames: 0, ms: 0, last: 0 })
  useFrame((_, delta) => {
    if (!enabled) return
    acc.current.frames += 1
    acc.current.ms += delta * 1000
    const now = performance.now()
    if (now - acc.current.last < 500) return
    acc.current.last = now
    sink.current.calls = gl.info.render.calls
    sink.current.triangles = gl.info.render.triangles
    sink.current.frameMs = acc.current.frames > 0 ? acc.current.ms / acc.current.frames : 0
    sink.current.width = size.width
    sink.current.height = size.height
    sink.current.pixelRatio = gl.getPixelRatio()
    acc.current.frames = 0
    acc.current.ms = 0
  })
  return null
}

// --- Streets, water, transit -------------------------------------------------

function Streets() {
  const plain = city.ROADS.filter((r) => !r.lit)
  const lit = city.ROADS.filter((r) => r.lit)
  const render = (roads: city.RoadSegment[], color: string) => (
    <Instances limit={roads.length} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.95} metalness={0.05} />
      {roads.map((road, index) => (
        <Instance
          key={index}
          position={[road.x, 0.05, road.z]}
          scale={road.along === 'z' ? [road.wide, 0.1, road.len] : [road.len, 0.1, road.wide]}
        />
      ))}
    </Instances>
  )
  return <group>{render(plain, '#1b2028')}{render(lit, '#262d38')}</group>
}

function Waterworks() {
  return (
    <group>
      <mesh position={[city.HARBOR.x, 0.14, city.HARBOR.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[city.HARBOR.w, city.HARBOR.d]} />
        <meshStandardMaterial color="#123a45" roughness={0.25} metalness={0.35} emissive="#0a2730" emissiveIntensity={0.6} />
      </mesh>
      {city.CANAL_SEGMENTS.map((segment, index) => (
        <mesh key={index} position={[segment.x, 0.16, segment.z]} rotation={[0, segment.rot, 0]} receiveShadow>
          <boxGeometry args={[city.CANAL_WIDTH, 0.18, segment.len + 1.5]} />
          <meshStandardMaterial color="#123a45" roughness={0.25} metalness={0.35} emissive="#0a2730" emissiveIntensity={0.6} />
        </mesh>
      ))}
      {/* Quay walls along the harbor edges. */}
      <mesh position={[city.HARBOR.x1 - 0.6, 1.1, (city.HARBOR.z0 + city.HARBOR.z1) / 2]} receiveShadow>
        <boxGeometry args={[2.4, 2.4, city.HARBOR.d + 2]} />
        <meshStandardMaterial color="#3c4148" roughness={0.95} />
      </mesh>
      <mesh position={[(city.HARBOR.x0 + city.HARBOR.x1) / 2, 1.1, city.HARBOR.z0 - 0.6]} receiveShadow>
        <boxGeometry args={[city.HARBOR.w + 2, 2.4, 2.4]} />
        <meshStandardMaterial color="#3c4148" roughness={0.95} />
      </mesh>
      <Instances limit={city.PIERS.length} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#4a4034" roughness={0.95} />
        {city.PIERS.map((pier, index) => (
          <Instance key={index} position={[pier.x, 0.4, pier.z]} scale={[pier.w, 0.7, pier.d]} />
        ))}
      </Instances>
      {city.BRIDGES.map((bridge, index) => (
        <group key={index} position={[bridge.x, 0, bridge.z]} rotation={[0, bridge.rot, 0]}>
          {/* Raised deck leaves canal clearance for boat cabins. */}
          <mesh position={[0, 3.0, 0]} receiveShadow>
            <boxGeometry args={[bridge.span, 0.7, 5.5]} />
            <meshStandardMaterial color="#3b4149" roughness={0.9} />
          </mesh>
          <mesh position={[2.5, 3.7, 0]}>
            <boxGeometry args={[0.22, 0.7, 5.5]} />
            <meshStandardMaterial color="#565d66" roughness={0.8} />
          </mesh>
          <mesh position={[-2.5, 3.7, 0]}>
            <boxGeometry args={[0.22, 0.7, 5.5]} />
            <meshStandardMaterial color="#565d66" roughness={0.8} />
          </mesh>
          <mesh position={[2.2, 1.4, 0]} receiveShadow>
            <boxGeometry args={[0.8, 3.2, 1.6]} />
            <meshStandardMaterial color="#333941" roughness={0.95} />
          </mesh>
          <mesh position={[-2.2, 1.4, 0]} receiveShadow>
            <boxGeometry args={[0.8, 3.2, 1.6]} />
            <meshStandardMaterial color="#333941" roughness={0.95} />
          </mesh>
          {/* Short shore approaches on each bank. */}
          <mesh position={[bridge.span / 2 + 2.0, 1.5, 0]} receiveShadow>
            <boxGeometry args={[3.6, 3.0, 5.5]} />
            <meshStandardMaterial color="#3a4048" roughness={0.95} />
          </mesh>
          <mesh position={[-bridge.span / 2 - 2.0, 1.5, 0]} receiveShadow>
            <boxGeometry args={[3.6, 3.0, 5.5]} />
            <meshStandardMaterial color="#3a4048" roughness={0.95} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// --- Landmarks ---------------------------------------------------------------

function Citadel() {
  return (
    <group position={[0, 0, 0]}>
      <mesh position={[0, 6, 0]} receiveShadow>
        <boxGeometry args={[21, 12, 21]} />
        <meshStandardMaterial color="#2f3a4a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 17, 0]} receiveShadow>
        <boxGeometry args={[15, 10, 15]} />
        <meshStandardMaterial color="#354256" roughness={0.9} />
      </mesh>
      <mesh position={[0, 27, 0]} receiveShadow>
        <boxGeometry args={[9.5, 10, 9.5]} />
        <meshStandardMaterial color="#3c4a60" roughness={0.9} />
      </mesh>
      <mesh position={[0, 37, 0]}>
        <coneGeometry args={[4, 12, 4]} />
        <meshStandardMaterial color="#4a5a72" roughness={0.8} metalness={0.2} />
      </mesh>
      {[[-9, -9], [9, -9], [-9, 9], [9, 9]].map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, 10, z]} receiveShadow>
          <boxGeometry args={[5, 20, 5]} />
          <meshStandardMaterial color="#334053" roughness={0.9} />
        </mesh>
      ))}
      {/* Warm inset window bands and vertical metallic trim so the core is not a black lump. */}
      {[11.9, 21.9, 31.9].map((y, index) => {
        const span = index === 0 ? 21.3 : index === 1 ? 15.3 : 9.8
        return (
          <mesh key={y} position={[0, y, 0]}>
            <boxGeometry args={[span, 0.5, span]} />
            <meshStandardMaterial color="#ffd9a0" emissive="#ffcf8a" emissiveIntensity={0.42} roughness={0.6} />
          </mesh>
        )
      })}
      {[[-10.4, -10.4], [10.4, -10.4], [-10.4, 10.4], [10.4, 10.4]].map(([x, z]) => (
        <mesh key={`t${x}:${z}`} position={[x, 18, z]}>
          <boxGeometry args={[0.6, 36, 0.6]} />
          <meshStandardMaterial color="#6a7686" metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
      {/* Warm crown rings so the core reads at city scale. */}
      <mesh position={[0, 32.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[4.6, 0.35, 6, 24]} />
        <meshStandardMaterial color="#ffbe6a" emissive="#ffbe6a" emissiveIntensity={2.0} roughness={0.5} />
      </mesh>
      <mesh position={[0, 40, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.2, 0.28, 6, 20]} />
        <meshStandardMaterial color="#ffd28a" emissive="#ffd28a" emissiveIntensity={2.0} roughness={0.5} />
      </mesh>
    </group>
  )
}

function Foundry({ animate }: { animate: boolean }) {
  const time = useDrivenTime(animate)
  const jibA = useRef<THREE.Group>(null)
  const jibB = useRef<THREE.Group>(null)
  useFrame(() => {
    const t = time.current
    if (jibA.current) jibA.current.rotation.y = t * 0.14
    if (jibB.current) jibB.current.rotation.y = -t * 0.1 + 1
  })
  const center = city.districtById('foundry').center
  const chimneys: [number, number][] = [[-6, 4], [-1, 7], [5, 3], [8, -3], [-4, -6], [2, -8]]
  return (
    <group position={[center[0], 0, center[1]]}>
      <mesh position={[0, 3, 0]} receiveShadow>
        <boxGeometry args={[16, 6, 12]} />
        <meshStandardMaterial color="#2e2a2b" roughness={0.95} />
      </mesh>
      <Instances limit={chimneys.length}>
        <cylinderGeometry args={[1.1, 1.5, 20, 8]} />
        <meshStandardMaterial color="#382f2c" roughness={0.95} />
        {chimneys.map(([x, z], index) => <Instance key={index} position={[x, 12, z]} />)}
      </Instances>
      <Instances limit={chimneys.length}>
        <cylinderGeometry args={[1.2, 1.2, 0.6, 8]} />
        <meshStandardMaterial color="#e0662a" emissive="#ff7a2a" emissiveIntensity={1.1} roughness={0.6} />
        {chimneys.map(([x, z], index) => <Instance key={index} position={[x, 22.2, z]} />)}
      </Instances>
      <group ref={jibA} position={[9, 0, 7]}>
        <mesh position={[0, 8, 0]} castShadow><boxGeometry args={[0.7, 16, 0.7]} /><meshStandardMaterial color="#3d3a3a" /></mesh>
        <mesh position={[3.4, 15.6, 0]}><boxGeometry args={[7, 0.5, 0.5]} /><meshStandardMaterial color="#4a4644" /></mesh>
      </group>
      <group ref={jibB} position={[-9, 0, -6]}>
        <mesh position={[0, 7, 0]} castShadow><boxGeometry args={[0.7, 14, 0.7]} /><meshStandardMaterial color="#3d3a3a" /></mesh>
        <mesh position={[-3, 13.6, 0]}><boxGeometry args={[6, 0.5, 0.5]} /><meshStandardMaterial color="#4a4644" /></mesh>
      </group>
    </group>
  )
}

function Archive() {
  const center = city.districtById('archive').center
  const columns = useMemo(() => Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2
    return { position: [Math.cos(a) * 8.4, 4, Math.sin(a) * 8.4] as [number, number, number] }
  }), [])
  return (
    <group position={[center[0], 0, center[1]]}>
      <mesh position={[0, 4, 0]} receiveShadow>
        <cylinderGeometry args={[9, 9, 8, 20]} />
        <meshStandardMaterial color="#33403c" roughness={0.9} />
      </mesh>
      <mesh position={[0, 11, 0]} receiveShadow>
        <sphereGeometry args={[9, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#3b4a45" roughness={0.85} metalness={0.15} />
      </mesh>
      <mesh position={[0, 12.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.4, 0.25, 6, 16]} />
        <meshStandardMaterial color="#ffbe6a" emissive="#ffbe6a" emissiveIntensity={1.2} />
      </mesh>
      <Instances limit={columns.length} receiveShadow>
        <boxGeometry args={[1, 8, 1]} />
        <meshStandardMaterial color="#404f49" roughness={0.9} />
        {columns.map((column, index) => <Instance key={index} position={column.position} />)}
      </Instances>
    </group>
  )
}

function Observatory({ animate }: { animate: boolean }) {
  const time = useDrivenTime(animate)
  const dish = useRef<THREE.Group>(null)
  useFrame(() => {
    if (dish.current) dish.current.rotation.y = time.current * 0.26
  })
  const center = city.districtById('observatory').center
  return (
    <group position={[center[0], 0, center[1]]}>
      <mesh position={[0, 5, 0]} receiveShadow>
        <cylinderGeometry args={[7, 8, 10, 16]} />
        <meshStandardMaterial color="#2b3440" roughness={0.9} />
      </mesh>
      <mesh position={[0, 11, 0]} receiveShadow>
        <sphereGeometry args={[7, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#333f4c" roughness={0.8} metalness={0.2} />
      </mesh>
      <group ref={dish} position={[0, 15, 0]}>
        <mesh position={[0, 1.5, 0]}><cylinderGeometry args={[0.3, 0.3, 3, 6]} /><meshStandardMaterial color="#4a4f56" /></mesh>
        <mesh position={[0, 3.4, 0]} rotation={[0.7, 0, 0]}>
          <cylinderGeometry args={[3.2, 3.2, 0.5, 20]} />
          <meshStandardMaterial color="#59626c" roughness={0.5} metalness={0.4} />
        </mesh>
        <mesh position={[0, 4.6, 0]}><sphereGeometry args={[0.4, 8, 6]} /><meshStandardMaterial color="#ffd28a" emissive="#ffd28a" emissiveIntensity={1} /></mesh>
      </group>
    </group>
  )
}

function Gateway() {
  const center = city.districtById('gateway').center
  return (
    <group position={[center[0], 0, center[1]]}>
      <mesh position={[-5, 8, 0]} receiveShadow>
        <boxGeometry args={[3.4, 16, 3.4]} />
        <meshStandardMaterial color="#38334a" roughness={0.9} />
      </mesh>
      <mesh position={[5, 8, 0]} receiveShadow>
        <boxGeometry args={[3.4, 16, 3.4]} />
        <meshStandardMaterial color="#38334a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 17, 0]} receiveShadow>
        <boxGeometry args={[15, 2.4, 3.4]} />
        <meshStandardMaterial color="#403a52" roughness={0.9} />
      </mesh>
      <mesh position={[0, 8, 0]}>
        <planeGeometry args={[7, 14]} />
        <meshStandardMaterial color="#7fd0ff" emissive="#7fd0ff" emissiveIntensity={0.8} transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// --- Transit and street life -------------------------------------------------

function Rail({ animate }: { animate: boolean }) {
  const time = useDrivenTime(animate)
  const tram = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tangent = useMemo(() => new THREE.Vector3(), [])
  const curve = useMemo(() => new THREE.CatmullRomCurve3(city.RAIL_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'centripetal'), [])
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 240, 0.22, 6, true), [curve])
  useEffect(() => () => geometry.dispose(), [geometry])
  const length = useMemo(() => curve.getLength(), [curve])
  useFrame(() => {
    const node = tram.current
    if (!node) return
    for (let car = 0; car < 3; car += 1) {
      const s = (((time.current / 35 - car * 6 / length) % 1) + 1) % 1
      curve.getPointAt(s, dummy.position)
      curve.getTangentAt(s, tangent)
      dummy.position.y += 0.5
      dummy.quaternion.setFromUnitVectors(FORWARD, tangent)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      node.setMatrixAt(car, dummy.matrix)
    }
    node.instanceMatrix.needsUpdate = true
  })
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#7c848c" metalness={0.6} roughness={0.4} />
      </mesh>
      <Instances limit={city.RAIL_PILLARS.length}>
        <boxGeometry args={[0.5, 7, 0.5]} />
        <meshStandardMaterial color="#2a2f36" roughness={0.9} />
        {city.RAIL_PILLARS.map((pillar, index) => <Instance key={index} position={[pillar.x, 3.5, pillar.z]} />)}
      </Instances>
      <instancedMesh ref={tram} args={[undefined, undefined, 3]} castShadow>
        <boxGeometry args={[1.7, 1.7, 5.6]} />
        <meshStandardMaterial color="#33465a" emissive="#7fd0ff" emissiveIntensity={0.5} roughness={0.5} />
      </instancedMesh>
    </group>
  )
}

function Boats({ animate }: { animate: boolean }) {
  const time = useDrivenTime(animate)
  const refs = useRef<Array<THREE.Group | null>>([])
  const curves = useMemo(() => city.BOAT_ROUTES.map((route) => new THREE.CatmullRomCurve3(
    route.points.map(([x, z]) => new THREE.Vector3(x, 0.3, z)), false, 'centripetal',
  )), [])
  const tangent = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    curves.forEach((curve, index) => {
      const node = refs.current[index]
      if (!node) return
      const route = city.BOAT_ROUTES[index]
      const raw = ((time.current / route.period + route.phase) % 1 + 1) % 1
      // Bounded ping-pong on every open route, with the heading flipped on the return leg.
      const s = raw < 0.5 ? raw * 2 : 2 - raw * 2
      const clamped = Math.min(0.999, Math.max(0.001, s))
      const heading = raw < 0.5 ? 1 : -1
      curve.getPointAt(clamped, node.position)
      curve.getTangentAt(clamped, tangent)
      node.rotation.y = Math.atan2(tangent.x * heading, tangent.z * heading)
    })
  })
  return (
    <group>
      {city.BOAT_ROUTES.map((_, index) => (
        <group key={index} ref={(node) => { refs.current[index] = node }}>
          <mesh position={[0, 0.2, 0]} castShadow>
            <boxGeometry args={[2.2, 0.9, 5]} />
            <meshStandardMaterial color="#5a4a38" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.95, -0.7]}>
            <boxGeometry args={[1.4, 1, 2]} />
            <meshStandardMaterial color="#33465a" emissive="#ffbf6a" emissiveIntensity={0.5} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Couriers({ animate }: { animate: boolean }) {
  const time = useDrivenTime(animate)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame(() => {
    const node = mesh.current
    if (!node) return
    let index = 0
    city.COURIER_ROUTES.forEach((route) => {
      for (let k = 0; k < 2; k += 1) {
        const raw = ((time.current / route.period + route.phase + k * 0.5) % 1 + 1) % 1
        const ping = raw < 0.5 ? raw * 2 : 2 - raw * 2
        const heading = raw < 0.5 ? 1 : -1
        const [ax, az] = route.points[0]
        const [bx, bz] = route.points[1]
        dummy.position.set(ax + (bx - ax) * ping, 0.9, az + (bz - az) * ping)
        dummy.rotation.set(0, Math.atan2((bx - ax) * heading, (bz - az) * heading), 0)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        node.setMatrixAt(index, dummy.matrix)
        index += 1
      }
    })
    node.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, city.COURIER_ROUTES.length * 2]}>
      <boxGeometry args={[0.7, 0.7, 1.3]} />
      <meshStandardMaterial color="#6b5334" emissive="#3a2a14" emissiveIntensity={0.22} roughness={0.75} metalness={0.2} />
    </instancedMesh>
  )
}

const STEAM_SOURCES: [number, number][] = [[-38, -16], [-43, -12], [-33, -20], [-46, -16], [-38, -9]]

function Steam({ animate }: { animate: boolean }) {
  const time = useDrivenTime(animate)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const puffs = STEAM_SOURCES.length * 2
  useFrame(() => {
    const node = mesh.current
    if (!node) return
    let index = 0
    STEAM_SOURCES.forEach(([x, z]) => {
      for (let k = 0; k < 2; k += 1) {
        const progress = ((time.current * 0.11 + k * 0.5 + index * 0.03) % 1 + 1) % 1
        dummy.position.set(x + Math.sin(progress * 6.3 + index) * 1.1 * progress, 22 + progress * 12, z)
        dummy.scale.setScalar(0.8 + progress * 2.6)
        dummy.updateMatrix()
        node.setMatrixAt(index, dummy.matrix)
        index += 1
      }
    })
    node.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, puffs]}>
      <sphereGeometry args={[0.8, 6, 5]} />
      <meshBasicMaterial color="#9aa3ad" transparent opacity={0.24} depthWrite={false} />
    </instancedMesh>
  )
}

function Lamps() {
  return (
    <group>
      <Instances limit={city.LAMPS.length}>
        <cylinderGeometry args={[0.1, 0.14, 5, 5]} />
        <meshStandardMaterial color="#2b3037" roughness={0.9} />
        {city.LAMPS.map((lamp, index) => <Instance key={`p${index}`} position={[lamp.x, 2.5, lamp.z]} />)}
      </Instances>
      <Instances limit={city.LAMPS.length}>
        <sphereGeometry args={[0.28, 8, 6]} />
        <meshStandardMaterial color="#ffd08a" emissive="#ffbf6a" emissiveIntensity={1.6} roughness={0.5} />
        {city.LAMPS.map((lamp, index) => <Instance key={`h${index}`} position={[lamp.x, 5.1, lamp.z]} />)}
      </Instances>
    </group>
  )
}

// Low landscaping dresses each work plaza as a public square. Props sit at radius 10-15,
// well clear of the worker, so the agent camera corridor stays open.
function Plazas() {
  return (
    <group>
      {city.PLAZA_PAVING.map(([x, z], index) => (
        <mesh key={index} position={[x, city.WALK_Y - 0.07, z]} receiveShadow>
          <cylinderGeometry args={[15, 15, 0.14, 32]} />
          <meshStandardMaterial color="#3a4149" roughness={0.98} />
        </mesh>
      ))}
      <Instances limit={city.PLAZA_RAILINGS.length} receiveShadow>
        <boxGeometry args={[0.18, 1.0, 0.18]} />
        <meshStandardMaterial color="#2c333c" roughness={0.8} metalness={0.3} />
        {city.PLAZA_RAILINGS.map(([x, z], index) => <Instance key={index} position={[x, 0.5, z]} />)}
      </Instances>
      <Instances limit={city.PLAZA_TREES.length}>
        <cylinderGeometry args={[0.16, 0.22, 1.2, 6]} />
        <meshStandardMaterial color="#3a2c1d" roughness={0.95} />
        {city.PLAZA_TREES.map(([x, z], index) => <Instance key={`t${index}`} position={[x, 0.6, z]} />)}
      </Instances>
      <Instances limit={city.PLAZA_TREES.length}>
        <coneGeometry args={[1.1, 2.4, 8]} />
        <meshStandardMaterial color="#2f4a36" roughness={1} />
        {city.PLAZA_TREES.map(([x, z], index) => <Instance key={`f${index}`} position={[x, 2.0, z]} />)}
      </Instances>
      <Instances limit={city.PLAZA_LAMPS.length}>
        <cylinderGeometry args={[0.08, 0.12, 4.4, 5]} />
        <meshStandardMaterial color="#2b3037" roughness={0.9} />
        {city.PLAZA_LAMPS.map(([x, z], index) => <Instance key={`p${index}`} position={[x, 2.2, z]} />)}
      </Instances>
      <Instances limit={city.PLAZA_LAMPS.length}>
        <sphereGeometry args={[0.26, 8, 6]} />
        <meshStandardMaterial color="#ffd08a" emissive="#ffbf6a" emissiveIntensity={1.4} />
        {city.PLAZA_LAMPS.map(([x, z], index) => <Instance key={`h${index}`} position={[x, 4.5, z]} />)}
      </Instances>
    </group>
  )
}

// --- Buildings ---------------------------------------------------------------

function Windows() {
  return (
    <Instances limit={city.WINDOWS.length}>
      <boxGeometry args={[1, 1, 0.16]} />
      <meshStandardMaterial color="#ffd9a0" emissive="#ffcf8a" emissiveIntensity={0.4} roughness={0.6} />
      {city.WINDOWS.map((panel, index) => (
        <Instance key={index} position={[panel.x, panel.y, panel.z]} rotation={[0, panel.rot, 0]} scale={[panel.w, panel.h, 1]} />
      ))}
    </Instances>
  )
}

function Buildings() {
  const layers: { parts: city.BuildingPart[]; color: string; roughness: number; metalness: number }[] = [
    { parts: city.PODIUM_PARTS, color: '#ffffff', roughness: 0.92, metalness: 0.06 },
    { parts: city.MAIN_PARTS, color: '#ffffff', roughness: 0.88, metalness: 0.08 },
    { parts: city.UPPER_PARTS, color: '#ffffff', roughness: 0.9, metalness: 0.1 },
  ]
  return (
    <group>
      {layers.map((layer, index) => (
        <Instances key={index} limit={layer.parts.length} receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={layer.color} roughness={layer.roughness} metalness={layer.metalness} />
          {layer.parts.map((part, k) => (
            <Instance key={k} color={part.color} position={[part.x, part.y0 + part.h / 2, part.z]} scale={[part.w, part.h, part.d]} />
          ))}
        </Instances>
      ))}
      <Instances limit={city.ROOFCAPS.length} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#2f3742" roughness={0.95} metalness={0.12} />
        {city.ROOFCAPS.map((cap, index) => (
          <Instance key={index} position={[cap.x, cap.y, cap.z]} scale={[cap.w, cap.h, cap.d]} />
        ))}
      </Instances>
      <Instances limit={city.SPIRES.length}>
        <coneGeometry args={[1, 1, 5]} />
        <meshStandardMaterial color="#4a5666" roughness={0.7} metalness={0.35} />
        {city.SPIRES.map((spire, index) => (
          <Instance key={index} position={[spire.x, spire.y + spire.h / 2, spire.z]} scale={[spire.r, spire.h, spire.r]} />
        ))}
      </Instances>
      <Windows />
    </group>
  )
}

// --- Work stations (retained from the courtyard slice) -----------------------

const FIREWOOD = Array.from({ length: 12 }, (_, i) => {
  const row = Math.floor(i / 4)
  const col = i % 4
  return {
    position: [(col - 1.5) * 0.24, 0.12 + row * 0.2, (row % 2) * 0.06] as [number, number, number],
    rotation: [0, 0, Math.PI / 2] as [number, number, number],
    scale: 0.9 + (i % 3) * 0.08,
  }
})

function ForgeStation({ reducedMotion, paused }: { reducedMotion: boolean; paused: boolean }) {
  const time = useDrivenTime(!paused && !reducedMotion)
  const flames = useRef<THREE.Group>(null)
  useFrame(() => {
    const node = flames.current
    if (!node || reducedMotion || paused) return
    const t = time.current
    node.children.forEach((child, index) => {
      child.scale.y = 0.85 + Math.sin(t * (6 + index * 1.6) + index) * 0.15
      child.rotation.y = t * (1.1 + index * 0.35)
    })
  })
  return (
    <group>
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 1.1, 1.4]} />
        <meshStandardMaterial color="#4a4e51" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.48, 0.72]}>
        <boxGeometry args={[0.9, 0.56, 0.1]} />
        <meshStandardMaterial color="#e0662a" emissive="#ff7a2a" emissiveIntensity={0.9} roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.5, 0]} castShadow>
        <boxGeometry args={[1.45, 0.7, 1.1]} />
        <meshStandardMaterial color="#3a3e41" roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.5, 0.6]} rotation={[0.5, 0, 0]} castShadow>
        <boxGeometry args={[1.45, 0.12, 0.7]} />
        <meshStandardMaterial color="#33373a" roughness={0.95} />
      </mesh>
      <mesh position={[0, 2.25, -0.25]} castShadow>
        <boxGeometry args={[0.6, 1.2, 0.6]} />
        <meshStandardMaterial color="#3a3e41" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.14, 0.68]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.38, 10]} />
        <meshStandardMaterial color="#7a2f10" emissive="#c1491a" emissiveIntensity={0.5} roughness={0.7} />
      </mesh>
      <group ref={flames} position={[0, 0.26, 0.68]}>
        <mesh position={[0, 0.24, 0]}>
          <coneGeometry args={[0.22, 0.54, 7]} />
          <meshBasicMaterial color="#ef8f2e" transparent opacity={0.9} depthWrite={false} />
        </mesh>
        <mesh position={[0.05, 0.17, 0.03]}>
          <coneGeometry args={[0.13, 0.4, 6]} />
          <meshBasicMaterial color="#f7c14a" transparent opacity={0.95} depthWrite={false} />
        </mesh>
      </group>
      <group position={[0.8, 0, 1.2]}>
        <mesh position={[0, 0.26, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.28, 0.32, 0.52, 8]} />
          <meshStandardMaterial color="#4a3524" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.65, 0]} castShadow>
          <boxGeometry args={[0.56, 0.18, 0.28]} />
          <meshStandardMaterial color="#565b60" metalness={0.55} roughness={0.4} />
        </mesh>
        <mesh position={[0.36, 0.65, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
          <coneGeometry args={[0.11, 0.28, 8]} />
          <meshStandardMaterial color="#565b60" metalness={0.55} roughness={0.4} />
        </mesh>
      </group>
      <Instances limit={FIREWOOD.length} position={[-1.95, 0, 0.2]} castShadow>
        <cylinderGeometry args={[0.11, 0.11, 0.5, 7]} />
        <meshStandardMaterial color="#5a4228" roughness={0.95} />
        {FIREWOOD.map((log, index) => (
          <Instance key={index} position={log.position} rotation={log.rotation} scale={log.scale} />
        ))}
      </Instances>
      <pointLight position={[0.4, 1.0, 0.9]} color="#ff8a3c" intensity={7} distance={8} decay={2} />
    </group>
  )
}

function PlanningTable({ reducedMotion, paused }: { reducedMotion: boolean; paused: boolean }) {
  const time = useDrivenTime(!paused && !reducedMotion)
  const candle = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const node = candle.current
    if (!node || reducedMotion || paused) return
    const material = node.material as THREE.MeshStandardMaterial
    material.emissiveIntensity = 0.9 + Math.sin(time.current * 6) * 0.18
  })
  return (
    <group>
      <mesh position={[0, 0.86, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 0.18, 1.7]} />
        <meshStandardMaterial color="#5a4228" roughness={0.9} />
      </mesh>
      {[[-1.45, -0.72], [1.45, -0.72], [-1.45, 0.72], [1.45, 0.72]].map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, 0.42, z]} castShadow>
          <boxGeometry args={[0.16, 0.84, 0.16]} />
          <meshStandardMaterial color="#463320" roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[0, 0.97, 0]} receiveShadow>
        <boxGeometry args={[2.4, 0.04, 1.25]} />
        <meshStandardMaterial color="#ddcda6" roughness={0.95} />
      </mesh>
      <mesh position={[-0.6, 1.005, 0.12]} rotation={[0, 0.4, 0]}>
        <boxGeometry args={[0.66, 0.02, 0.5]} />
        <meshStandardMaterial color="#bfa06d" roughness={0.95} />
      </mesh>
      <mesh position={[0.7, 1.005, -0.18]} rotation={[0, -0.3, 0]}>
        <boxGeometry args={[0.54, 0.02, 0.44]} />
        <meshStandardMaterial color="#c2a877" roughness={0.95} />
      </mesh>
      <mesh position={[0.95, 1.05, 0.42]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.6, 10]} />
        <meshStandardMaterial color="#e6d6b0" roughness={0.9} />
      </mesh>
      <group position={[-1.1, 1.0, -0.45]}>
        <mesh position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.24, 8]} />
          <meshStandardMaterial color="#e8dcc0" roughness={0.9} />
        </mesh>
        <mesh ref={candle} position={[0, 0.28, 0]}>
          <sphereGeometry args={[0.055, 8, 6]} />
          <meshStandardMaterial color="#ffcf7a" emissive="#ffbf5c" emissiveIntensity={0.9} roughness={0.5} />
        </mesh>
      </group>
      <group position={[1.15, 1.0, -0.5]}>
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.2, 8]} />
          <meshStandardMaterial color="#e8dcc0" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.24, 0]}>
          <sphereGeometry args={[0.05, 8, 6]} />
          <meshStandardMaterial color="#ffcf7a" emissive="#ffbf5c" emissiveIntensity={0.9} roughness={0.5} />
        </mesh>
      </group>
      <pointLight position={[-1.1, 1.35, -0.45]} color="#ffb85c" intensity={4} distance={6} decay={2} />
      <mesh position={[-2.1, 0.26, 1.5]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.16, 0.42]} />
        <meshStandardMaterial color="#4a3524" roughness={0.95} />
      </mesh>
    </group>
  )
}

function SignalPost({ reducedMotion, paused }: { reducedMotion: boolean; paused: boolean }) {
  const time = useDrivenTime(!paused && !reducedMotion)
  const banner = useRef<THREE.Group>(null)
  useFrame(() => {
    const node = banner.current
    if (!node || reducedMotion || paused) return
    const t = time.current
    node.rotation.z = Math.sin(t * 0.8) * 0.05
    node.rotation.x = Math.sin(t * 0.6 + 1) * 0.03
  })
  return (
    <group>
      <mesh position={[0, 2.5, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.15, 5.0, 8]} />
        <meshStandardMaterial color="#5a4228" roughness={0.95} />
      </mesh>
      <mesh position={[0, 4.3, 0]} castShadow>
        <boxGeometry args={[1.9, 0.16, 0.16]} />
        <meshStandardMaterial color="#5a4228" roughness={0.95} />
      </mesh>
      <group ref={banner}>
        <mesh position={[0.62, 3.5, 0]} castShadow>
          <boxGeometry args={[1.05, 1.5, 0.06]} />
          <meshStandardMaterial color="#4a6f68" roughness={0.85} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0.42, 3.5, 0.02]}>
          <boxGeometry args={[0.55, 0.8, 0.03]} />
          <meshStandardMaterial color="#d9b05a" roughness={0.85} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <mesh position={[0, 4.72, 0]} rotation={[0, 0.5, 0]}>
        <coneGeometry args={[0.18, 0.4, 4]} />
        <meshStandardMaterial color="#d9b05a" roughness={0.8} />
      </mesh>
      <mesh position={[-0.7, 0.32, 0.4]} castShadow receiveShadow>
        <boxGeometry args={[0.78, 0.64, 0.78]} />
        <meshStandardMaterial color="#4a3524" roughness={0.95} />
      </mesh>
      <mesh position={[0, 4.9, 0]}>
        <sphereGeometry args={[0.22, 8, 6]} />
        <meshStandardMaterial color="#7fd0ff" emissive="#7fd0ff" emissiveIntensity={1.1} roughness={0.5} />
      </mesh>
      <group position={[0.85, 0, 0.7]}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <cylinderGeometry args={[0.32, 0.36, 0.44, 8]} />
          <meshStandardMaterial color="#4a4e51" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.68, 0]}>
          <sphereGeometry args={[0.22, 8, 6]} />
          <meshStandardMaterial color="#e0662a" emissive="#ff8a3c" emissiveIntensity={1.0} roughness={0.6} />
        </mesh>
        <pointLight position={[0, 0.85, 0]} color="#ff9b47" intensity={4} distance={6} decay={2} />
      </group>
    </group>
  )
}

function Station({ id, position, facing, reducedMotion, paused }: { id: StationId; position: [number, number, number]; facing: number; reducedMotion: boolean; paused: boolean }) {
  return (
    <group position={position} rotation={[0, facing, 0]}>
      {id === 'forge' && <ForgeStation reducedMotion={reducedMotion} paused={paused} />}
      {id === 'planning-table' && <PlanningTable reducedMotion={reducedMotion} paused={paused} />}
      {id === 'signal-post' && <SignalPost reducedMotion={reducedMotion} paused={paused} />}
    </group>
  )
}

// --- Labels ------------------------------------------------------------------

function DistrictLabel({ district, count, onDistrict }: { district: city.District; count: number; onDistrict: (id: DistrictId) => void }) {
  const y = district.radius * 1.05 + 10
  return (
    <Html position={[district.center[0], y, district.center[1]]} center zIndexRange={[16, 0]}>
      <button type="button" className="proto-district-label" onClick={(event) => { event.stopPropagation(); onDistrict(district.id) }}>
        <span>{district.name}</span>
        <small>{count === 0 ? 'No workers assigned' : `${count} ${count === 1 ? 'worker' : 'workers'}`}</small>
      </button>
    </Html>
  )
}

// --- World ------------------------------------------------------------------

// Station plazas and each worker's spot within them. Workers stand just to the camera
// side of their station, turned 3/4 toward the viewer so faces read at agent scale.
const STATION_FACING = 0.5
const AGENT_SLOT: Record<string, { station: StationId; slot: number }> = {
  bjorn: { station: 'forge', slot: 0 },
  eirik: { station: 'forge', slot: 1 },
  sigrid: { station: 'planning-table', slot: 0 },
  halvard: { station: 'planning-table', slot: 1 },
  astrid: { station: 'signal-post', slot: 0 },
}

function placementFor(station: StationId, slot: number): [number, number, number] {
  const [px, pz] = city.PLAZAS[station]
  const forward = 1.5
  const lateral = station === 'signal-post' ? 1.7 : slot === 0 ? -1.9 : 1.9
  return [
    px + Math.sin(STATION_FACING) * forward + Math.cos(STATION_FACING) * lateral,
    city.WALK_Y,
    pz + Math.cos(STATION_FACING) * forward - Math.sin(STATION_FACING) * lateral,
  ]
}

function CourtyardWorld({ state, selectedId, view, focusRevision, paused, reducedMotion, showStats, statsSink, onSelect, onDistrict, onReady }: {
  state: ScenarioState
  selectedId?: string
  view: city.View
  focusRevision: number
  paused: boolean
  reducedMotion: boolean
  showStats: boolean
  statsSink: { current: RenderStats }
  onSelect: (id: string) => void
  onDistrict: (id: DistrictId) => void
  onReady: () => void
}) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)

  const latestCelebration = useMemo(() => {
    const map = new Map<string, number>()
    for (const celebration of state.celebrations) map.set(celebration.agentId, celebration.id)
    return map
  }, [state.celebrations])

  const districtCounts = useMemo(() => {
    const map = new Map<DistrictId, number>()
    for (const agent of state.agents) {
      const id = city.districtForStation(agent.station)
      map.set(id, (map.get(id) ?? 0) + 1)
    }
    return map
  }, [state.agents])

  const agentPositions = useMemo(() => {
    const map: Record<string, [number, number, number]> = {}
    for (const id of Object.keys(AGENT_SLOT)) {
      const slot = AGENT_SLOT[id]
      map[id] = placementFor(slot.station, slot.slot)
    }
    return map
  }, [])

  useEffect(() => {
    onReady()
  }, [onReady])

  const animate = !paused && !reducedMotion
  const stationPosition = (station: StationId): [number, number, number] => [city.PLAZAS[station][0], city.WALK_Y, city.PLAZAS[station][1]]

  return (
    <>
      <color attach="background" args={['#05070f']} />
      <fog attach="fog" args={['#0b1220', 170, 340]} />

      <ambientLight intensity={0.72} color="#aebccd" />
      <hemisphereLight args={['#a9c2de', '#33322c', 0.85]} />
      <directionalLight
        castShadow
        position={[60, 90, 40]}
        intensity={2.2}
        color="#ffd9a2"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-camera-near={1}
        shadow-camera-far={300}
        shadow-bias={-0.0005}
      />

      <BlackHoleBackdrop reducedMotion={reducedMotion} paused={paused} size={0.8} brightness={1.05} direction={BLACK_HOLE_DIRECTION} />

      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial color="#141a22" roughness={1} />
      </mesh>

      <Streets />
      <Plazas />
      <Waterworks />
      <Buildings />
      <Lamps />

      <Citadel />
      <Foundry animate={animate} />
      <Archive />
      <Observatory animate={animate} />
      <Gateway />

      <Rail animate={animate} />
      <Boats animate={animate} />
      <Couriers animate={animate} />
      <Steam animate={animate} />

      {(['forge', 'planning-table', 'signal-post'] as StationId[]).map((id) => (
        <Station key={id} id={id} position={stationPosition(id)} facing={STATION_FACING} reducedMotion={reducedMotion} paused={paused} />
      ))}

      {view.scale === 'city' && city.DISTRICTS.map((district) => (
        <DistrictLabel key={district.id} district={district} count={districtCounts.get(district.id) ?? 0} onDistrict={onDistrict} />
      ))}

      {state.agents.map((agent, index) => {
        const position = agentPositions[agent.id]
        if (!position) return null
        return (
          <group key={agent.id} position={position} rotation={[0, STATION_FACING, 0]} scale={0.85}>
            <CourtyardCharacter
              agent={agent}
              gesture={gestureFor(agent)}
              index={index}
              celebrationId={latestCelebration.get(agent.id)}
              paused={paused}
              reducedMotion={reducedMotion}
              selected={selectedId === agent.id}
              onSelect={onSelect}
            />
          </group>
        )
      })}

      <CameraRig view={view} revision={focusRevision} reducedMotion={reducedMotion} controlsRef={controlsRef} agentPositions={agentPositions} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan={false}
        enableDamping
        minDistance={5}
        maxDistance={420}
        minPolarAngle={0.22}
        maxPolarAngle={1.42}
      />
      <StatsReporter sink={statsSink} enabled={showStats} />
    </>
  )
}

export interface CourtyardSceneProps {
  state: ScenarioState
  selectedId?: string
  view: city.View
  focusRevision: number
  paused: boolean
  reducedMotion: boolean
  showStats: boolean
  statsSink: { current: RenderStats }
  onSelect: (id: string) => void
  onDistrict: (id: DistrictId) => void
  onReady: () => void
}

export function CourtyardScene(props: CourtyardSceneProps) {
  return (
    <div className="proto-canvas" aria-hidden="true">
      <Canvas
        shadows
        dpr={DPR_RANGE}
        camera={CAMERA_CONFIG}
        gl={GL_CONFIG}
        onCreated={() => props.onReady()}
        fallback={(
          <div className="proto-world-fallback">
            <p>3D city unavailable.</p>
            <p>WebGL could not start in this browser. The roster and inspector still describe every agent.</p>
          </div>
        )}
      >
        <Suspense fallback={null}>
          <CourtyardWorld {...props} />
        </Suspense>
      </Canvas>
    </div>
  )
}
