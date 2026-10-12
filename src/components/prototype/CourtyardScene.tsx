import { Html, Instance, Instances, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import type { ComponentRef } from 'react'
import * as THREE from 'three'
import { BlackHoleBackdrop } from '../BlackHoleBackdrop'
import { Workers, workerTargets } from './Workers'
import { preferredDistrict } from './agentModel'
import type { CityAgent } from './agentModel'
import * as city from './city'
import type { DistrictId, StationId } from './city'
import { urgencySort } from './datamap'
import { paintFacadeColorMap, paintFacadeEmissiveMap } from './facadeTexture'
import type { FacadeCanvas } from './facadeTexture'
import { PROVIDER_PALETTE } from './heraldry'
import { hasFreshPresence, selectCourierHandoff, TRAM_TOTAL } from './vehicles'
import { createJadeWaterMaterial, STILL_TIME } from './waterMaterial'
import { WaterGlitter } from './WaterGlitter'

// ---------------------------------------------------------------------------
// Mythic City. (File name is retained from the earlier courtyard prototype; the
// exported names are unchanged so the entry point does not churn.)
//
// A dense, connected harbor city built entirely from shared/instanced primitives:
// six neighborhoods on a 10-unit lattice, a street grid, a diagonal canal and
// southwest harbor, bridges, piers, an elevated rail loop with a moving tram,
// boats, street couriers and steam. Walking workers staff every district work spot:
// they walk the street graph when a real (or clearly labelled simulated) signal
// changes what they are doing. Three viewing scales: city / district / agent. The
// original stylized black-hole sky is restored above the skyline; it is decorative
// and reads no agent state.
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

// Station plazas are staffed; the black-hole direction is world-locked so orbit
// parallaxes around it. The hole sits in the sky band above the skyline.
// World-locked direction for the city's black hole: low enough that the full
// silhouette and lensed arch sit inside the sky band above the skyline.
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

// Buildings are assembled from instanced archetype layers (podium / main / upper)
// with a shared 256x512 facade atlas (map + emissiveMap, flat-colour fallback),
// per-district emissive window panels, solid roof caps plus one instanced
// district-tinted parapet/trim mesh, spires, and a hero crown above its lattice cell.

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
    // Workers stand ~2.2x the old courtyard figure (~3.6 units tall).
    const pixelDist = (charHeight: number, charPx: number) => (charHeight * size.height) / (2 * Math.tan(vFov / 2) * charPx)
    const needed = Math.max(fit(radius, 1.05), pixelTarget ? pixelDist(3.6, pixelTarget) : 0)
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

function Waterworks({ beamXZ, beamOn, animate }: { beamXZ: [number, number] | null; beamOn: boolean; animate: boolean }) {
  const time = useDrivenTime(animate)
  const material = useMemo(() => createJadeWaterMaterial(), [])
  useEffect(() => () => material.dispose(), [material])
  useFrame(() => {
    material.uniforms.uTime.value = animate ? time.current : STILL_TIME
    if (beamXZ) material.uniforms.uBeamXZ.value.set(beamXZ[0], beamXZ[1])
    material.uniforms.uBeamStrength.value = beamOn ? 1 : 0
  })
  return (
    <group>
      <mesh position={[city.HARBOR.x, 0.14, city.HARBOR.z]} rotation={[-Math.PI / 2, 0, 0]} material={material}>
        <planeGeometry args={[city.HARBOR.w, city.HARBOR.d, 24, 24]} />
      </mesh>
      {city.CANAL_SEGMENTS.map((segment, index) => (
        <mesh key={index} position={[segment.x, 0.16, segment.z]} rotation={[-Math.PI / 2, 0, segment.rot]} material={material}>
          <planeGeometry args={[city.CANAL_WIDTH, segment.len + 1.5, 4, 16]} />
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
      <mesh position={[-5, 12, 0]} receiveShadow>
        <boxGeometry args={[3.4, 24, 3.4]} />
        <meshStandardMaterial color="#38334a" roughness={0.9} />
      </mesh>
      <mesh position={[5, 12, 0]} receiveShadow>
        <boxGeometry args={[3.4, 24, 3.4]} />
        <meshStandardMaterial color="#38334a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 25, 0]} receiveShadow>
        <boxGeometry args={[15, 2.4, 3.4]} />
        <meshStandardMaterial color="#403a52" roughness={0.9} />
      </mesh>
      <mesh position={[0, 12, 0]}>
        <planeGeometry args={[7, 22]} />
        <meshStandardMaterial color="#7fd0ff" emissive="#7fd0ff" emissiveIntensity={0.8} transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// --- Transit and street life -------------------------------------------------

function Rail({ animate, litCount, tint }: { animate: boolean; litCount: number; tint: string }) {
  const time = useDrivenTime(animate)
  const tram = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const scratch = useMemo(() => new THREE.Color(), [])
  const tangent = useMemo(() => new THREE.Vector3(), [])
  const curve = useMemo(() => new THREE.CatmullRomCurve3(city.RAIL_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'centripetal'), [])
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 240, 0.22, 6, true), [curve])
  useEffect(() => () => geometry.dispose(), [geometry])
  const lit = Math.min(TRAM_TOTAL, Math.max(1, Math.floor(litCount)))
  useEffect(() => {
    const node = tram.current
    if (!node) return
    for (let car = 0; car < TRAM_TOTAL; car += 1) {
      scratch.set(car < lit ? tint : '#232a33')
      node.setColorAt(car, scratch)
    }
    if (node.instanceColor) node.instanceColor.needsUpdate = true
  }, [lit, tint, scratch])
  useFrame(() => {
    const node = tram.current
    if (!node) return
    for (let car = 0; car < TRAM_TOTAL; car += 1) {
      if (car < lit) {
        const s = (((time.current / 35 - car / lit) % 1) + 1) % 1
        curve.getPointAt(s, dummy.position)
        curve.getTangentAt(s, tangent)
        dummy.position.y += 0.5
        dummy.quaternion.setFromUnitVectors(FORWARD, tangent)
      } else {
        dummy.position.set(52 + (car - lit) * 2.4, 7.5, 24)
        dummy.quaternion.identity()
      }
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
      <instancedMesh ref={tram} args={[undefined, undefined, TRAM_TOTAL]} castShadow>
        <boxGeometry args={[1.7, 1.7, 5.6]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
    </group>
  )
}

function Boats({ animate, sailPort, sailArchive }: { animate: boolean; sailPort: boolean; sailArchive: boolean }) {
  const time = useDrivenTime(animate)
  const refs = useRef<Array<THREE.Group | null>>([])
  const curves = useMemo(() => city.BOAT_ROUTES.map((route) => new THREE.CatmullRomCurve3(
    route.points.map(([x, z]) => new THREE.Vector3(x, 0.3, z)), false, 'centripetal',
  )), [])
  const tangent = useMemo(() => new THREE.Vector3(), [])
  const sails = [sailPort, sailArchive, true]
  useFrame(() => {
    curves.forEach((curve, index) => {
      const node = refs.current[index]
      if (!node) return
      const route = city.BOAT_ROUTES[index]
      if (!sails[index] || !animate) {
        const [mx, mz] = route.points[0]
        node.position.set(mx, 0.3, mz)
        node.rotation.set(0, Math.PI / 2, 0)
        return
      }
      const raw = ((time.current / route.period + route.phase) % 1 + 1) % 1
      // Bounded ping-pong on every open route, with the heading flipped on the return leg.
      const s = raw < 0.5 ? raw * 2 : 2 - raw * 2
      const clamped = Math.min(0.999, Math.max(0.001, s))
      const heading = raw < 0.5 ? 1 : -1
      curve.getPointAt(clamped, node.position)
      curve.getTangentAt(clamped, tangent)
      node.position.y = 0.3 + Math.sin(time.current * 0.9 + index * 2.1) * 0.08
      node.rotation.set(Math.sin(time.current * 0.7 + index) * 0.03, Math.atan2(tangent.x * heading, tangent.z * heading), 0)
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

// A one-shot freighter departs the Port quay on a ship event: it sails out of
// the harbor behind the pier tip, then fades past the mouth. A fresh hull waits
// docked for the next event.
const SHIP_DOCK: [number, number] = [-54, 44]
const SHIP_VIA: [number, number] = [-64, 46]
const SHIP_EXIT: [number, number] = [-69, 58]
const SHIP_SAIL_SECONDS = 9

function ShipBoat({ shipCount, animate, tint }: { shipCount: number; animate: boolean; tint: string }) {
  const time = useDrivenTime(animate)
  const group = useRef<THREE.Group>(null)
  const wake = useRef<THREE.Mesh>(null)
  const lamp = useRef<THREE.PointLight>(null)
  const mats = useRef<THREE.Material[] | null>(null)
  const queue = useRef(0)
  const lastSeen = useRef(shipCount)
  const sailing = useRef(false)
  const sailStart = useRef(0)

  useEffect(() => {
    if (shipCount > lastSeen.current) queue.current += shipCount - lastSeen.current
    lastSeen.current = shipCount
  }, [shipCount])

  useFrame(() => {
    const node = group.current
    if (!node) return
    if (!mats.current) {
      const found: THREE.Material[] = []
      node.traverse((obj) => {
        const material = (obj as THREE.Mesh).material as THREE.Material | undefined
        if (material) found.push(material)
      })
      for (const material of found) material.transparent = true
      mats.current = found
    }
    if (!animate) {
      // Reduced motion or pause settle: a boat waits docked, nothing sails.
      node.visible = true
      node.position.set(SHIP_DOCK[0], 0.3, SHIP_DOCK[1])
      node.rotation.y = Math.PI / 2
      for (const material of mats.current) material.opacity = 1
      sailing.current = false
      if (wake.current) wake.current.visible = false
      if (lamp.current) lamp.current.intensity = 3
      return
    }
    if (!sailing.current) {
      if (queue.current > 0) {
        queue.current -= 1
        sailing.current = true
        sailStart.current = time.current
      } else {
        node.visible = true
        node.position.set(SHIP_DOCK[0], 0.3, SHIP_DOCK[1])
        node.rotation.y = Math.PI / 2
        for (const material of mats.current) material.opacity = 1
        if (wake.current) wake.current.visible = false
        if (lamp.current) lamp.current.intensity = 3
        return
      }
    }
    const progress = (time.current - sailStart.current) / SHIP_SAIL_SECONDS
    if (progress >= 1) {
      sailing.current = false
      node.visible = false
      return
    }
    node.visible = true
    const first = Math.min(1, progress * 2)
    const second = Math.max(0, progress * 2 - 1)
    const mx = SHIP_DOCK[0] + (SHIP_VIA[0] - SHIP_DOCK[0]) * first + (SHIP_EXIT[0] - SHIP_VIA[0]) * second
    const mz = SHIP_DOCK[1] + (SHIP_VIA[1] - SHIP_DOCK[1]) * first + (SHIP_EXIT[1] - SHIP_VIA[1]) * second
    const hx = second > 0 ? SHIP_EXIT[0] - SHIP_VIA[0] : SHIP_VIA[0] - SHIP_DOCK[0]
    const hz = second > 0 ? SHIP_EXIT[1] - SHIP_VIA[1] : SHIP_VIA[1] - SHIP_DOCK[1]
    node.position.set(mx, 0.3 + Math.sin(time.current * 0.9) * 0.06, mz)
    node.rotation.y = Math.atan2(hx, hz)
    const fade = progress > 0.6 ? 1 - (progress - 0.6) / 0.4 : 1
    for (const material of mats.current) material.opacity = fade
    if (wake.current) {
      const wakeMat = wake.current.material as THREE.MeshBasicMaterial
      wakeMat.opacity = 0.45 * Math.min(1, progress * 4) * fade
      wake.current.visible = true
    }
    if (lamp.current) lamp.current.intensity = 6 + 4 * Math.sin(time.current * 6)
  })

  return (
    <group ref={group} position={[SHIP_DOCK[0], 0.3, SHIP_DOCK[1]]}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[3.0, 1.2, 7]} />
        <meshStandardMaterial color="#4a3b2c" roughness={0.85} />
      </mesh>
      {[-2, 0, 2].map((z) => (
        <mesh key={z} position={[0, 1.25, z]}>
          <boxGeometry args={[2.2, 1.0, 1.6]} />
          <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.55} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 3.2, -2.6]}>
        <cylinderGeometry args={[0.08, 0.1, 3.4, 6]} />
        <meshStandardMaterial color="#3a4048" roughness={0.8} />
      </mesh>
      <mesh position={[0, 5.0, -2.6]}>
        <sphereGeometry args={[0.22, 8, 6]} />
        <meshStandardMaterial color="#fff2cf" emissive="#fff2cf" emissiveIntensity={1.2} />
      </mesh>
      <pointLight ref={lamp} position={[0, 5.2, -2.6]} color="#ffe9b0" intensity={3} distance={10} decay={2} />
      <mesh ref={wake} position={[0, -0.05, 5.5]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <planeGeometry args={[2.6, 8]} />
        <meshBasicMaterial color="#bfe3dd" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  )
}

export interface CourierLeg {
  from: [number, number]
  to: [number, number]
  key: string
}

const COURIER_COUNT = 8
const COURIER_LEG_SECONDS = 8

function Couriers({ animate, leg }: { animate: boolean; leg: CourierLeg | null }) {
  const time = useDrivenTime(animate)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const scratch = useMemo(() => new THREE.Color(), [])
  const parked = useMemo((): [number, number][] => {
    const spots: [number, number][] = []
    for (let i = 0; i < COURIER_COUNT; i += 1) {
      const route = city.COURIER_ROUTES[i % city.COURIER_ROUTES.length]
      const [px, pz] = route.points[i % 2]
      spots.push([px + (i % 3) * 1.2, pz + Math.floor(i / 3) * 1.2])
    }
    return spots
  }, [])
  const run = useRef({ key: '', start: 0 })
  useFrame(() => {
    const node = mesh.current
    if (!node) return
    const active = animate && leg !== null
    if (leg && leg.key !== run.current.key) run.current = { key: leg.key, start: time.current }
    const progress = leg ? (time.current - run.current.start) / COURIER_LEG_SECONDS : 1
    const running = active && leg && run.current.key === leg.key && progress < 1
    for (let i = 0; i < COURIER_COUNT; i += 1) {
      if (i === 0 && running && leg) {
        const t = Math.min(1, Math.max(0, progress))
        dummy.position.set(leg.from[0] + (leg.to[0] - leg.from[0]) * t, 0.9, leg.from[1] + (leg.to[1] - leg.from[1]) * t)
        dummy.rotation.set(0, Math.atan2(leg.to[0] - leg.from[0], leg.to[1] - leg.from[1]), 0)
        scratch.set('#ff9b47')
      } else {
        dummy.position.set(parked[i][0], 0.9, parked[i][1])
        dummy.rotation.set(0, (i * 0.7) % Math.PI, 0)
        scratch.set('#2a2f36')
      }
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      node.setMatrixAt(i, dummy.matrix)
      node.setColorAt(i, scratch)
    }
    node.instanceMatrix.needsUpdate = true
    if (node.instanceColor) node.instanceColor.needsUpdate = true
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COURIER_COUNT]}>
      <boxGeometry args={[0.7, 0.7, 1.3]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
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
// well clear of the worker, so the agent corridor stays open.
function Plazas() {
  return (
    <group>
      {city.PLAZA_PAVING.map(([x, z], index) => (
        <mesh key={`p${index}`} position={[x, city.WALK_Y - 0.07, z]} receiveShadow>
          <cylinderGeometry args={[city.PLAZA_PAVING_RADIUS, city.PLAZA_PAVING_RADIUS, 0.14, 32]} />
          <meshStandardMaterial color="#3a4149" roughness={0.98} />
        </mesh>
      ))}
      {city.SPOT_PAVING.map(([x, z], index) => (
        <mesh key={`s${index}`} position={[x, city.WALK_Y - 0.07, z]} receiveShadow>
          <cylinderGeometry args={[city.SPOT_PAVING_RADIUS, city.SPOT_PAVING_RADIUS, 0.14, 28]} />
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

// District window glow follows the count of fresh active workers there, eased over
// about 1.5 s. Windows are grouped per district so each neighborhood glows on its
// own; the easing freezes while paused and snaps (no ease) under reduced motion
// so the still scene stays truthful without animation.
function DistrictWindows({ counts, frozen, reducedMotion }: { counts: Record<DistrictId, number>; frozen: boolean; reducedMotion: boolean }) {
  const mats = useRef<Array<THREE.MeshStandardMaterial | null>>([])
  const current = useRef<number[]>([0.4, 0.4, 0.4, 0.4, 0.4, 0.4])
  const perDistrict = useMemo(
    () => city.DISTRICTS.map((district) => city.WINDOWS.filter((panel) => panel.district === district.id)),
    [],
  )
  useFrame((_, delta) => {
    if (frozen) return
    city.DISTRICTS.forEach((district, index) => {
      const target = 0.35 + 0.3 * Math.min(3, counts[district.id] ?? 0)
      const material = mats.current[index]
      if (!material) return
      if (reducedMotion) {
        // Still pin: snap to the truthful level instead of easing.
        if (current.current[index] !== target) {
          current.current[index] = target
          material.emissiveIntensity = target
        }
        return
      }
      current.current[index] += (target - current.current[index]) * Math.min(1, delta / 1.5)
      material.emissiveIntensity = current.current[index]
    })
  })
  return (
    <group>
      {perDistrict.map((panels, index) => panels.length === 0 ? null : (
        <Instances key={city.DISTRICTS[index].id} limit={panels.length}>
          <boxGeometry args={[1, 1, 0.16]} />
          <meshStandardMaterial
            ref={(node) => { mats.current[index] = node }}
            color="#ffd9a0"
            emissive="#ffcf8a"
            emissiveIntensity={0.4}
            roughness={0.6}
          />
          {panels.map((panel, k) => (
            <Instance key={k} position={[panel.x, panel.y, panel.z]} rotation={[0, panel.rot, 0]} scale={[panel.w, panel.h, 1]} />
          ))}
        </Instances>
      ))}
    </group>
  )
}

function useFacadeMaps(): { map: THREE.Texture | null; emissiveMap: THREE.Texture | null } {
  const maps = useMemo(() => {
    try {
      if (typeof document === 'undefined') return { map: null, emissiveMap: null }
      const factory = (w: number, h: number): FacadeCanvas | null => {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        return canvas as unknown as FacadeCanvas
      }
      // Static mid-lit atlas for the instanced shells; per-district live glow
      // stays in DistrictWindows (emissiveIntensity from the same active counts).
      const colorCanvas = paintFacadeColorMap(factory, 0.5)
      const emissiveCanvas = paintFacadeEmissiveMap(factory, 0.5)
      if (!colorCanvas || !emissiveCanvas) return { map: null, emissiveMap: null }
      const map = new THREE.CanvasTexture(colorCanvas as unknown as HTMLCanvasElement)
      map.colorSpace = THREE.SRGBColorSpace
      map.anisotropy = 4
      const emissiveMap = new THREE.CanvasTexture(emissiveCanvas as unknown as HTMLCanvasElement)
      emissiveMap.colorSpace = THREE.SRGBColorSpace
      emissiveMap.anisotropy = 4
      return { map, emissiveMap }
    } catch {
      // Degrade to flat colour when the texture is unavailable.
      return { map: null, emissiveMap: null }
    }
  }, [])
  useEffect(() => () => {
    maps.map?.dispose()
    maps.emissiveMap?.dispose()
  }, [maps])
  return maps
}

function Buildings() {
  const facade = useFacadeMaps()
  const layers: { parts: city.BuildingPart[]; color: string; roughness: number; metalness: number }[] = [
    { parts: city.PODIUM_PARTS, color: '#ffffff', roughness: 0.92, metalness: 0.12 },
    { parts: city.MAIN_PARTS, color: '#ffffff', roughness: 0.88, metalness: 0.12 },
    { parts: city.UPPER_PARTS, color: '#ffffff', roughness: 0.9, metalness: 0.14 },
  ]
  return (
    <group>
      {layers.map((layer, index) => (
        <Instances key={index} limit={layer.parts.length} receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color={layer.color}
            roughness={layer.roughness}
            metalness={layer.metalness}
            map={facade.map ?? undefined}
            emissiveMap={facade.emissiveMap ?? undefined}
            emissive="#ffcf8a"
            emissiveIntensity={facade.map ? 0.22 : 0}
          />
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
      {/* Single instanced parapet/trim mesh, tinted per district. */}
      <Instances limit={city.ROOFCAPS.length} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.7} metalness={0.25} />
        {city.ROOFCAPS.map((cap, index) => (
          <Instance
            key={index}
            color={city.TRIM[cap.district]}
            position={[cap.x, cap.y + 0.55, cap.z]}
            scale={[cap.w * 1.02, 0.4, cap.d * 1.02]}
          />
        ))}
      </Instances>
      <Instances limit={city.SPIRES.length}>
        <coneGeometry args={[1, 1, 5]} />
        <meshStandardMaterial color="#4a5666" roughness={0.7} metalness={0.35} />
        {city.SPIRES.map((spire, index) => (
          <Instance key={index} position={[spire.x, spire.y + spire.h / 2, spire.z]} scale={[spire.r, spire.h, spire.r]} />
        ))}
      </Instances>
      <HeroCrown />
    </group>
  )
}

// Hero crown: the hero's boxes and spire already come from the instanced layers;
// the three amber rings make the needle read above the hole band at city zoom.
function HeroCrown() {
  const [hx, hz] = city.HERO_CELL
  return (
    <group position={[hx, 0, hz]}>
      <mesh position={[0, 34.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[4.2, 0.3, 6, 24]} />
        <meshStandardMaterial color="#ffbe6a" emissive="#ffbe6a" emissiveIntensity={2.0} roughness={0.5} />
      </mesh>
      <mesh position={[0, 52.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[3.0, 0.26, 6, 20]} />
        <meshStandardMaterial color="#ffd28a" emissive="#ffd28a" emissiveIntensity={2.0} roughness={0.5} />
      </mesh>
      <mesh position={[0, 62.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.9, 0.22, 6, 18]} />
        <meshStandardMaterial color="#ffd28a" emissive="#ffd28a" emissiveIntensity={2.0} roughness={0.5} />
      </mesh>
    </group>
  )
}

// --- Work stations and new work-spot dressing ---------------------------------

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
          <meshStandardMaterial color="#ffcf7a" emissive="#ffcf5c" emissiveIntensity={0.9} roughness={0.5} />
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

// Smallest dressing that reads as a work spot: the Citadel steps (needs-input waits
// face the core from here), a terrace telescope, and quay crates with a mooring post.
function CitadelSteps() {
  const [x, z] = city.WORK_SPOTS.citadel.center
  return (
    <group position={[x, 0, z]}>
      {[0, 1, 2, 3].map((step) => (
        <mesh key={step} position={[0, 0.25 + step * 0.5, 2.6 - step * 1.7]} receiveShadow>
          <boxGeometry args={[9 - step * 1.2, 0.5, 1.8]} />
          <meshStandardMaterial color="#3d4654" roughness={0.95} />
        </mesh>
      ))}
      {[[-4.6, 0], [4.6, 0]].map(([bx, bz]) => (
        <group key={`${bx}`} position={[bx, 0, bz]}>
          <mesh position={[0, 2.2, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.12, 4.4, 6]} />
            <meshStandardMaterial color="#5a4228" roughness={0.95} />
          </mesh>
          <mesh position={[0, 3.4, 0]}>
            <boxGeometry args={[0.7, 1.0, 0.05]} />
            <meshStandardMaterial color="#d9b05a" emissive="#d9b05a" emissiveIntensity={0.35} roughness={0.85} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function TerraceScope() {
  const [x, z] = city.WORK_SPOTS.observatory.center
  return (
    <group position={[x, 0, z]}>
      <mesh position={[2.8, 0.5, -2.4]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 1.0, 0.9]} />
        <meshStandardMaterial color="#3a4149" roughness={0.9} />
      </mesh>
      <group position={[-2.6, 0, 2.2]} rotation={[0, 0.7, 0]}>
        {[[-0.5, 0.35], [0.5, 0.35], [0, -0.55]].map(([lx, lz], index) => (
          <mesh key={index} position={[lx, 0.6, lz]} rotation={[lz > 0 ? -0.4 : 0.4, 0, lx > 0 ? 0.4 : -0.4]} castShadow>
            <cylinderGeometry args={[0.06, 0.06, 1.5, 6]} />
            <meshStandardMaterial color="#4a4f56" roughness={0.6} metalness={0.4} />
          </mesh>
        ))}
        <mesh position={[0, 1.5, 0]} rotation={[-0.6, 0, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.22, 1.4, 10]} />
          <meshStandardMaterial color="#59626c" roughness={0.5} metalness={0.4} />
        </mesh>
      </group>
    </group>
  )
}

function QuayProps() {
  const [x, z] = city.WORK_SPOTS.port.center
  return (
    <group position={[x, 0, z]}>
      {[[-3.2, -2.2, 0.9], [-2.2, -2.6, 0.7], [-2.7, -1.7, 0.7]].map(([cx, cz, s], index) => (
        <mesh key={index} position={[cx, s / 2, cz]} rotation={[0, index * 0.4, 0]} castShadow receiveShadow>
          <boxGeometry args={[s, s, s]} />
          <meshStandardMaterial color="#6b4f33" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[3.4, 0.8, 2.6]} castShadow>
        <cylinderGeometry args={[0.14, 0.18, 1.6, 8]} />
        <meshStandardMaterial color="#4a3524" roughness={0.95} />
      </mesh>
    </group>
  )
}

// --- Labels ------------------------------------------------------------------

function DistrictLabel({ district, assigned, active, onDistrict }: { district: city.District; assigned: number; active: number; onDistrict: (id: DistrictId) => void }) {
  const y = district.radius * 1.05 + 10
  return (
    <Html position={[district.center[0], y, district.center[1]]} center zIndexRange={[1, 0]}>
      <button type="button" className="proto-district-label" onClick={(event) => { event.stopPropagation(); onDistrict(district.id) }}>
        <span>{district.name}</span>
        <small>
          {assigned === 0
            ? 'No workers assigned'
            : `${assigned} assigned · ${active} active`}
        </small>
      </button>
    </Html>
  )
}

// --- World ------------------------------------------------------------------

const STATION_FACING = 0.5

function CourtyardWorld({ agents, celebrationBy, shipCount, workingCount, tramTint, selectedId, view, focusRevision, paused, reducedMotion, showStats, statsSink, onSelect, onDistrict, onReady }: {
  agents: CityAgent[]
  celebrationBy: Record<string, number>
  shipCount: number
  workingCount?: number
  tramTint?: string
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

  const districtCounts = useMemo(() => {
    const map = new Map<DistrictId, number>()
    for (const agent of agents) {
      if (agent.freshness === 'historical') continue
      const id = preferredDistrict(agent)
      map.set(id, (map.get(id) ?? 0) + 1)
    }
    return map
  }, [agents])

  const glowCounts = useMemo(() => {
    const counts: Record<DistrictId, number> = {
      citadel: 0, foundry: 0, archive: 0, observatory: 0, port: 0, gateway: 0,
    }
    for (const agent of agents) {
      if (agent.freshness !== 'fresh' || agent.workState !== 'active') continue
      counts[preferredDistrict(agent)] += 1
    }
    return counts
  }, [agents])

  const agentPositions = useMemo(() => {
    const map: Record<string, [number, number, number]> = {}
    for (const [id, target] of workerTargets(agents)) {
      map[id] = [target.x, city.WALK_Y, target.z]
    }
    return map
  }, [agents])

  const beamAgent = useMemo(() => urgencySort(agents).find(
    (agent) => agent.freshness === 'fresh' && agent.workState === 'needs-input',
  ), [agents])
  const beamXZ: [number, number] | null = beamAgent && agentPositions[beamAgent.id]
    ? [agentPositions[beamAgent.id][0], agentPositions[beamAgent.id][2]]
    : null
  const beamOn = beamXZ !== null

  const handoff = useMemo(() => selectCourierHandoff(agents), [agents])
  const courierLeg: CourierLeg | null = useMemo(() => {
    if (!handoff) return null
    const from = agentPositions[handoff.parentId]
    const to = agentPositions[handoff.childId]
    if (!from || !to) return null
    return { from: [from[0], from[2]], to: [to[0], to[2]], key: handoff.key }
  }, [handoff, agentPositions])

  const sailPort = useMemo(() => hasFreshPresence(agents, 'port'), [agents])
  const sailArchive = useMemo(() => hasFreshPresence(agents, 'archive'), [agents])

  const shipTint = useMemo(() => {
    const sailing = agents.find((agent) => agent.freshness === 'fresh' && agent.toolKind === 'ship')
    return sailing ? (PROVIDER_PALETTE[sailing.provider] ?? '#ffbf6a') : '#ffbf6a'
  }, [agents])

  const litCount = workingCount ?? 1

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
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={1}
        shadow-camera-far={300}
        shadow-bias={-0.0005}
      />

      <BlackHoleBackdrop reducedMotion={reducedMotion} paused={paused} size={0.8} brightness={1.05} direction={BLACK_HOLE_DIRECTION} worldLocked />

      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial color="#141a22" roughness={1} />
      </mesh>

      <Streets />
      <Plazas />
      <Waterworks beamXZ={beamXZ} beamOn={beamOn} animate={animate} />
      <WaterGlitter counts={glowCounts} beamXZ={beamXZ} beamOn={beamOn} animate={animate} />
      <Buildings />
      <DistrictWindows counts={glowCounts} frozen={paused} reducedMotion={reducedMotion} />
      <Lamps />

      <Citadel />
      <Foundry animate={animate} />
      <Archive />
      <Observatory animate={animate} />
      <Gateway />

      <Rail animate={animate} litCount={litCount} tint={tramTint ?? '#ff9b47'} />
      <Boats animate={animate} sailPort={sailPort} sailArchive={sailArchive} />
      <ShipBoat shipCount={shipCount} animate={animate} tint={shipTint} />
      <Couriers animate={animate} leg={courierLeg} />
      <Steam animate={animate} />

      {(['forge', 'planning-table', 'signal-post'] as StationId[]).map((id) => (
        <Station key={id} id={id} position={stationPosition(id)} facing={STATION_FACING} reducedMotion={reducedMotion} paused={paused} />
      ))}
      <CitadelSteps />
      <TerraceScope />
      <QuayProps />

      {view.scale === 'city' && city.DISTRICTS.map((district) => (
        <DistrictLabel
          key={district.id}
          district={district}
          assigned={districtCounts.get(district.id) ?? 0}
          active={glowCounts[district.id] ?? 0}
          onDistrict={onDistrict}
        />
      ))}

      <Workers
        agents={agents}
        selectedId={selectedId}
        paused={paused}
        reducedMotion={reducedMotion}
        celebrationBy={celebrationBy}
        onSelect={onSelect}
      />

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
  agents: CityAgent[]
  celebrationBy: Record<string, number>
  shipCount: number
  workingCount?: number
  tramTint?: string
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
