import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { districtMeta } from '../data/demo'
import type { AgentRecord, DistrictId, WorkerStatus } from '../types'

// The Villages reference map (andrinr/villages, AGPL-3.0). Assets and the AGPL
// license text live under public/models with a local Draco decoder in public/draco.
const MODEL_URL = '/models/models3.gltf'
const DRACO_PATH = '/draco/'

// One shared decoder for the app: local assets only, and the JS decoder the reference
// project used, so loading never depends on a CDN or on WebAssembly support.
let villageDraco: DRACOLoader | null = null
function configureVillageLoader(loader: GLTFLoader) {
  if (!villageDraco) {
    villageDraco = new DRACOLoader()
    villageDraco.setDecoderPath(DRACO_PATH)
    villageDraco.setDecoderConfig({ type: 'js' })
  }
  loader.setDRACOLoader(villageDraco)
}
// After loading we rescale the map so the spread of the seven district anchors is this
// many world units. The authored terrain is far larger than the district cluster, so
// framing the cluster keeps the agent markers legible while the rest of the village
// recedes as a backdrop.
const DISTRICT_SPAN_TARGET = 22

// Each of our seven districts is anchored to a named node inside models3.gltf.
// The map is static (247 nodes, 187 meshes, zero animation clips), so these nodes
// are stable, authored locations rather than anything we invent at runtime.
const DISTRICT_ANCHORS: Record<DistrictId, string> = {
  'great-hall': 'ANCHOR_00',
  watchtower: 'ANCHOR_01_Society',
  forge: 'ANCHOR_15_Construction',
  'proving-grounds': 'ANCHOR_03_Science_Education',
  'scribe-hall': 'ANCHOR_02_Economics',
  oracle: 'ANCHOR_06_Philosophy',
  dock: 'ANCHOR_10_Mobility',
}

const statusColor: Record<WorkerStatus, string> = {
  active: '#cf9f5a', waiting: '#87938b', 'needs-input': '#d47f5f', review: '#75a6a0', failed: '#a8584e', complete: '#87a96f', unknown: '#69736e',
}

const statusLabel: Record<WorkerStatus, string> = {
  active: 'Active', waiting: 'Waiting', 'needs-input': 'Needs input', review: 'In review', failed: 'Failed', complete: 'Complete', unknown: 'Status unavailable',
}

type HatKind = 'brim' | 'helm' | 'hood' | 'cap'

// Each district gets a simple, distinct uniform (coat, accent, headwear) so its agents
// read apart on the map without adding animation clips or per-agent state.
const districtUniform: Record<DistrictId, { coat: string; accent: string; hat: HatKind }> = {
  'great-hall': { coat: '#c79a4e', accent: '#f3e3bd', hat: 'brim' },
  watchtower: { coat: '#5c7f98', accent: '#dbe9f2', hat: 'helm' },
  forge: { coat: '#4d423a', accent: '#e0863f', hat: 'cap' },
  'proving-grounds': { coat: '#5f9d92', accent: '#e8f4f1', hat: 'cap' },
  'scribe-hall': { coat: '#5b6aa0', accent: '#e4e9f6', hat: 'hood' },
  oracle: { coat: '#7e6aab', accent: '#efe8ff', hat: 'hood' },
  dock: { coat: '#8b6a49', accent: '#ecdbc4', hat: 'brim' },
}

const SKIN = '#c8a47a'
const BOOT = '#2f3338'
const ACTIVITY_LABEL_MAX = 50

// A short, whitespace-collapsed hover label. The full activity stays in the roster.
function shortActivity(record: AgentRecord) {
  const collapsed = (record.activity || record.title || '').replace(/\s+/g, ' ').trim()
  if (collapsed.length <= ACTIVITY_LABEL_MAX) return collapsed
  const clipped = collapsed.slice(0, ACTIVITY_LABEL_MAX)
  const lastSpace = clipped.lastIndexOf(' ')
  const base = lastSpace > 24 ? clipped.slice(0, lastSpace) : clipped
  return `${base.replace(/[\s.,;:·-]+$/, '')}…`
}

function Headwear({ kind, color }: { kind: HatKind; color: string }) {
  if (kind === 'helm') {
    return (
      <mesh position={[0, 1.64, 0]} castShadow>
        <sphereGeometry args={[0.23, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.15} />
      </mesh>
    )
  }
  if (kind === 'hood') {
    return (
      <mesh position={[0, 1.62, 0]} castShadow>
        <coneGeometry args={[0.27, 0.44, 10]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
    )
  }
  if (kind === 'brim') {
    return (
      <group position={[0, 1.68, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.36, 0.36, 0.05, 14]} />
          <meshStandardMaterial color={color} roughness={0.75} />
        </mesh>
        <mesh position={[0, 0.1, 0]} castShadow>
          <cylinderGeometry args={[0.17, 0.19, 0.2, 12]} />
          <meshStandardMaterial color={color} roughness={0.75} />
        </mesh>
      </group>
    )
  }
  return (
    <mesh position={[0, 1.68, 0]} castShadow>
      <cylinderGeometry args={[0.21, 0.21, 0.16, 12]} />
      <meshStandardMaterial color={color} roughness={0.75} />
    </mesh>
  )
}

const CELEBRATION_SECONDS = 2.4
const CLICK_DRAG_TOLERANCE_PX = 6

// Bounded, decorative motion routines. Walking, inspecting, signalling and the
// celebration hop are illustrative village staging only; they are never evidence of
// verified model work. Movement is past-facing for historical records and neutral for
// stale/unknown ones.
const WALK_SECONDS = 4.2
const WALK_STRIDE = 0.95
// A smooth closed ellipse. It is genuinely continuous: position and heading both wrap
// to the same value at progress 0 and 1, so the loop never snaps.
const ROUTE_RX = 0.6
const ROUTE_RZ = 0.42
// Active and moving-historical workers lean into and out of the route from the resting
// arc, so entering and leaving rest glides instead of jumping to the origin.
const ENTER_FRACTION = 0.14
const ROUTE_ENTRY_X = ROUTE_RX * 0.55
const ROUTE_ENTRY_Z = ROUTE_RZ * 0.55

function resetLegs(legs: THREE.Group[]) {
  for (const leg of legs) leg.rotation.x = 0
}

/**
 * Walks the closed route around the agent's post for `progress` in 0..1. The centre of
 * the loop is `(cx, cz)`, which lets departure and return to rest glide.
 */
function applyWalk(node: THREE.Group, legs: THREE.Group[], arms: THREE.Group[], progress: number, cx = 0, cz = 0) {
  const angle = progress * Math.PI * 2
  const x = cx + Math.cos(angle) * ROUTE_RX
  const z = cz + Math.sin(angle) * ROUTE_RZ
  node.position.set(x, 0, z)
  // Heading is perpendicular to the radius, so it advances in step with the position.
  node.rotation.y = Math.atan2(Math.cos(angle) * ROUTE_RX, -Math.sin(angle) * ROUTE_RZ)
  const stride = Math.sin(progress * Math.PI * 2 * 7) * WALK_STRIDE
  legs[0].rotation.x = stride
  legs[1].rotation.x = -stride
  arms[0].rotation.x = -stride * 0.65
  arms[1].rotation.x = stride * 0.65
}

/** A slow bend-and-rise inspect gesture with both arms raised forward. */
function applyInspect(body: THREE.Group, legs: THREE.Group[], arms: THREE.Group[], t: number, phase: number) {
  const lean = Math.sin(t * 0.9 + phase) * 0.16
  body.rotation.x = 0.14 + lean
  arms[0].rotation.x = -0.95 + lean
  arms[1].rotation.x = -0.95 + lean
  resetLegs(legs)
}

// A one-armed raise that reads as an attention signal.
function applySignal(arms: THREE.Group[], t: number, phase: number) {
  const pulse = Math.sin(t * 3.1 + phase)
  arms[1].rotation.x = -2.2 + pulse * 0.18
  arms[0].rotation.x = Math.sin(t * 1.2 + phase) * 0.08
}

/**
 * An ambient, ground-returning loop for records that are real but not current. The rise
 * is always multiplied by a window that opens and closes at zero, so the figure lands
 * exactly on the ground and there is never a jump into the idle pose.
 */
function applyAmbient(node: THREE.Group, body: THREE.Group, legs: THREE.Group[], arms: THREE.Group[], t: number, phase: number) {
  const cycle = (Math.sin(t * 0.35 + phase) + 1) / 2
  const lift = Math.max(0, Math.sin(t * 0.7 + phase))
  body.position.y = lift * 0.14
  body.rotation.x = 0
  body.rotation.z = 0
  node.position.set(Math.sin(t * 0.4 + phase) * 0.12, 0, Math.cos(t * 0.33 + phase) * 0.1)
  node.rotation.y = cycle * Math.PI * 0.7
  resetLegs(legs)
  arms[0].rotation.x = Math.sin(t * 0.6 + phase) * 0.3
  arms[1].rotation.x = Math.sin(t * 0.6 + phase + 0.6) * 0.3
}

interface MapLayout {
  scale: number
  position: THREE.Vector3
  districts: Record<DistrictId, THREE.Vector3>
}

function Worker({ record, district, slot, reducedMotion, selected, onSelect }: {
  record: AgentRecord
  district: DistrictId
  slot: number
  reducedMotion: boolean
  selected: boolean
  onSelect: (id: string) => void
}) {
  // The outer group is the stable, grounded placement and the click target. The walk
  // group carries the bounded route and the body group carries the pose, so neither can
  // overwrite the placement.
  const walk = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const leftLeg = useRef<THREE.Group>(null)
  const rightLeg = useRef<THREE.Group>(null)
  const leftArm = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Group>(null)
  // Status, staleness, historical age and reduced-motion are read inside the frame
  // loop through refs so a telemetry refresh never captures a stale status.
  const statusRef = useRef(record.status)
  const staleRef = useRef(Boolean(record.stale))
  const pastRef = useRef(Boolean(record.historical))
  const reducedRef = useRef(reducedMotion)
  statusRef.current = record.status
  staleRef.current = Boolean(record.stale)
  pastRef.current = Boolean(record.historical)
  reducedRef.current = reducedMotion
  const celebrationStartedAt = useRef<number | null>(null)
  const cursorOwned = useRef(false)
  const [hovered, setHovered] = useState(false)
  const phase = slot * 1.7
  const uniform = districtUniform[district]
  // A reviewing agent rests ready to inspect, with one foot slightly forward.
  const legRest = record.status === 'review' && !record.stale && !reducedMotion ? 0.2 : 0

  // Status-and-slot derived timing so agents do not move in lockstep. Deriving these
  // from refs and the clock avoids any per-frame React state.
  const cadence = 1 + (slot % 4) * 0.09
  const signalPhase = slot * 0.9
  const inspectPhase = slot * 1.3

  // Never leave the shared document cursor stuck if this worker unmounts while hovered.
  useEffect(() => () => {
    if (cursorOwned.current) {
      document.body.style.cursor = 'default'
      cursorOwned.current = false
    }
  }, [])

  useFrame(({ clock }) => {
    const walkNode = walk.current
    const bodyNode = body.current
    const legs = [leftLeg.current, rightLeg.current].filter((leg): leg is THREE.Group => Boolean(leg))
    const arms = [leftArm.current, rightArm.current].filter((arm): arm is THREE.Group => Boolean(arm))
    if (!walkNode || !bodyNode || legs.length < 2 || arms.length < 2) return

    const settle = () => {
      walkNode.position.set(0, 0, 0)
      walkNode.rotation.y = 0
      bodyNode.position.set(0, 0, 0)
      bodyNode.rotation.set(0, 0, 0)
      resetLegs(legs)
      arms[0].rotation.x = 0
      arms[1].rotation.x = 0
    }
    const idle = (t: number) => {
      walkNode.position.set(0, 0, 0)
      walkNode.rotation.y = 0
      bodyNode.position.y = 0
      // A full turn over ~25s, a slow weight shift, and an occasional small shrug.
      const shrug = Math.max(0, Math.sin(t * 0.6 + phase)) ** 6
      bodyNode.rotation.set(0, Math.sin(t * 0.25 + phase) * 0.6, Math.sin(t * 0.7 + phase) * 0.02)
      resetLegs(legs)
      arms[0].rotation.x = Math.sin(t * 0.8 + phase) * 0.05
      arms[1].rotation.x = -shrug * 0.25
    }

    const stale = staleRef.current
    const stillMotion = reducedRef.current
    const past = pastRef.current

    // A celebration is bounded to one short window after completion is first seen.
    if (statusRef.current !== 'complete') celebrationStartedAt.current = null

    // Reduced motion and stale snapshots always rest in a neutral pose.
    if (stillMotion || stale) { settle(); return }

    // A non-current runtime status on a past record is demoted so nothing old reads as
    // active. A current unknown stays unknown and rests neutral; a past unknown is a real
    // past session and is allowed to loop ambiently below.
    const status: WorkerStatus = past && statusRef.current === 'active' ? 'waiting' : statusRef.current
    if (status === 'unknown' && !past) { settle(); return }

    const t = clock.elapsedTime

    if (status === 'active') {
      // Walk the closed ellipse continuously. The route passes through an arc and then
      // rests in the same arc; because the loop is closed, no frame ever snaps.
      const progress = (((t * cadence) / WALK_SECONDS) % 1 + 1) % 1
      // Ease in from the resting arc and back out so entry and exit to rest glide.
      const local = progress < ENTER_FRACTION ? progress / ENTER_FRACTION : progress > 1 - ENTER_FRACTION ? (1 - progress) / ENTER_FRACTION : 1
      const cx = -ROUTE_ENTRY_X * (1 - local)
      const cz = -ROUTE_ENTRY_Z * (1 - local)
      applyWalk(walkNode, legs, arms, progress, cx, cz)
      bodyNode.position.y = Math.abs(Math.sin(progress * Math.PI * 2 * 7)) * 0.04
      bodyNode.rotation.x = 0
      bodyNode.rotation.z = Math.sin(progress * Math.PI * 2 * 7) * 0.02
      return
    }

    if (status === 'complete') {
      // A past completion is an outcome, not a fresh event: it stays ambient instead of
      // replaying the one-shot celebration now.
      if (past) { applyAmbient(walkNode, bodyNode, legs, arms, t, phase); return }
      if (celebrationStartedAt.current === null) celebrationStartedAt.current = t
      const elapsed = t - celebrationStartedAt.current
      if (elapsed < CELEBRATION_SECONDS) {
        const decay = 1 - elapsed / CELEBRATION_SECONDS
        walkNode.position.set(0, 0, 0)
        walkNode.rotation.y = 0
        // A ground-returning hop: sin() is 0 at both ends of the window, so the figure
        // lands exactly on y=0 and flows straight into the idle pose.
        bodyNode.position.y = Math.sin((elapsed / CELEBRATION_SECONDS) * Math.PI) * 0.5 * decay
        bodyNode.rotation.z = Math.sin(elapsed * 7) * 0.08 * decay
        bodyNode.rotation.x = 0
        resetLegs(legs)
        arms[0].rotation.x = -1.4 * decay
        arms[1].rotation.x = -1.4 * decay
        return
      }
      // After the celebration window the agent keeps a calm, visibly alive idle.
      idle(t)
      return
    }

    // Any other non-current record (historical sessions, demoted past activity) loops
    // ambiently rather than standing perfectly still.
    if (past) { applyAmbient(walkNode, bodyNode, legs, arms, t, phase); return }

    if (status === 'review') {
      // Review agents inspect: a slow bend-and-rise with both arms forward.
      walkNode.position.set(0, 0, 0)
      walkNode.rotation.y = 0
      bodyNode.position.y = 0
      bodyNode.rotation.z = 0
      applyInspect(bodyNode, legs, arms, t, inspectPhase)
      return
    }

    if (status === 'needs-input' || status === 'failed') {
      // Attention agents raise a signalling arm; failed adds a slower, heavier sway.
      walkNode.position.set(0, 0, 0)
      walkNode.rotation.y = 0
      bodyNode.position.y = 0
      bodyNode.rotation.x = 0
      bodyNode.rotation.z = status === 'failed' ? Math.sin(t * 1.1 + phase) * 0.05 : 0
      resetLegs(legs)
      applySignal(arms, t, signalPhase)
      return
    }

    // Waiting agents idle in place with a gentle turn and a slight shift in weight.
    idle(t)
  })

  const orbColor = record.stale ? statusColor.unknown : statusColor[record.status]
  const label = shortActivity(record)

  return (
    <group
      position={[(slot % 3 - 1) * 1.15, 0, Math.floor(slot / 3) * 1.0 - 0.4]}
      onClick={(event) => {
        event.stopPropagation()
        // R3F computes `delta` as the pixel distance moved since pointer-down, so an
        // orbit drag never selects while a near-stationary press does.
        if (event.delta > CLICK_DRAG_TOLERANCE_PX) return
        onSelect(record.id)
      }}
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true); cursorOwned.current = true; document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHovered(false); cursorOwned.current = false; document.body.style.cursor = 'default' }}
    >
      <group ref={walk}>
        <group ref={body}>
          {/* Legs pivot at the hip so the walk cycle can swing them. A reviewing
              agent rests mid-bend; every other status rests fully upright. */}
          <group ref={leftLeg} position={[-0.14, 0.56, 0]} rotation={[legRest, 0, 0]}>
            <mesh position={[0, -0.28, 0]} castShadow>
              <boxGeometry args={[0.16, 0.56, 0.18]} />
              <meshStandardMaterial color={BOOT} roughness={0.85} />
            </mesh>
          </group>
          <group ref={rightLeg} position={[0.14, 0.56, 0]} rotation={[legRest, 0, 0]}>
            <mesh position={[0, -0.28, 0]} castShadow>
              <boxGeometry args={[0.16, 0.56, 0.18]} />
              <meshStandardMaterial color={BOOT} roughness={0.85} />
            </mesh>
          </group>

          {/* Torso, belt and shoulders wear the district's uniform colour. */}
          <mesh position={[0, 0.98, 0]} castShadow>
            <boxGeometry args={[0.44, 0.62, 0.26]} />
            <meshStandardMaterial color={uniform.coat} roughness={0.72} emissive={selected ? '#f0c879' : '#000000'} emissiveIntensity={selected ? 0.35 : 0} />
          </mesh>
          <mesh position={[0, 0.72, 0]}>
            <boxGeometry args={[0.46, 0.09, 0.28]} />
            <meshStandardMaterial color={uniform.accent} roughness={0.7} />
          </mesh>

          <group ref={leftArm} position={[-0.28, 1.2, 0]}>
            <mesh position={[0, -0.26, 0]} castShadow>
              <boxGeometry args={[0.12, 0.52, 0.12]} />
              <meshStandardMaterial color={uniform.coat} roughness={0.75} />
            </mesh>
          </group>
          <group ref={rightArm} position={[0.28, 1.2, 0]}>
            <mesh position={[0, -0.26, 0]} castShadow>
              <boxGeometry args={[0.12, 0.52, 0.12]} />
              <meshStandardMaterial color={uniform.coat} roughness={0.75} />
            </mesh>
            {/* A small held tool so the silhouette reads as a worker. */}
            <mesh position={[0, -0.54, 0.1]} castShadow>
              <boxGeometry args={[0.16, 0.16, 0.16]} />
              <meshStandardMaterial color={uniform.accent} roughness={0.6} />
            </mesh>
          </group>

          <mesh position={[0, 1.5, 0]} castShadow>
            <sphereGeometry args={[0.2, 14, 14]} />
            <meshStandardMaterial color={SKIN} roughness={0.8} />
          </mesh>
          <Headwear kind={uniform.hat} color={uniform.accent} />

          {/* Status orb keeps the status colour distinct from the district uniform. */}
          <mesh position={[0, 2.02, 0]}>
            <octahedronGeometry args={[0.12]} />
            <meshBasicMaterial color={orbColor} />
          </mesh>
        </group>
      </group>
      {/* Always mounted and faded in on hover, so moving agents never flicker the tip. */}
      <Html position={[0, 2.55, 0]} center distanceFactor={34} zIndexRange={[20, 0]} style={{ pointerEvents: 'none', opacity: hovered ? 1 : 0, transition: 'opacity 120ms ease' }}>
        <div className={`worker-tooltip ${selected ? 'is-selected' : ''} ${record.stale ? 'is-stale' : ''}`}>
          <span className="worker-tooltip-title">{record.title}<em>{record.stale ? 'Stale' : record.historical ? 'Past' : statusLabel[record.status]}</em></span>
          <span className="worker-tooltip-meta">{record.provider} · {record.model}</span>
          <span className="worker-tooltip-activity">{record.stale || record.historical ? `Last known · ${label}` : label}</span>
        </div>
      </Html>
    </group>
  )
}

function District({ id, position, records, selectedId, reducedMotion, onSelect }: {
  id: DistrictId
  position: THREE.Vector3
  records: AgentRecord[]
  selectedId?: string
  reducedMotion: boolean
  onSelect: (id: string) => void
}) {
  const meta = districtMeta[id]
  // Slots are keyed by record identity and persist while a district stays mounted, so
  // reordering, arrivals and departures never shift a surviving worker to a new slot.
  const slotsRef = useRef(new Map<string, number>())
  const slots = useMemo(() => {
    const assigned = slotsRef.current
    const present = new Set(records.map((record) => record.id))
    for (const key of Array.from(assigned.keys())) if (!present.has(key)) assigned.delete(key)
    const used = new Set(assigned.values())
    return records.map((record) => {
      const existing = assigned.get(record.id)
      if (existing !== undefined) return existing
      let slot = 0
      while (used.has(slot)) slot += 1
      assigned.set(record.id, slot)
      used.add(slot)
      return slot
    })
  }, [records])

  return (
    <group position={position}>
      {/* A quiet locator ring in the district's uniform accent. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.9, 1.08, 48]} />
        <meshBasicMaterial color={districtUniform[id].accent} transparent opacity={0.4} depthWrite={false} />
      </mesh>
      {records.map((record, index) => (
        <Worker key={record.id} record={record} district={id} slot={slots[index]} reducedMotion={reducedMotion} selected={selectedId === record.id} onSelect={onSelect} />
      ))}
      <Html position={[0, 3.0, 0]} center distanceFactor={26} style={{ pointerEvents: 'none' }}>
        <div className="world-label"><span>{meta.name}</span><small>{records.length} {records.length === 1 ? 'worker' : 'workers'}</small></div>
      </Html>
    </group>
  )
}

function VillageWorld({ records, selectedId, reducedMotion, onSelect }: {
  records: AgentRecord[]
  selectedId?: string
  reducedMotion: boolean
  onSelect: (id: string) => void
}) {
  const { scene } = useLoader(GLTFLoader, MODEL_URL, configureVillageLoader)

  // Normalize the authored map once: scale it so the seven district anchors fill a
  // legible span, then translate so the cluster sits around the origin and the lowest
  // anchor rests at y=0.
  const layout = useMemo<MapLayout>(() => {
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)

    const raw: Partial<Record<DistrictId, THREE.Vector3>> = {}
    const cluster = new THREE.Vector3()
    const clusterMin = new THREE.Vector3(Infinity, Infinity, Infinity)
    const clusterMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    let count = 0
    for (const id of Object.keys(DISTRICT_ANCHORS) as DistrictId[]) {
      const node = scene.getObjectByName(DISTRICT_ANCHORS[id])
      if (!node) continue
      const point = node.position.clone()
      raw[id] = point
      cluster.add(point)
      clusterMin.min(point)
      clusterMax.max(point)
      count += 1
    }

    let scale: number
    if (count > 0) {
      cluster.multiplyScalar(1 / count)
      const clusterSpan = Math.max(clusterMax.x - clusterMin.x, clusterMax.z - clusterMin.z) || 1
      scale = DISTRICT_SPAN_TARGET / clusterSpan
    } else {
      cluster.set(0, 0, 0)
      const size = box.getSize(new THREE.Vector3())
      scale = DISTRICT_SPAN_TARGET / (Math.max(size.x, size.z) || 1)
    }

    // Ground on the district anchors rather than the whole terrain, whose lowest point
    // can sit far below the village and would lift every marker out of frame.
    const anchorYs = Object.values(raw).filter((point): point is THREE.Vector3 => Boolean(point)).map((point) => point.y)
    const groundY = anchorYs.length > 0 ? Math.min(...anchorYs) : box.min.y

    const position = new THREE.Vector3(-cluster.x * scale, -groundY * scale, -cluster.z * scale)
    const districts = {} as Record<DistrictId, THREE.Vector3>
    for (const id of Object.keys(DISTRICT_ANCHORS) as DistrictId[]) {
      const point = raw[id] ?? new THREE.Vector3()
      // Anchor nodes sit at varying authored heights; the village ground is effectively
      // flat, so we take only x/z from the anchor and stand every marker on one plane.
      districts[id] = new THREE.Vector3(point.x * scale + position.x, 0, point.z * scale + position.z)
    }
    return { scale, position, districts }
  }, [scene])

  // The map receives the workers' shadows but does not cast its own: it is a backdrop,
  // and 187 shadow casters would cost more than it adds.
  useEffect(() => {
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = false
        mesh.receiveShadow = true
      }
    })
  }, [scene])

  const grouped = useMemo(() => (Object.keys(districtMeta) as DistrictId[]).map((id) => ({
    id,
    records: records.filter((record) => record.district === id),
  })), [records])

  return (
    <>
      <color attach="background" args={['#c2ced1']} />
      <fog attach="fog" args={['#c2ced1', 55, 130]} />
      <ambientLight intensity={0.6} color="#dfe7ea" />
      <hemisphereLight args={['#e8f1f4', '#8a8570', 0.55]} />
      <directionalLight
        castShadow
        position={[-20, 34, 24]}
        intensity={1.8}
        color="#fff2dd"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-26}
        shadow-camera-right={26}
        shadow-camera-top={26}
        shadow-camera-bottom={-26}
        shadow-camera-near={1}
        shadow-camera-far={120}
      />
      <group scale={layout.scale} position={layout.position}>
        <primitive object={scene} />
      </group>
      {grouped.map((group) => (
        <District
          key={group.id}
          id={group.id}
          position={layout.districts[group.id] ?? new THREE.Vector3()}
          records={group.records}
          selectedId={selectedId}
          reducedMotion={reducedMotion}
          onSelect={onSelect}
        />
      ))}
      <OrbitControls makeDefault enablePan={false} minDistance={12} maxDistance={72} minPolarAngle={0.35} maxPolarAngle={1.32} target={[0, 2, 0]} />
    </>
  )
}

export function WorldScene(props: { records: AgentRecord[]; selectedId?: string; reducedMotion: boolean; onSelect: (id: string) => void }) {
  return (
    <div className="world-canvas" aria-hidden="true">
      <Canvas shadows dpr={[1, 1.65]} camera={{ position: [15, 19, 32], fov: 46 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <Suspense fallback={null}><VillageWorld {...props} /></Suspense>
      </Canvas>
    </div>
  )
}
