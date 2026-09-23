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

// Bounded framing so workers and props read at the normal viewport (~842px wide)
// without giving up orbit/zoom. The map scale itself is untouched.
const WORKER_SCALE = 1.4
const SLOT_SPACING_X = 1.5
const SLOT_SPACING_Z = 1.5
const SLOT_ORIGIN_Z = -0.5
const MARKER_DISTANCE_FACTOR = 28
const HALL_LABEL_DISTANCE_FACTOR = 20
const HALL_LABEL_BASE_Y = 3.2
const HALL_LABEL_STAGGER = 0.3
const DEFAULT_CAMERA_POSITION: [number, number, number] = [10, 12.5, 21]
const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, 1.6, 0]

const statusColor: Record<WorkerStatus, string> = {
  active: '#cf9f5a', waiting: '#87938b', 'needs-input': '#d47f5f', review: '#75a6a0', failed: '#a8584e', complete: '#87a96f', unknown: '#69736e',
}

type HatKind = 'brim' | 'helm' | 'hood' | 'cap' | 'viking'

// Each district gets a simple, distinct Viking uniform (coat, accent, headwear) plus a
// few silhouette toggles so agents read apart without adding animation clips or
// per-agent state. `viking` is a plain dome helm with a nose guard - no horns.
const districtUniform: Record<DistrictId, { coat: string; accent: string; hat: HatKind; beard: boolean; fur: boolean; cloak: boolean }> = {
  'great-hall': { coat: '#c79a4e', accent: '#f3e3bd', hat: 'viking', beard: true, fur: true, cloak: true },
  watchtower: { coat: '#5c7f98', accent: '#dbe9f2', hat: 'helm', beard: true, fur: true, cloak: false },
  forge: { coat: '#4d423a', accent: '#e0863f', hat: 'cap', beard: true, fur: true, cloak: false },
  'proving-grounds': { coat: '#5f9d92', accent: '#e8f4f1', hat: 'cap', beard: false, fur: false, cloak: false },
  'scribe-hall': { coat: '#5b6aa0', accent: '#e4e9f6', hat: 'hood', beard: false, fur: false, cloak: true },
  oracle: { coat: '#7e6aab', accent: '#efe8ff', hat: 'hood', beard: true, fur: false, cloak: true },
  dock: { coat: '#8b6a49', accent: '#ecdbc4', hat: 'brim', beard: false, fur: true, cloak: true },
}

const SKIN = '#c8a47a'
const BOOT = '#2f3338'
const BEARD = '#9a7b55'
const WOOD = '#6b4f33'
const WOOD_LIGHT = '#8a6a45'
const IRON = '#8d949b'
const WATER = '#3d6f86'

// --- Chores ------------------------------------------------------------------
// Three bounded vignettes. At most one worker is staged at each, so there is one
// shared prop set per chore and never a duplicated station prop per worker. This is
// decorative staging only: it never mutates a record, and a staged past/unknown
// worker keeps its Past/Unknown label and its exclusion from active counts.
type ChoreKind = 'woodcutting' | 'water' | 'cooking'
const CHORE_KINDS: ChoreKind[] = ['woodcutting', 'water', 'cooking']
const CHORE_DISTRICT: Record<ChoreKind, DistrictId> = {
  woodcutting: 'forge',
  water: 'dock',
  cooking: 'great-hall',
}

/**
 * Deterministic, bounded chore staffing. Each chore has an intended district - wood at
 * the Forge, water at the Dock, cooking at the Great Hall - and is staffed from that
 * district whenever it has any eligible non-stale worker, so props land in a believable
 * place instead of at random. Within the district, active workers are preferred, then
 * past/unknown ones. Only when the intended district has no eligible worker does the
 * chore fall back to any other non-stale record. Stale snapshots are never staffed.
 */
function assignChores(records: AgentRecord[]): Map<string, ChoreKind> {
  const assigned = new Map<string, ChoreKind>()
  const used = new Set<string>()
  const rank = (record: AgentRecord) => (record.status === 'active' ? 0 : 1)
  const byId = (a: AgentRecord, b: AgentRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  for (const kind of CHORE_KINDS) {
    const eligible = records.filter((record) => !record.stale && !used.has(record.id))
    if (eligible.length === 0) continue
    const inDistrict = eligible.filter((record) => record.district === CHORE_DISTRICT[kind])
    const pool = inDistrict.length > 0 ? inDistrict : eligible
    pool.sort((a, b) => rank(a) - rank(b) || byId(a, b))
    const pick = pool[0]
    assigned.set(pick.id, kind)
    used.add(pick.id)
  }
  return assigned
}

// --- Hover marker text -------------------------------------------------------
const NAME_MAX = 14
const TASK_MAX = 30
// Connector/boilerplate text that carries no task meaning. Bare connector words must
// match the whole string, so a real sentence like "Running the migration" stays
// meaningful; live connector phrases are matched by prefix because the adapters append
// detail after them ("Persisted thread found ...", "Codex runtime reports ...").
const GENERIC_TEXT_EXACT = /^(running|idle|active|waiting( for (input|a human decision))?|no activity|unknown|n\/a|unavailable|not reported|connected|disconnected|ready|done|complete[d]?|failed|needs input|in review|thinking|working|standing by|queued|status unavailable|no title)[\s.!·-]*$/i
const GENERIC_TEXT_PREFIX = /^(persisted (thread found|thread|metadata|session|state)|codex runtime reports|thread found|session found)\b/i

function isGenericText(value: string) {
  const text = collapse(value)
  return GENERIC_TEXT_EXACT.test(text) || GENERIC_TEXT_PREFIX.test(text)
}

// Model tokens that describe format/version rather than a name.
const MODEL_GENERIC_TOKENS = new Set(['gpt', 'model', 'chat', 'instruct', 'preview', 'latest', 'turbo', 'flash', 'mini', 'nano', 'pro', 'plus', 'max', 'base', 'v', 'alpha', 'beta', 'builder', 'human', 'unavailable'])
const MODEL_BRANDS: Record<string, string> = {
  deepseek: 'DeepSeek', opencode: 'OpenCode', codex: 'Codex', gpt: 'GPT', grok: 'Grok',
  claude: 'Claude', llama: 'Llama', mistral: 'Mistral', qwen: 'Qwen', gemini: 'Gemini',
}
const PROVIDER_LABEL: Record<AgentRecord['provider'], string> = { codex: 'Codex', opencode: 'OpenCode', manual: 'Manual' }

function collapse(value: string) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function abbreviate(value: string, max: number) {
  const text = collapse(value)
  if (text.length <= max) return text
  const clipped = text.slice(0, max)
  const lastSpace = clipped.lastIndexOf(' ')
  const base = lastSpace > max * 0.5 ? clipped.slice(0, lastSpace) : clipped
  return `${base.replace(/[\s.,;:·-]+$/, '')}…`
}

/** The first name-like token of a model id: gpt-6-astra -> Astra, deepseek-v4.1-flash -> DeepSeek. */
function nameFromModel(model: string) {
  for (const token of collapse(model).split(/[/#\s._-]+/).filter(Boolean)) {
    const lower = token.toLowerCase()
    if (/^v?\d+(\.\d+)*$/.test(lower)) continue
    if (MODEL_GENERIC_TOKENS.has(lower)) continue
    return MODEL_BRANDS[lower] ?? lower.charAt(0).toUpperCase() + lower.slice(1)
  }
  return ''
}

/**
 * The model-derived agent name, or '' when the model cannot name an agent: a manual
 * provider, an explicit human/unavailable model (including ids like
 * "openai/model-unavailable"), or a model with no name-like token.
 */
function modelAgentName(record: AgentRecord) {
  if (record.provider === 'manual') return ''
  const model = collapse(record.model)
  if (!model) return ''
  const tokens = model.split(/[/#\s._-]+/).filter(Boolean).map((token) => token.toLowerCase())
  if (tokens.some((token) => token === 'unavailable' || token === 'human')) return ''
  return nameFromModel(model)
}

/**
 * A short agent name. Live adapters put the session/task title in `title`, so the name
 * comes primarily from the model id (gpt-6-astra -> Astra, grok-4.7 -> Grok,
 * deepseek-v4.1-flash -> DeepSeek, gpt-6-sol -> Sol). A manual/human or unavailable
 * model never yields a wrong model word: manual falls back to a short title, and any
 * other provider falls back to its own label (Codex / OpenCode).
 */
function shortName(record: AgentRecord) {
  const fromModel = modelAgentName(record)
  if (fromModel) return fromModel.slice(0, NAME_MAX)
  if (record.provider === 'manual') {
    const title = collapse(record.title)
    if (title && title.length <= NAME_MAX && title.split(' ').length <= 2) return title
  }
  return PROVIDER_LABEL[record.provider] ?? record.provider
}

/**
 * True when the title is just the model/agent label, optionally followed by a version
 * or a single letter (demo "Astra", "Grok 4.7", "DeepSeek A"). A real two-word task
 * title such as "Fix animation" is not a label.
 */
function isLabelTitle(record: AgentRecord) {
  const title = collapse(record.title)
  if (!title) return true
  const words = title.split(' ').filter(Boolean)
  const core = words.filter((word) => !/^v?\d+(\.\d+)*$/i.test(word) && !/^[A-Za-z]$/.test(word))
  const coreText = (core.length > 0 ? core : words).join(' ').toLowerCase()
  if (coreText === shortName(record).toLowerCase()) return true
  const modelName = modelAgentName(record).toLowerCase()
  if (modelName && coreText === modelName) return true
  // A lone word for a model we cannot name is the agent's label, not a task.
  return words.length === 1 && !modelName
}

/**
 * The abbreviated task. Any non-generic session title is preferred; when the title is
 * just the model/agent label (the demo case) the meaningful activity is used instead,
 * and connector boilerplate is skipped entirely.
 */
function shortTask(record: AgentRecord) {
  const title = collapse(record.title)
  const name = shortName(record).toLowerCase()
  if (title && !isGenericText(title) && !isLabelTitle(record)) return abbreviate(title, TASK_MAX)
  const activity = collapse(record.activity)
  if (activity && !isGenericText(activity) && activity.toLowerCase() !== name) return abbreviate(activity, TASK_MAX)
  return abbreviate(collapse(record.role ?? '') || 'At work', TASK_MAX)
}

function Headwear({ kind, color }: { kind: HatKind; color: string }) {
  if (kind === 'viking') {
    return (
      <group position={[0, 1.62, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.24, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
          <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
        </mesh>
        {/* A short nose guard - deliberately no horns. */}
        <mesh position={[0, -0.1, 0.22]}>
          <boxGeometry args={[0.06, 0.18, 0.05]} />
          <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
        </mesh>
      </group>
    )
  }
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

// Bounded, decorative motion routines. Walking, inspecting, signalling, the celebration
// hop and the chore poses are illustrative village staging only; they are never evidence
// of verified model work. Movement is past-facing for historical records and neutral for
// stale ones.
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

// --- Chore poses -------------------------------------------------------------
// The worker faces its station (+z). Each pose drives only transforms, so no
// per-frame allocation and no per-worker state.

function applyChop(walk: THREE.Group, body: THREE.Group, legs: THREE.Group[], arms: THREE.Group[], t: number, phase: number) {
  walk.position.set(0, 0, 0)
  walk.rotation.y = 0
  const s = (Math.sin(t * 2.4 + phase) + 1) / 2
  body.position.y = 0
  body.rotation.x = 0.1 + s * 0.16
  body.rotation.z = 0
  resetLegs(legs)
  arms[0].rotation.x = -1.5 + s * 1.7
  arms[1].rotation.x = -1.5 + s * 1.7
}

function applyDrawWater(walk: THREE.Group, body: THREE.Group, legs: THREE.Group[], arms: THREE.Group[], t: number, phase: number) {
  walk.position.set(0, 0, 0)
  walk.rotation.y = 0
  const s = (Math.sin(t * 1.4 + phase) + 1) / 2
  body.position.y = -s * 0.04
  body.rotation.x = 0.08 + s * 0.14
  body.rotation.z = 0
  resetLegs(legs)
  arms[0].rotation.x = -0.15
  arms[1].rotation.x = -0.2 - s * 1.0
}

function applyCook(walk: THREE.Group, body: THREE.Group, legs: THREE.Group[], arms: THREE.Group[], t: number, phase: number) {
  walk.position.set(0, 0, 0)
  walk.rotation.y = 0
  body.position.y = 0
  body.rotation.x = 0.2
  body.rotation.z = 0
  resetLegs(legs)
  arms[0].rotation.x = -0.85 + Math.sin(t * 2 + phase) * 0.22
  arms[1].rotation.x = -0.85 + Math.sin(t * 2 + phase + 0.9) * 0.22
}

// --- Chore props (one shared set per chore) ----------------------------------

function ChoppingStation() {
  return (
    <group position={[0, 0, 0.62]}>
      <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.26, 0.3, 0.44, 8]} />
        <meshStandardMaterial color={WOOD} roughness={0.9} />
      </mesh>
      {/* The log being split rests on the block. */}
      <mesh position={[0, 0.5, 0]} rotation={[0, 0.5, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, 0.58, 7]} />
        <meshStandardMaterial color={WOOD_LIGHT} roughness={0.9} />
      </mesh>
      {/* A small split-log pile beside the block. */}
      <mesh position={[0.42, 0.1, -0.08]} rotation={[0, 0.2, Math.PI / 2]} castShadow={false}>
        <cylinderGeometry args={[0.1, 0.1, 0.5, 7]} />
        <meshStandardMaterial color={WOOD_LIGHT} roughness={0.9} />
      </mesh>
    </group>
  )
}

function WaterStation() {
  return (
    <group position={[0.45, 0, 0.4]}>
      {/* A shallow timber trough. */}
      <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.72, 0.4, 0.42]} />
        <meshStandardMaterial color={WOOD} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.41, 0]}>
        <boxGeometry args={[0.6, 0.05, 0.3]} />
        <meshStandardMaterial color={WATER} roughness={0.25} metalness={0.1} />
      </mesh>
    </group>
  )
}

const SMOKE_COUNT = 5

function Fire({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current || reducedMotion) return
    const t = clock.elapsedTime
    ref.current.scale.setScalar(0.9 + Math.sin(t * 9) * 0.12)
    ref.current.rotation.y = t * 1.5
  })
  return (
    <mesh ref={ref} position={[0, 0.2, 0]}>
      <coneGeometry args={[0.16, 0.34, 7]} />
      <meshBasicMaterial color="#f0913a" transparent opacity={0.85} depthWrite={false} />
    </mesh>
  )
}

function Smoke({ reducedMotion }: { reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null)
  const phases = useMemo(() => Array.from({ length: SMOKE_COUNT }, (_, index) => index / SMOKE_COUNT), [])
  useFrame(({ clock }) => {
    const node = group.current
    if (!node || reducedMotion) return
    const t = clock.elapsedTime
    node.children.forEach((child, index) => {
      const progress = ((t * 0.25 + phases[index]) % 1 + 1) % 1
      child.position.set(Math.sin(progress * Math.PI * 2 + index) * 0.12 * progress, 0.52 + progress * 1.0, 0)
      child.scale.setScalar(0.12 + progress * 0.34)
      const material = (child as THREE.Mesh).material as THREE.Material | undefined
      if (material) material.opacity = 0.32 * (1 - progress)
    })
  })
  return (
    <group ref={group}>
      {phases.map((phase, index) => (
        <mesh key={index} position={[0, 0.52 + phase, 0]}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshBasicMaterial color="#dcdcd6" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function CookingStation({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <group position={[0, 0, 0.66]}>
      {/* A ring of hearth stones. */}
      <mesh position={[0, 0.08, 0]} receiveShadow>
        <cylinderGeometry args={[0.34, 0.4, 0.16, 7]} />
        <meshStandardMaterial color="#6f6a60" roughness={0.95} />
      </mesh>
      {/* The cauldron, a low-poly half sphere. */}
      <mesh position={[0, 0.34, 0]} castShadow>
        <sphereGeometry args={[0.28, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
        <meshStandardMaterial color="#3a3f42" metalness={0.5} roughness={0.5} />
      </mesh>
      <Fire reducedMotion={reducedMotion} />
      <Smoke reducedMotion={reducedMotion} />
    </group>
  )
}

function ChoreStation({ chore, reducedMotion }: { chore?: ChoreKind; reducedMotion: boolean }) {
  if (chore === 'woodcutting') return <ChoppingStation />
  if (chore === 'water') return <WaterStation />
  if (chore === 'cooking') return <CookingStation reducedMotion={reducedMotion} />
  return null
}

/** The prop held in the right hand: chore-specific, or a small belt tool otherwise. */
function HeldProp({ chore, accent }: { chore?: ChoreKind; accent: string }) {
  if (chore === 'woodcutting') {
    return (
      <group position={[0, -0.54, 0.08]}>
        <mesh castShadow>
          <boxGeometry args={[0.05, 0.6, 0.05]} />
          <meshStandardMaterial color={WOOD_LIGHT} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.28, 0]} castShadow>
          <boxGeometry args={[0.06, 0.16, 0.2]} />
          <meshStandardMaterial color={IRON} metalness={0.4} roughness={0.5} />
        </mesh>
      </group>
    )
  }
  if (chore === 'water') {
    return (
      <mesh position={[0, -0.6, 0.06]} castShadow={false}>
        <cylinderGeometry args={[0.1, 0.09, 0.16, 8]} />
        <meshStandardMaterial color={WOOD} roughness={0.85} />
      </mesh>
    )
  }
  if (chore === 'cooking') {
    return (
      <group position={[0, -0.54, 0.08]}>
        <mesh castShadow={false}>
          <boxGeometry args={[0.04, 0.46, 0.04]} />
          <meshStandardMaterial color={WOOD} roughness={0.9} />
        </mesh>
        <mesh position={[0, -0.26, 0.02]}>
          <sphereGeometry args={[0.06, 6, 5]} />
          <meshStandardMaterial color={IRON} metalness={0.3} roughness={0.6} />
        </mesh>
      </group>
    )
  }
  return (
    <mesh position={[0, -0.54, 0.1]} castShadow={false}>
      <boxGeometry args={[0.12, 0.12, 0.12]} />
      <meshStandardMaterial color={accent} roughness={0.6} />
    </mesh>
  )
}

interface MapLayout {
  scale: number
  position: THREE.Vector3
  districts: Record<DistrictId, THREE.Vector3>
}

function Worker({ record, district, slot, chore, reducedMotion, selected, onSelect }: {
  record: AgentRecord
  district: DistrictId
  slot: number
  chore?: ChoreKind
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
  // Status, staleness, historical age, reduced-motion and chore are read inside the frame
  // loop through refs so a telemetry refresh never captures a stale value.
  const statusRef = useRef(record.status)
  const staleRef = useRef(Boolean(record.stale))
  const pastRef = useRef(Boolean(record.historical))
  const reducedRef = useRef(reducedMotion)
  const choreRef = useRef<ChoreKind | undefined>(chore)
  statusRef.current = record.status
  staleRef.current = Boolean(record.stale)
  pastRef.current = Boolean(record.historical)
  reducedRef.current = reducedMotion
  choreRef.current = chore
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

    // A worker staged at a chore performs it regardless of its reported status, so
    // past and unknown workers visibly work too. Decorative only; the record is untouched.
    const activeChore = choreRef.current
    if (activeChore) {
      const t = clock.elapsedTime
      if (activeChore === 'woodcutting') applyChop(walkNode, bodyNode, legs, arms, t, phase)
      else if (activeChore === 'water') applyDrawWater(walkNode, bodyNode, legs, arms, t, phase)
      else applyCook(walkNode, bodyNode, legs, arms, t, phase)
      return
    }

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
      applySignal(arms, t, phase)
      return
    }

    // Waiting agents idle in place with a gentle turn and a slight shift in weight.
    idle(t)
  })

  const orbColor = record.stale ? statusColor.unknown : statusColor[record.status]

  return (
    <group
      position={[(slot % 3 - 1) * SLOT_SPACING_X, 0, Math.floor(slot / 3) * SLOT_SPACING_Z + SLOT_ORIGIN_Z]}
      scale={WORKER_SCALE}
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
          {/* Legs pivot at the hip so the walk cycle can swing them. Grounded boots sit
              at the foot of each leg. A reviewing agent rests mid-bend. */}
          <group ref={leftLeg} position={[-0.14, 0.56, 0]} rotation={[legRest, 0, 0]}>
            <mesh position={[0, -0.28, 0]} castShadow>
              <boxGeometry args={[0.16, 0.56, 0.18]} />
              <meshStandardMaterial color={BOOT} roughness={0.85} />
            </mesh>
            <mesh position={[0, -0.5, 0.05]} castShadow={false}>
              <boxGeometry args={[0.18, 0.12, 0.3]} />
              <meshStandardMaterial color={BOOT} roughness={0.85} />
            </mesh>
          </group>
          <group ref={rightLeg} position={[0.14, 0.56, 0]} rotation={[legRest, 0, 0]}>
            <mesh position={[0, -0.28, 0]} castShadow>
              <boxGeometry args={[0.16, 0.56, 0.18]} />
              <meshStandardMaterial color={BOOT} roughness={0.85} />
            </mesh>
            <mesh position={[0, -0.5, 0.05]} castShadow={false}>
              <boxGeometry args={[0.18, 0.12, 0.3]} />
              <meshStandardMaterial color={BOOT} roughness={0.85} />
            </mesh>
          </group>

          {/* A cloak panel hangs behind the shoulders. */}
          {uniform.cloak && (
            <mesh position={[0, 0.92, -0.18]} rotation={[0.12, 0, 0]} castShadow>
              <boxGeometry args={[0.54, 0.96, 0.06]} />
              <meshStandardMaterial color={uniform.accent} roughness={0.85} />
            </mesh>
          )}

          {/* Layered tunic: torso, a flared skirt over the hips, and a belt. */}
          <mesh position={[0, 0.98, 0]} castShadow>
            <boxGeometry args={[0.44, 0.62, 0.26]} />
            <meshStandardMaterial color={uniform.coat} roughness={0.72} emissive={selected ? '#f0c879' : '#000000'} emissiveIntensity={selected ? 0.35 : 0} />
          </mesh>
          <mesh position={[0, 0.66, 0]} castShadow={false}>
            <boxGeometry args={[0.5, 0.34, 0.3]} />
            <meshStandardMaterial color={uniform.coat} roughness={0.78} />
          </mesh>
          <mesh position={[0, 0.8, 0]}>
            <boxGeometry args={[0.46, 0.09, 0.28]} />
            <meshStandardMaterial color={uniform.accent} roughness={0.7} />
          </mesh>

          {/* A fur collar over the shoulders. */}
          {uniform.fur && (
            <mesh position={[0, 1.26, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow={false}>
              <torusGeometry args={[0.22, 0.08, 5, 12]} />
              <meshStandardMaterial color={BEARD} roughness={0.95} />
            </mesh>
          )}

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
            <HeldProp chore={chore} accent={uniform.accent} />
          </group>

          <mesh position={[0, 1.5, 0]} castShadow>
            <sphereGeometry args={[0.2, 14, 14]} />
            <meshStandardMaterial color={SKIN} roughness={0.8} />
          </mesh>
          {/* A beard sits under the face for the districts that wear one. */}
          {uniform.beard && (
            <mesh position={[0, 1.36, 0.13]} rotation={[0.24, 0, 0]} castShadow={false}>
              <coneGeometry args={[0.14, 0.26, 6]} />
              <meshStandardMaterial color={BEARD} roughness={0.95} />
            </mesh>
          )}
          <Headwear kind={uniform.hat} color={uniform.accent} />

          {/* Status orb keeps the status colour distinct from the district uniform. */}
          <mesh position={[0, 2.02, 0]}>
            <octahedronGeometry args={[0.12]} />
            <meshBasicMaterial color={orbColor} />
          </mesh>
        </group>
      </group>

      {/* The chore station sits on the ground beside the worker, outside the animated
          walk/body groups, so props never sway with the pose. */}
      <ChoreStation chore={chore} reducedMotion={reducedMotion} />

      {/* Always mounted and faded in on hover, so moving agents never flicker the marker.
          A tiny translucent rhombus with only the short name and abbreviated task. */}
      <Html position={[0, 2.55, 0]} center distanceFactor={MARKER_DISTANCE_FACTOR} zIndexRange={[30, 0]} style={{ pointerEvents: 'none', opacity: hovered ? 1 : 0, transition: 'opacity 120ms ease' }}>
        <div className={`worker-marker ${selected ? 'is-selected' : ''} ${record.stale ? 'is-stale' : ''} ${record.historical ? 'is-past' : ''}`}>
          <div className="worker-marker-bob">
            <span className="worker-marker-plate" aria-hidden="true" />
            <span className="worker-marker-copy">
              <span className="worker-marker-name">{shortName(record)}</span>
              <span className="worker-marker-task">{shortTask(record)}</span>
            </span>
          </div>
        </div>
      </Html>
    </group>
  )
}

function District({ id, position, records, chores, index, selectedId, reducedMotion, onSelect }: {
  id: DistrictId
  position: THREE.Vector3
  records: AgentRecord[]
  chores: Map<string, ChoreKind>
  index: number
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
        <ringGeometry args={[1.2, 1.4, 48]} />
        <meshBasicMaterial color={districtUniform[id].accent} transparent opacity={0.4} depthWrite={false} />
      </mesh>
      {records.map((record, slotIndex) => (
        <Worker key={record.id} record={record} district={id} slot={slots[slotIndex]} chore={chores.get(record.id)} reducedMotion={reducedMotion} selected={selectedId === record.id} onSelect={onSelect} />
      ))}
      {/* A bounded vertical stagger by district keeps the central hall labels apart, and
          the label sits below the worker marker in render priority. */}
      <Html position={[0, HALL_LABEL_BASE_Y + index * HALL_LABEL_STAGGER, 0]} center distanceFactor={HALL_LABEL_DISTANCE_FACTOR} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
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

  // Bounded chore staffing, recomputed per snapshot (not per frame). Non-stale past and
  // unknown workers are eligible, so the live roster still visibly does chores.
  const chores = useMemo(() => assignChores(records), [records])

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
      {grouped.map((group, index) => (
        <District
          key={group.id}
          id={group.id}
          position={layout.districts[group.id] ?? new THREE.Vector3()}
          records={group.records}
          chores={chores}
          index={index}
          selectedId={selectedId}
          reducedMotion={reducedMotion}
          onSelect={onSelect}
        />
      ))}
      <OrbitControls makeDefault enablePan={false} minDistance={9} maxDistance={60} minPolarAngle={0.35} maxPolarAngle={1.32} target={DEFAULT_CAMERA_TARGET} />
    </>
  )
}

export function WorldScene(props: { records: AgentRecord[]; selectedId?: string; reducedMotion: boolean; onSelect: (id: string) => void }) {
  return (
    <div className="world-canvas" aria-hidden="true">
      <Canvas shadows dpr={[1, 1.65]} camera={{ position: DEFAULT_CAMERA_POSITION, fov: 42 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <Suspense fallback={null}><VillageWorld {...props} /></Suspense>
      </Canvas>
    </div>
  )
}
