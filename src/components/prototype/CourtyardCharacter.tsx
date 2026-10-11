import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { CityAgent } from './agentModel'
import type { WorkerGesture } from './movement'
import { cityStatusLabel } from './scenarioBridge'

// A chunky courtyard figure with a readable silhouette: head, eyes, hands, boots,
// optional beard and cloak, plus shoulder cloth so the upper body reads at a
// distance. The parent group carries world scale (~2.2x) and heading; this component
// only poses. Poses are driven through refs inside one useFrame; the pose-ref object
// is created once and re-pointed each frame, so nothing allocates per frame and no
// React state is touched per frame. Gestures follow the live phase/toolKind
// immediately; stale figures sit and desaturate; historical figures walk out idle.

const SKIN = '#d8b48c'
const HAIR = '#9a7a52'
const BOOT = '#2a2b2f'
const METAL = '#a4abb1'
const DARK = '#1b1d21'
const GREY = '#6a6f75'

const CELEBRATION_SECONDS = 2.2
const STEP_FREQ = 7

type HatKind = 'helm' | 'hood' | 'cap'

interface CharacterLook {
  coat: string
  accent: string
  hat: HatKind
  beard: boolean
  cloak: boolean
  fur: boolean
}

const KNOWN_LOOKS: Record<string, CharacterLook> = {
  bjorn: { coat: '#5a4a3c', accent: '#e0893b', hat: 'helm', beard: true, cloak: false, fur: true },
  eirik: { coat: '#4a565e', accent: '#7fb0a8', hat: 'cap', beard: true, cloak: false, fur: false },
  sigrid: { coat: '#4a6f68', accent: '#e6d6b0', hat: 'hood', beard: false, cloak: true, fur: false },
  halvard: { coat: '#545a72', accent: '#d7d2e6', hat: 'helm', beard: true, cloak: false, fur: true },
  astrid: { coat: '#5a6a4a', accent: '#d9b05a', hat: 'hood', beard: false, cloak: true, fur: false },
}

const COATS = ['#5a4a3c', '#4a565e', '#4a6f68', '#545a72', '#5a6a4a', '#5c4a5a']
const ACCENTS = ['#e0893b', '#7fb0a8', '#e6d6b0', '#d7d2e6', '#d9b05a', '#7fd0ff']
const HATS: HatKind[] = ['helm', 'hood', 'cap']

/** Stable identity per agent id: the five principals keep their exact looks, every
 * later arrival hashes deterministically onto the same palettes. */
export function lookFor(id: string): CharacterLook {
  const native = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
  const known = KNOWN_LOOKS[native]
  if (known) return known
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0
  const pick = (n: number) => Math.abs(hash >> (n * 3)) % 100
  return {
    coat: COATS[pick(0) % COATS.length],
    accent: ACCENTS[pick(1) % ACCENTS.length],
    hat: HATS[pick(2) % HATS.length],
    beard: pick(3) % 2 === 0,
    cloak: pick(4) % 2 === 1,
    fur: pick(5) % 3 === 0,
  }
}

export function isAttention(agent: Pick<CityAgent, 'workState' | 'freshness'>): boolean {
  return agent.freshness === 'fresh' && agent.workState === 'needs-input'
}

interface PoseRefs {
  body: THREE.Group
  head: THREE.Group
  leftLeg: THREE.Group
  rightLeg: THREE.Group
  leftArm: THREE.Group
  rightArm: THREE.Group
}

function resetPose(refs: PoseRefs) {
  refs.body.position.set(0, 0, 0)
  refs.body.rotation.set(0, 0, 0)
  refs.head.rotation.set(0, 0, 0)
  refs.leftLeg.rotation.set(0, 0, 0)
  refs.rightLeg.rotation.set(0, 0, 0)
  refs.leftArm.rotation.set(0, 0, 0)
  refs.rightArm.rotation.set(0, 0, 0)
}

// A static, legible stance per gesture. Used under reduced motion so nothing loops
// but the state still reads.
function applyStill(refs: PoseRefs, gesture: WorkerGesture) {
  resetPose(refs)
  if (gesture === 'hammer') {
    refs.body.rotation.x = 0.12
    refs.head.rotation.x = 0.16
    refs.leftArm.rotation.x = -0.9
    refs.rightArm.rotation.x = -1.9
  } else if (gesture === 'scroll') {
    refs.body.rotation.x = 0.17
    refs.head.rotation.x = 0.26
    refs.leftArm.rotation.x = -0.96
    refs.rightArm.rotation.x = -0.96
  } else if (gesture === 'telescope') {
    refs.body.rotation.x = -0.1
    refs.head.rotation.x = -0.34
    refs.leftArm.rotation.x = -2.2
    refs.rightArm.rotation.x = -2.2
  } else if (gesture === 'crate') {
    refs.body.rotation.x = 0.2
    refs.head.rotation.x = 0.2
    refs.leftArm.rotation.x = -1.1
    refs.rightArm.rotation.x = -1.1
  } else if (gesture === 'banner') {
    refs.body.rotation.z = 0.03
    refs.leftArm.rotation.x = -0.14
    refs.rightArm.rotation.x = -2.05
  } else if (gesture === 'think') {
    refs.body.rotation.x = 0.06
    refs.head.rotation.x = 0.12
    refs.head.rotation.z = 0.1
    refs.leftArm.rotation.x = -0.3
    refs.rightArm.rotation.x = -2.35
  } else if (gesture === 'talk') {
    refs.head.rotation.y = 0.18
    refs.leftArm.rotation.x = -0.5
    refs.rightArm.rotation.x = -0.7
  } else if (gesture === 'sit') {
    refs.body.position.y = -0.42
    refs.leftLeg.rotation.x = -1.3
    refs.rightLeg.rotation.x = -1.3
    refs.leftArm.rotation.x = -0.2
    refs.rightArm.rotation.x = -0.2
  } else {
    refs.leftArm.rotation.x = -0.05
    refs.rightArm.rotation.x = -0.05
  }
}

function applyGesture(refs: PoseRefs, gesture: WorkerGesture, moving: boolean, t: number, phase: number) {
  applyStill(refs, gesture)
  if (gesture === 'hammer' && !moving) {
    const s = (Math.sin(t * 2.2 + phase) + 1) / 2
    refs.body.rotation.x = 0.07 + s * 0.15
    refs.body.position.y = -s * 0.02
    refs.head.rotation.x = 0.1 + s * 0.12
    refs.leftArm.rotation.x = -1.05 - s * 0.12
    refs.rightArm.rotation.x = -2.05 + s * 1.55
  } else if (gesture === 'scroll' && !moving) {
    const s = Math.sin(t * 0.9 + phase)
    refs.body.rotation.x = 0.17 + s * 0.05
    refs.head.rotation.y = Math.sin(t * 0.5 + phase) * 0.22
    refs.leftArm.rotation.x = -0.96 + s * 0.07
    refs.rightArm.rotation.x = -0.96 - s * 0.07
  } else if (gesture === 'banner' && !moving) {
    const s = Math.sin(t * 1.6 + phase)
    refs.body.rotation.z = s * 0.035
    refs.rightArm.rotation.x = -2.0 + s * 0.16
    refs.rightArm.rotation.z = s * 0.14
  } else if (gesture === 'talk' && !moving) {
    const s = Math.sin(t * 1.4 + phase)
    refs.body.rotation.y = s * 0.1
    refs.head.rotation.y = 0.18 + s * 0.12
  } else if (gesture === 'sit' && !moving) {
    const s = Math.sin(t * 0.6 + phase)
    refs.body.position.y = -0.42 + s * 0.012
    refs.head.rotation.y = s * 0.18
  } else if (!moving) {
    const s = Math.sin(t * 0.6 + phase)
    refs.body.rotation.y = s * 0.12
    refs.body.position.y = Math.sin(t * 1.1 + phase) * 0.012
    refs.head.rotation.y = s * 0.22
    refs.leftArm.rotation.x += s * 0.03
    refs.rightArm.rotation.x += -s * 0.03
  }
  if (moving && gesture !== 'sit') {
    // Walk the polyline: legs swing, boots lift, arms counter-swing unless they are
    // holding a tool pose overhead (hammer/telescope/crate/banner keep the arms).
    const swing = Math.sin(t * STEP_FREQ + phase)
    refs.leftLeg.rotation.x = swing * 0.55
    refs.rightLeg.rotation.x = -swing * 0.55
    refs.body.position.y = Math.abs(Math.sin(t * STEP_FREQ + phase)) * 0.05
    refs.body.rotation.x += 0.06
    if (gesture === 'idle' || gesture === 'scroll' || gesture === 'talk' || gesture === 'think') {
      refs.leftArm.rotation.x = -swing * 0.4 - 0.1
      refs.rightArm.rotation.x = swing * 0.4 - 0.1
    }
  }
}

function applyCelebration(refs: PoseRefs, elapsed: number) {
  resetPose(refs)
  const progress = Math.min(1, elapsed / CELEBRATION_SECONDS)
  const decay = 1 - progress
  refs.body.position.y = Math.sin(progress * Math.PI) * 0.42 * decay
  refs.body.rotation.z = Math.sin(elapsed * 9) * 0.06 * decay
  refs.head.rotation.x = -0.14 * decay
  const lift = -1.5 - Math.sin(progress * Math.PI) * 0.55
  refs.leftArm.rotation.x = lift
  refs.rightArm.rotation.x = lift
}

function Headwear({ kind, color }: { kind: HatKind; color: string }) {
  if (kind === 'helm') {
    return (
      <group>
        <mesh position={[0, 0.15, 0]} castShadow>
          <sphereGeometry args={[0.26, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
          <meshStandardMaterial color={color} roughness={0.45} metalness={0.35} />
        </mesh>
        <mesh position={[0, 0.03, 0.24]}>
          <boxGeometry args={[0.06, 0.19, 0.05]} />
          <meshStandardMaterial color={color} roughness={0.45} metalness={0.35} />
        </mesh>
      </group>
    )
  }
  if (kind === 'hood') {
    return (
      <mesh position={[0, 0.13, -0.02]} castShadow>
        <coneGeometry args={[0.31, 0.52, 10]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
    )
  }
  return (
    <group>
      <mesh position={[0, 0.17, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.17, 14]} />
        <meshStandardMaterial color={color} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.06, 0]} castShadow>
        <boxGeometry args={[0.54, 0.05, 0.54]} />
        <meshStandardMaterial color={color} roughness={0.75} />
      </mesh>
    </group>
  )
}

// The held prop follows the live gesture, not the agent: hammer (shell/edit),
// scroll (read/search), telescope (test/web), crate (ship), banner (delegate).
function HeldProp({ gesture, accent }: { gesture: WorkerGesture; accent: string }) {
  if (gesture === 'hammer') {
    return (
      <group position={[0, -0.52, 0.06]}>
        <mesh castShadow>
          <boxGeometry args={[0.06, 0.52, 0.06]} />
          <meshStandardMaterial color="#6b4f33" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.26, 0]} castShadow>
          <boxGeometry args={[0.09, 0.16, 0.26]} />
          <meshStandardMaterial color={METAL} roughness={0.4} metalness={0.6} />
        </mesh>
      </group>
    )
  }
  if (gesture === 'telescope') {
    return (
      <group position={[0, -0.5, 0.14]} rotation={[-0.5, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.055, 0.075, 0.62, 10]} />
          <meshStandardMaterial color={METAL} roughness={0.35} metalness={0.6} />
        </mesh>
        <mesh position={[0, 0.34, 0]}>
          <cylinderGeometry args={[0.085, 0.085, 0.1, 10]} />
          <meshStandardMaterial color={accent} roughness={0.5} metalness={0.3} />
        </mesh>
      </group>
    )
  }
  if (gesture === 'crate') {
    return (
      <mesh position={[-0.3, -0.52, 0.3]} castShadow>
        <boxGeometry args={[0.52, 0.4, 0.4]} />
        <meshStandardMaterial color="#6b4f33" roughness={0.9} />
      </mesh>
    )
  }
  if (gesture === 'banner') {
    return (
      <group position={[0, -0.28, 0.06]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.035, 0.035, 1.3, 8]} />
          <meshStandardMaterial color="#5a4228" roughness={0.9} />
        </mesh>
        <mesh position={[0.2, 0.36, 0]} castShadow>
          <boxGeometry args={[0.38, 0.52, 0.03]} />
          <meshStandardMaterial color={accent} roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
      </group>
    )
  }
  if (gesture === 'scroll') {
    return (
      <mesh position={[0, -0.5, 0.07]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.36, 10]} />
        <meshStandardMaterial color={accent} roughness={0.8} />
      </mesh>
    )
  }
  return null
}

export interface CourtyardCharacterProps {
  agent: CityAgent
  gesture: WorkerGesture
  /** True while the frame loop walks a polyline: legs swing, heading leads. */
  moving: boolean
  index: number
  /** The id of the latest celebration that names this agent, if any. */
  celebrationId?: number
  paused: boolean
  reducedMotion: boolean
  selected: boolean
  /** Stale agents desaturate (seated pose comes through the `sit` gesture). */
  dimmed: boolean
  onSelect: (id: string) => void
}

export function CourtyardCharacter({ agent, gesture, moving, index, celebrationId, paused, reducedMotion, selected, dimmed, onSelect }: CourtyardCharacterProps) {
  const body = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const leftLeg = useRef<THREE.Group>(null)
  const rightLeg = useRef<THREE.Group>(null)
  const leftArm = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Group>(null)
  const glow = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  // Pose inputs are read through refs inside useFrame so a HUD re-render can never
  // capture a stale value mid-animation.
  const gestureRef = useRef(gesture)
  gestureRef.current = gesture
  const movingRef = useRef(moving)
  movingRef.current = moving
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  // Celebration plumbing. A new celebration id is queued once; the frame loop starts its
  // clock and plays one bounded window. Re-renders, late frames and reloads cannot
  // retrigger it, and the baseline completed agent has no celebration at all.
  const lastHandled = useRef<number | undefined>(undefined)
  const queued = useRef<number | null>(null)
  const start = useRef<number | null>(null)
  useEffect(() => {
    if (celebrationId === undefined) {
      lastHandled.current = undefined
      queued.current = null
      start.current = null
      return
    }
    if (lastHandled.current === celebrationId) return
    lastHandled.current = celebrationId
    queued.current = celebrationId
    start.current = null
  }, [celebrationId])

  const phase = index * 1.7
  // A local animation clock that only advances while the scenario is running. Pausing
  // freezes it (poses hold and a mid-flight celebration resumes correctly); reduced
  // motion settles to a still pose without playing. No React state per frame.
  const animTime = useRef(0)
  const lastElapsed = useRef<number | null>(null)
  // Pose-ref object is created once and re-pointed each frame: no per-frame allocation.
  const poseRefs = useRef<PoseRefs | null>(null)

  useFrame(({ clock }) => {
    const bodyNode = body.current
    const headNode = head.current
    const ll = leftLeg.current
    const rl = rightLeg.current
    const la = leftArm.current
    const ra = rightArm.current
    if (!bodyNode || !headNode || !ll || !rl || !la || !ra) return
    const refs = poseRefs.current ?? (poseRefs.current = { body: bodyNode, head: headNode, leftLeg: ll, rightLeg: rl, leftArm: la, rightArm: ra })
    refs.body = bodyNode
    refs.head = headNode
    refs.leftLeg = ll
    refs.rightLeg = rl
    refs.leftArm = la
    refs.rightArm = ra

    const now = clock.elapsedTime
    const delta = lastElapsed.current === null ? 0 : Math.max(0, now - lastElapsed.current)
    lastElapsed.current = now

    if (reducedRef.current) {
      // Settle without playing: a queued celebration is dropped, not left pending.
      queued.current = null
      start.current = null
      applyStill(refs, gestureRef.current)
      if (glow.current) {
        const material = glow.current.material as THREE.MeshStandardMaterial
        material.opacity = gestureRef.current === 'talk' ? 0.5 : 0
      }
      return
    }
    if (pausedRef.current) {
      // Freeze the current transforms and do not advance the local clock, so a
      // celebration in flight resumes from where it stopped when Play resumes.
      return
    }

    animTime.current += delta
    const t = animTime.current

    if (queued.current !== null) {
      if (start.current === null) start.current = t
      const elapsed = t - start.current
      if (elapsed < CELEBRATION_SECONDS) {
        applyCelebration(refs, elapsed)
        return
      }
      queued.current = null
      start.current = null
    }

    applyGesture(refs, gestureRef.current, movingRef.current, t, phase)
    // Talking carries a soft glow pulse on the chest; static under reduced motion.
    if (glow.current) {
      const material = glow.current.material as THREE.MeshStandardMaterial
      material.opacity = gestureRef.current === 'talk' ? 0.35 + 0.2 * Math.sin(t * 3 + phase) : 0
    }
  })

  const look = useMemo(() => lookFor(agent.id), [agent.id])
  // Stale figures desaturate toward grey; the seated pose arrives via `sit`.
  const coat = useMemo(() => {
    if (!dimmed) return look.coat
    return `#${new THREE.Color(look.coat).lerp(new THREE.Color(GREY), 0.55).getHexString()}`
  }, [look.coat, dimmed])
  const accent = useMemo(() => {
    if (!dimmed) return look.accent
    return `#${new THREE.Color(look.accent).lerp(new THREE.Color(GREY), 0.55).getHexString()}`
  }, [look.accent, dimmed])
  const attention = isAttention(agent)
  const showMarker = hovered || selected || attention

  return (
    <group
      onClick={(event) => {
        event.stopPropagation()
        if (event.delta > 6) return
        onSelect(agent.id)
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Forgiving invisible click target. Kept narrow so it never blocks a neighbour. */}
      <mesh position={[0, 1, 0]}>
        <boxGeometry args={[0.9, 2, 0.75]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <group ref={body}>
        <group ref={leftLeg} position={[-0.15, 0.62, 0]}>
          <mesh position={[0, -0.3, 0]} castShadow>
            <boxGeometry args={[0.17, 0.6, 0.19]} />
            <meshStandardMaterial color={coat} roughness={0.85} />
          </mesh>
          <mesh position={[0, -0.57, 0.06]} castShadow>
            <boxGeometry args={[0.2, 0.14, 0.33]} />
            <meshStandardMaterial color={BOOT} roughness={0.8} />
          </mesh>
        </group>
        <group ref={rightLeg} position={[0.15, 0.62, 0]}>
          <mesh position={[0, -0.3, 0]} castShadow>
            <boxGeometry args={[0.17, 0.6, 0.19]} />
            <meshStandardMaterial color={coat} roughness={0.85} />
          </mesh>
          <mesh position={[0, -0.57, 0.06]} castShadow>
            <boxGeometry args={[0.2, 0.14, 0.33]} />
            <meshStandardMaterial color={BOOT} roughness={0.8} />
          </mesh>
        </group>

        {look.cloak && (
          <mesh position={[0, 0.9, -0.23]} rotation={[0.13, 0, 0]} castShadow>
            <boxGeometry args={[0.6, 1.02, 0.06]} />
            <meshStandardMaterial color={accent} roughness={0.88} side={THREE.DoubleSide} />
          </mesh>
        )}

        {/* Torso, skirt and belt. A selected figure warms its tunic instead of glowing. */}
        <mesh position={[0, 1.0, 0]} castShadow>
          <boxGeometry args={[0.5, 0.68, 0.3]} />
          <meshStandardMaterial color={coat} roughness={0.72} emissive={selected ? '#f0c879' : '#000000'} emissiveIntensity={selected ? 0.3 : 0} />
        </mesh>
        <mesh position={[0, 0.66, 0]} castShadow>
          <boxGeometry args={[0.56, 0.34, 0.34]} />
          <meshStandardMaterial color={coat} roughness={0.78} />
        </mesh>
        <mesh position={[0, 0.82, 0]}>
          <boxGeometry args={[0.52, 0.1, 0.32]} />
          <meshStandardMaterial color={accent} roughness={0.7} />
        </mesh>

        {/* Soft glow pulse for talking (opacity driven in the frame loop). */}
        <mesh ref={glow} position={[0, 1.05, 0.2]} visible={gesture === 'talk'}>
          <sphereGeometry args={[0.12, 10, 8]} />
          <meshStandardMaterial color="#7fd0ff" emissive="#7fd0ff" emissiveIntensity={1.4} transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* Shoulder cloth gives the upper body a readable silhouette from overview. */}
        <mesh position={[-0.31, 1.28, 0]} castShadow>
          <boxGeometry args={[0.22, 0.14, 0.32]} />
          <meshStandardMaterial color={accent} roughness={0.8} />
        </mesh>
        <mesh position={[0.31, 1.28, 0]} castShadow>
          <boxGeometry args={[0.22, 0.14, 0.32]} />
          <meshStandardMaterial color={accent} roughness={0.8} />
        </mesh>

        {look.fur && (
          <mesh position={[0, 1.34, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.23, 0.085, 5, 12]} />
            <meshStandardMaterial color={HAIR} roughness={0.95} />
          </mesh>
        )}

        <group ref={leftArm} position={[-0.3, 1.18, 0]}>
          <mesh position={[0, -0.26, 0]} castShadow>
            <boxGeometry args={[0.13, 0.52, 0.13]} />
            <meshStandardMaterial color={coat} roughness={0.75} />
          </mesh>
          <mesh position={[0, -0.53, 0.02]}>
            <boxGeometry args={[0.15, 0.15, 0.15]} />
            <meshStandardMaterial color={SKIN} roughness={0.8} />
          </mesh>
        </group>
        <group ref={rightArm} position={[0.3, 1.18, 0]}>
          <mesh position={[0, -0.26, 0]} castShadow>
            <boxGeometry args={[0.13, 0.52, 0.13]} />
            <meshStandardMaterial color={coat} roughness={0.75} />
          </mesh>
          <mesh position={[0, -0.53, 0.02]}>
            <boxGeometry args={[0.15, 0.15, 0.15]} />
            <meshStandardMaterial color={SKIN} roughness={0.8} />
          </mesh>
          <HeldProp gesture={gesture} accent={accent} />
        </group>

        <group ref={head} position={[0, 1.6, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.225, 16, 14]} />
            <meshStandardMaterial color={SKIN} roughness={0.82} />
          </mesh>
          {/* Eyes and a small nose face +z. They read as a face without animation. */}
          <mesh position={[-0.082, 0.03, 0.19]}>
            <sphereGeometry args={[0.032, 8, 8]} />
            <meshStandardMaterial color={DARK} roughness={0.4} />
          </mesh>
          <mesh position={[0.082, 0.03, 0.19]}>
            <sphereGeometry args={[0.032, 8, 8]} />
            <meshStandardMaterial color={DARK} roughness={0.4} />
          </mesh>
          <mesh position={[0, -0.03, 0.215]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.04, 0.07, 6]} />
            <meshStandardMaterial color={SKIN} roughness={0.82} />
          </mesh>
          {look.beard && (
            <mesh position={[0, -0.13, 0.13]} rotation={[0.26, 0, 0]} castShadow>
              <coneGeometry args={[0.16, 0.3, 7]} />
              <meshStandardMaterial color={HAIR} roughness={0.95} />
            </mesh>
          )}
          <Headwear kind={look.hat} color={accent} />
        </group>
      </group>

      <Html position={[0, 2.4, 0]} center zIndexRange={[2, 0]} style={{ pointerEvents: 'none', opacity: showMarker ? 1 : 0, transition: 'opacity 140ms ease' }}>
        <div className={`proto-marker ${selected ? 'is-selected' : ''} ${attention ? 'is-attention' : ''}`}>
          <span className="proto-marker-name">{agent.name}</span>
          <span className="proto-marker-status">{cityStatusLabel(agent)}</span>
        </div>
      </Html>
    </group>
  )
}
