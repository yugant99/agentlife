import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Gesture, ScenarioAgent } from './scenario'
import { needsAttention, statusLabel } from './scenario'

// A chunky ~1.9-unit courtyard figure with a readable silhouette: head, eyes, hands,
// boots, optional beard and cloak, plus shoulder cloth so the upper body reads at a
// distance. Poses are driven through refs inside one useFrame; the pose-ref object is
// created once and re-pointed each frame, so nothing allocates per frame and no React
// state is touched per frame. Work gestures are only ever used by a fresh, active agent;
// stale, unknown, waiting and completed figures hold a neutral idle stance.

const SKIN = '#d8b48c'
const HAIR = '#9a7a52'
const BOOT = '#2a2b2f'
const METAL = '#a4abb1'
const DARK = '#1b1d21'

const CELEBRATION_SECONDS = 2.2

type HatKind = 'helm' | 'hood' | 'cap'
type PropKind = 'hammer' | 'tongs' | 'scroll' | 'ledger' | 'banner'

interface CharacterLook {
  coat: string
  accent: string
  hat: HatKind
  beard: boolean
  cloak: boolean
  fur: boolean
  prop: PropKind
}

// Five distinct cloth accents and props so the cast reads apart at a glance.
const LOOKS: Record<string, CharacterLook> = {
  bjorn: { coat: '#5a4a3c', accent: '#e0893b', hat: 'helm', beard: true, cloak: false, fur: true, prop: 'hammer' },
  eirik: { coat: '#4a565e', accent: '#7fb0a8', hat: 'cap', beard: true, cloak: false, fur: false, prop: 'tongs' },
  sigrid: { coat: '#4a6f68', accent: '#e6d6b0', hat: 'hood', beard: false, cloak: true, fur: false, prop: 'scroll' },
  halvard: { coat: '#545a72', accent: '#d7d2e6', hat: 'helm', beard: true, cloak: false, fur: true, prop: 'ledger' },
  astrid: { coat: '#5a6a4a', accent: '#d9b05a', hat: 'hood', beard: false, cloak: true, fur: false, prop: 'banner' },
}

const FALLBACK_LOOK: CharacterLook = { coat: '#4a4f53', accent: '#c9c3b2', hat: 'cap', beard: false, cloak: false, fur: false, prop: 'scroll' }

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

// A static, legible stance per gesture. Used under reduced motion so nothing loops but
// the state still reads.
function applyStill(refs: PoseRefs, gesture: Gesture) {
  resetPose(refs)
  if (gesture === 'hammer') {
    refs.body.rotation.x = 0.12
    refs.head.rotation.x = 0.16
    refs.leftArm.rotation.x = -0.9
    refs.rightArm.rotation.x = -1.9
  } else if (gesture === 'read') {
    refs.body.rotation.x = 0.17
    refs.head.rotation.x = 0.26
    refs.leftArm.rotation.x = -0.96
    refs.rightArm.rotation.x = -0.96
  } else if (gesture === 'flag') {
    refs.body.rotation.z = 0.03
    refs.leftArm.rotation.x = -0.14
    refs.rightArm.rotation.x = -2.05
  } else {
    refs.leftArm.rotation.x = -0.05
    refs.rightArm.rotation.x = -0.05
  }
}

function applyGesture(refs: PoseRefs, gesture: Gesture, t: number, phase: number) {
  resetPose(refs)
  if (gesture === 'hammer') {
    const s = (Math.sin(t * 2.2 + phase) + 1) / 2
    refs.body.rotation.x = 0.07 + s * 0.15
    refs.body.position.y = -s * 0.02
    refs.head.rotation.x = 0.1 + s * 0.12
    refs.leftArm.rotation.x = -1.05 - s * 0.12
    refs.rightArm.rotation.x = -2.05 + s * 1.55
  } else if (gesture === 'read') {
    const s = Math.sin(t * 0.9 + phase)
    refs.body.rotation.x = 0.17 + s * 0.05
    refs.head.rotation.x = 0.24
    refs.head.rotation.y = Math.sin(t * 0.5 + phase) * 0.22
    refs.leftArm.rotation.x = -0.96 + s * 0.07
    refs.rightArm.rotation.x = -0.96 - s * 0.07
  } else if (gesture === 'flag') {
    const s = Math.sin(t * 1.6 + phase)
    refs.body.rotation.z = s * 0.035
    refs.leftArm.rotation.x = -0.16
    refs.rightArm.rotation.x = -2.0 + s * 0.16
    refs.rightArm.rotation.z = s * 0.14
  } else {
    const s = Math.sin(t * 0.6 + phase)
    refs.body.rotation.y = s * 0.12
    refs.body.position.y = Math.sin(t * 1.1 + phase) * 0.012
    refs.head.rotation.y = s * 0.22
    refs.leftArm.rotation.x = -0.04 + s * 0.03
    refs.rightArm.rotation.x = -0.04 - s * 0.03
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

function HeldProp({ kind, accent }: { kind: PropKind; accent: string }) {
  if (kind === 'hammer') {
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
  if (kind === 'tongs') {
    return (
      <group position={[0, -0.5, 0.08]} rotation={[0.2, 0, 0]}>
        <mesh rotation={[0, 0, 0.12]} castShadow>
          <boxGeometry args={[0.04, 0.46, 0.04]} />
          <meshStandardMaterial color={METAL} roughness={0.45} metalness={0.55} />
        </mesh>
        <mesh rotation={[0, 0, -0.12]} castShadow>
          <boxGeometry args={[0.04, 0.46, 0.04]} />
          <meshStandardMaterial color={METAL} roughness={0.45} metalness={0.55} />
        </mesh>
      </group>
    )
  }
  if (kind === 'ledger') {
    return (
      <mesh position={[0, -0.52, 0.09]} castShadow>
        <boxGeometry args={[0.32, 0.4, 0.07]} />
        <meshStandardMaterial color={accent} roughness={0.7} />
      </mesh>
    )
  }
  if (kind === 'banner') {
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
  return (
    <mesh position={[0, -0.5, 0.07]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.06, 0.06, 0.36, 10]} />
      <meshStandardMaterial color={accent} roughness={0.8} />
    </mesh>
  )
}

export interface CourtyardCharacterProps {
  agent: ScenarioAgent
  gesture: Gesture
  index: number
  /** The id of the latest celebration that names this agent, if any. */
  celebrationId?: number
  paused: boolean
  reducedMotion: boolean
  selected: boolean
  onSelect: (id: string) => void
}

export function CourtyardCharacter({ agent, gesture, index, celebrationId, paused, reducedMotion, selected, onSelect }: CourtyardCharacterProps) {
  const body = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const leftLeg = useRef<THREE.Group>(null)
  const rightLeg = useRef<THREE.Group>(null)
  const leftArm = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)

  // Pose inputs are read through refs inside useFrame so a HUD re-render can never
  // capture a stale value mid-animation.
  const gestureRef = useRef(gesture)
  gestureRef.current = gesture
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

    applyGesture(refs, gestureRef.current, t, phase)
  })

  const look = LOOKS[agent.id] ?? FALLBACK_LOOK
  const attention = needsAttention(agent)
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
            <meshStandardMaterial color={look.coat} roughness={0.85} />
          </mesh>
          <mesh position={[0, -0.57, 0.06]} castShadow>
            <boxGeometry args={[0.2, 0.14, 0.33]} />
            <meshStandardMaterial color={BOOT} roughness={0.8} />
          </mesh>
        </group>
        <group ref={rightLeg} position={[0.15, 0.62, 0]}>
          <mesh position={[0, -0.3, 0]} castShadow>
            <boxGeometry args={[0.17, 0.6, 0.19]} />
            <meshStandardMaterial color={look.coat} roughness={0.85} />
          </mesh>
          <mesh position={[0, -0.57, 0.06]} castShadow>
            <boxGeometry args={[0.2, 0.14, 0.33]} />
            <meshStandardMaterial color={BOOT} roughness={0.8} />
          </mesh>
        </group>

        {look.cloak && (
          <mesh position={[0, 0.9, -0.23]} rotation={[0.13, 0, 0]} castShadow>
            <boxGeometry args={[0.6, 1.02, 0.06]} />
            <meshStandardMaterial color={look.accent} roughness={0.88} side={THREE.DoubleSide} />
          </mesh>
        )}

        {/* Torso, skirt and belt. A selected figure warms its tunic instead of glowing. */}
        <mesh position={[0, 1.0, 0]} castShadow>
          <boxGeometry args={[0.5, 0.68, 0.3]} />
          <meshStandardMaterial color={look.coat} roughness={0.72} emissive={selected ? '#f0c879' : '#000000'} emissiveIntensity={selected ? 0.3 : 0} />
        </mesh>
        <mesh position={[0, 0.66, 0]} castShadow>
          <boxGeometry args={[0.56, 0.34, 0.34]} />
          <meshStandardMaterial color={look.coat} roughness={0.78} />
        </mesh>
        <mesh position={[0, 0.82, 0]}>
          <boxGeometry args={[0.52, 0.1, 0.32]} />
          <meshStandardMaterial color={look.accent} roughness={0.7} />
        </mesh>

        {/* Shoulder cloth gives the upper body a readable silhouette from overview. */}
        <mesh position={[-0.31, 1.28, 0]} castShadow>
          <boxGeometry args={[0.22, 0.14, 0.32]} />
          <meshStandardMaterial color={look.accent} roughness={0.8} />
        </mesh>
        <mesh position={[0.31, 1.28, 0]} castShadow>
          <boxGeometry args={[0.22, 0.14, 0.32]} />
          <meshStandardMaterial color={look.accent} roughness={0.8} />
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
            <meshStandardMaterial color={look.coat} roughness={0.75} />
          </mesh>
          <mesh position={[0, -0.53, 0.02]}>
            <boxGeometry args={[0.15, 0.15, 0.15]} />
            <meshStandardMaterial color={SKIN} roughness={0.8} />
          </mesh>
        </group>
        <group ref={rightArm} position={[0.3, 1.18, 0]}>
          <mesh position={[0, -0.26, 0]} castShadow>
            <boxGeometry args={[0.13, 0.52, 0.13]} />
            <meshStandardMaterial color={look.coat} roughness={0.75} />
          </mesh>
          <mesh position={[0, -0.53, 0.02]}>
            <boxGeometry args={[0.15, 0.15, 0.15]} />
            <meshStandardMaterial color={SKIN} roughness={0.8} />
          </mesh>
          <HeldProp kind={look.prop} accent={look.accent} />
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
          <Headwear kind={look.hat} color={look.accent} />
        </group>
      </group>

      <Html position={[0, 2.4, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none', opacity: showMarker ? 1 : 0, transition: 'opacity 140ms ease' }}>
        <div className={`proto-marker ${selected ? 'is-selected' : ''} ${attention ? 'is-attention' : ''}`}>
          <span className="proto-marker-name">{agent.name}</span>
          <span className="proto-marker-status">{statusLabel(agent)}</span>
        </div>
      </Html>
    </group>
  )
}
