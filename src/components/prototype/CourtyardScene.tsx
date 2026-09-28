import { Html, Instance, Instances, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import type { ComponentRef } from 'react'
import * as THREE from 'three'
import { CourtyardCharacter } from './CourtyardCharacter'
import type { ScenarioState, StationId } from './scenario'
import { STATION_META, gestureFor } from './scenario'

// ---------------------------------------------------------------------------
// A compact, world-first command courtyard. Original procedural geometry only:
// primitives, shared materials and instanced ground detail. No external assets, no
// models, no textures, no black-hole backdrop.
//
// Composition: a raised stone courtyard sits on a broad dusk terrain, framed by a
// timber hall, pines and foreground rocks. Characters stand on the camera side of their
// props, turned 3/4 toward the view so faces read. All motion is transform-only and
// gated on reduced motion.
// ---------------------------------------------------------------------------

const STATION_IDS: StationId[] = ['forge', 'planning-table', 'signal-post']

// Stations sit slightly behind their workers (smaller z is farther from the camera).
const STATION_POSITION: Record<StationId, [number, number, number]> = {
  forge: [-5.2, 0, -1.0],
  'planning-table': [0.4, 0, 2.5],
  'signal-post': [5.6, 0, -0.4],
}

// Ground-level station plaques, shown in overview only. Anchored inside the courtyard so
// they never clip on a side edge, and away from the HUD corners.
const STATION_LABEL_POSITION: Record<StationId, [number, number, number]> = {
  forge: [-4.0, 0.5, 0.9],
  'planning-table': [0.4, 0.5, 3.8],
  'signal-post': [4.9, 0.5, 1.4],
}

// Explicit facing (radians) turns each worker 3/4 toward the camera (+x/+z) while their
// work surface sits just in front of them. Front is local +z under rotation.y.
const CHARACTER_PLACEMENT: Record<string, { position: [number, number, number]; facing: number }> = {
  bjorn: { position: [-4.4, 0, -0.6], facing: 0.34 },
  eirik: { position: [-6.1, 0, 0.3], facing: 0.6 },
  sigrid: { position: [-0.7, 0, 1.35], facing: 0.28 },
  halvard: { position: [1.6, 0, 1.35], facing: 0.44 },
  astrid: { position: [4.7, 0, 0.2], facing: 0.8 },
}

const PLATFORM_RADIUS = 8.8
const OUTER_RADIUS = 46

// Deterministic scatter, computed once at module load. No Math.random.
const EDGE_STONES = Array.from({ length: 34 }, (_, i) => {
  const a = (i / 34) * Math.PI * 2
  return {
    position: [Math.cos(a) * 8.5, 0.06, Math.sin(a) * 8.5] as [number, number, number],
    rotation: [0.06 * ((i % 3) - 1), -a, 0] as [number, number, number],
    scale: 0.38 + (i % 4) * 0.06,
  }
})

const MOSS = Array.from({ length: 26 }, (_, i) => {
  const a = i * 2.399963
  const r = 2.0 + (i % 6) * 1.0
  return {
    position: [Math.cos(a) * r, 0.09, Math.sin(a) * r * 0.9] as [number, number, number],
    rotation: [0, a, 0] as [number, number, number],
    scale: 0.4 + (i % 4) * 0.12,
  }
})

const PAVERS = Array.from({ length: 46 }, (_, i) => {
  const a = i * 2.399963
  const r = Math.sqrt((i + 0.5) / 46) * 6.4
  return {
    position: [Math.cos(a) * r * 1.12, 0.055, Math.sin(a) * r * 0.92] as [number, number, number],
    rotation: [0, ((i * 53) % 360) * (Math.PI / 180), 0] as [number, number, number],
    scale: 0.5 + (i % 3) * 0.13,
  }
})

const GRASS = Array.from({ length: 46 }, (_, i) => {
  const a = i * 2.399963 + 0.7
  const r = 9.6 + ((i * 13) % 9)
  return {
    position: [Math.cos(a) * r, -0.3, Math.sin(a) * r] as [number, number, number],
    rotation: [0, a, 0] as [number, number, number],
    scale: 0.22 + ((i * 3) % 4) * 0.06,
  }
})

const ROCKS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + 0.3
  const r = 10.6 + (i % 4) * 1.4
  return {
    position: [Math.cos(a) * r, -0.16, Math.sin(a) * r] as [number, number, number],
    rotation: [i % 2 ? 0.4 : -0.2, a, i % 3 ? 0.3 : 0] as [number, number, number],
    scale: 0.5 + (i % 4) * 0.18,
  }
})

// A short stacked-log pile beside the forge.
const FIREWOOD = Array.from({ length: 12 }, (_, i) => {
  const row = Math.floor(i / 4)
  const col = i % 4
  return {
    position: [(col - 1.5) * 0.24, 0.12 + row * 0.2, (row % 2) * 0.06] as [number, number, number],
    rotation: [0, 0, Math.PI / 2] as [number, number, number],
    scale: 0.9 + (i % 3) * 0.08,
  }
})

const TREES: { position: [number, number, number]; scale: number }[] = [
  { position: [-9.6, -0.4, -6.6], scale: 1.5 },
  { position: [9.8, -0.4, -6.2], scale: 1.35 },
  { position: [-4.4, -0.4, -12.0], scale: 1.6 },
  { position: [5.8, -0.4, -12.4], scale: 1.3 },
  { position: [-13.0, -0.4, -9.0], scale: 1.5 },
  { position: [12.4, -0.4, -8.6], scale: 1.4 },
]

const HALLS: { position: [number, number, number]; rotation: number; scale: number }[] = [
  { position: [-2.0, -0.4, -12.2], rotation: 0.08, scale: 1.2 },
  { position: [7.0, -0.4, -11.2], rotation: -0.26, scale: 0.78 },
]

// --- Camera -----------------------------------------------------------------

const FOV = 38
const CAMERA_DIR = new THREE.Vector3(0.46, 0.5, 0.74).normalize()
const OVERVIEW_TARGET = new THREE.Vector3(0, 1.45, 0)
const OVERVIEW_RADIUS = 8.6
const CAMERA_TRAVEL_SECONDS = 0.42
// Stable config objects so a HUD re-render never re-applies and resets the live camera.
const CAMERA_CONFIG: { position: [number, number, number]; fov: number } = { position: [13.3, 15.9, 21.4], fov: FOV }
const DPR_RANGE: [number, number] = [1, 1.8]
const GL_CONFIG = { antialias: true, powerPreference: 'high-performance' as const }

export interface SceneFocus {
  mode: 'overview' | 'agent'
  id?: string
}

interface MinimalControls {
  target: THREE.Vector3
  enabled: boolean
  update: () => void
}
type ControlsRef = { current: MinimalControls | null }

export interface RenderStats {
  calls: number
  triangles: number
  frameMs: number
  width: number
  height: number
  pixelRatio: number
}

function CameraRig({ focus, revision, reducedMotion, controlsRef }: {
  focus: SceneFocus
  revision: number
  reducedMotion: boolean
  controlsRef: ControlsRef
}) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const clock = useThree((state) => state.clock)
  const anim = useRef({
    active: false,
    start: 0,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
  })

  useEffect(() => {
    // Wait until the canvas has a real measured size; a 0-height frame would otherwise
    // compute a nonsensical distance and cause a visible jump.
    if (size.width <= 0 || size.height <= 0) return
    const target = new THREE.Vector3()
    let radius = OVERVIEW_RADIUS
    let pixelTarget = 90
    const placement = focus.mode === 'agent' && focus.id ? CHARACTER_PLACEMENT[focus.id] : undefined
    if (placement) {
      target.set(placement.position[0], placement.position[1] + 1.0, placement.position[2])
      radius = 2.6
      pixelTarget = 152
    } else {
      target.copy(OVERVIEW_TARGET)
    }

    const vFov = (FOV * Math.PI) / 180
    const aspect = Math.max(0.4, size.width / Math.max(1, size.height))
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
    const fit = (r: number, margin: number) => Math.max(r / Math.sin(vFov / 2), r / Math.sin(hFov / 2)) * margin
    const pixelDist = (charPx: number) => (2 * size.height) / (2 * Math.tan(vFov / 2) * charPx)
    const distance = THREE.MathUtils.clamp(Math.max(fit(radius, 1.06), pixelDist(pixelTarget)), 7, 72)

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

    const fromPos = camera.position.clone()
    const fromTarget = controls ? controls.target.clone() : toTarget.clone()
    anim.current.active = true
    anim.current.start = clock.getElapsedTime()
    anim.current.fromPos.copy(fromPos)
    anim.current.toPos.copy(toPos)
    anim.current.fromTarget.copy(fromTarget)
    anim.current.toTarget.copy(toTarget)
    if (controls) controls.enabled = false
  }, [focus.mode, focus.id, revision, size.width, size.height, reducedMotion, camera, clock, controlsRef])

  useFrame(() => {
    const a = anim.current
    if (!a.active) return
    const t = Math.min(1, (clock.elapsedTime - a.start) / CAMERA_TRAVEL_SECONDS)
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

// Bounded, opt-in renderer stats. Writes into a shared sink a few times per second
// (never per frame, never into React state); the HUD samples that sink.
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

// --- Dusk sky ---------------------------------------------------------------

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w;
  }
`

// A restrained static dusk: cool zenith, warm horizon, one small soft moon and a few
// dim stars. No time uniform, so it is inherently reduced-motion safe and costs one draw.
const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 zenith = vec3(0.045, 0.070, 0.120);
    vec3 horizon = vec3(0.185, 0.150, 0.145);
    vec3 col = mix(horizon, zenith, smoothstep(0.46, 0.96, h));
    col = mix(col, vec3(0.030, 0.045, 0.070), smoothstep(0.46, 0.28, h));

    // One small moon, upper-left, with a soft halo. Never a large luminous ring.
    vec3 C = normalize(vec3(0.42, 0.36, -0.83));
    float cd = dot(d, C);
    float disc = smoothstep(0.9976, 0.9987, cd);
    float halo = exp(-pow((1.0 - cd) / 0.05, 2.0));
    col += vec3(0.55, 0.60, 0.74) * halo * 0.14;
    col += vec3(0.90, 0.92, 0.98) * disc * 0.7;

    // Sparse dim stars, kept out of the moon's immediate glare.
    vec3 g = d * 90.0;
    vec3 cell = floor(g);
    float sh = hash13(cell);
    float star = (1.0 - smoothstep(0.0, 0.12, length(fract(g) - 0.5))) * step(0.986, sh);
    col += vec3(0.6, 0.68, 0.85) * star * 0.22 * (1.0 - smoothstep(0.9980, 0.9990, cd));

    gl_FragColor = vec4(col, 1.0);
  }
`

function DuskSky() {
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  }), [])
  const geometry = useMemo(() => new THREE.SphereGeometry(200, 32, 24), [])
  useEffect(() => () => {
    material.dispose()
    geometry.dispose()
  }, [material, geometry])
  return <mesh geometry={geometry} material={material} renderOrder={-1} frustumCulled={false} raycast={() => undefined} />
}

// --- Ground and backdrop ----------------------------------------------------

function PathCobbles({ from, to, salt }: { from: [number, number]; to: [number, number]; salt: number }) {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dx, dz)
  const angle = Math.atan2(dx, dz)
  const nx = dz / length
  const nz = -dx / length
  const count = Math.max(4, Math.round(length / 0.44))
  const stones = Array.from({ length: count }, (_, i) => {
    const along = (i + 0.5) / count
    const lateral = (i % 2 === 0 ? -0.17 : 0.17) + Math.sin(i * 7.3 + salt) * 0.12
    return {
      position: [from[0] + dx * along + nx * lateral, 0.09, from[1] + dz * along + nz * lateral] as [number, number, number],
      rotation: [0, angle + Math.sin(i * 3.1 + salt) * 0.5, 0] as [number, number, number],
      scale: 0.6 + (i % 3) * 0.14,
    }
  })
  return (
    <group>
      <mesh position={[(from[0] + to[0]) / 2, 0.06, (from[1] + to[1]) / 2]} rotation={[0, angle, 0]} receiveShadow>
        <boxGeometry args={[0.62, 0.05, length]} />
        <meshStandardMaterial color="#4a4842" roughness={1} />
      </mesh>
      <Instances limit={stones.length} receiveShadow>
        <dodecahedronGeometry args={[0.18, 0]} />
        <meshStandardMaterial color="#6d6a60" roughness={1} />
        {stones.map((stone, index) => (
          <Instance key={index} position={stone.position} rotation={stone.rotation} scale={[stone.scale, stone.scale * 0.35, stone.scale]} />
        ))}
      </Instances>
    </group>
  )
}

function CourtyardGround() {
  const toneA = PAVERS.filter((_, i) => i % 2 === 0)
  const toneB = PAVERS.filter((_, i) => i % 2 === 1)
  return (
    <group>
      {/* Broad dusk terrain sits below the platform base so the courtyard reads as a
          raised slab and the platform is never cut. */}
      <mesh position={[0, -0.4, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[OUTER_RADIUS, 48]} />
        <meshStandardMaterial color="#33402f" roughness={1} />
      </mesh>
      {/* Platform base and cap are lowered so the walking surface is exactly y = 0. */}
      <mesh position={[0, -0.21, 0]} receiveShadow>
        <cylinderGeometry args={[PLATFORM_RADIUS + 0.4, PLATFORM_RADIUS + 0.9, 0.34, 20]} />
        <meshStandardMaterial color="#474d50" roughness={0.98} />
      </mesh>
      <mesh position={[0, -0.04, 0]} receiveShadow>
        <cylinderGeometry args={[PLATFORM_RADIUS, PLATFORM_RADIUS, 0.08, 20]} />
        <meshStandardMaterial color="#5b635c" roughness={1} />
      </mesh>

      {/* Irregular flagstone apron: two instanced tones, shared geometry. */}
      <Instances limit={toneA.length} receiveShadow>
        <boxGeometry args={[0.62, 0.05, 0.52]} />
        <meshStandardMaterial color="#565c58" roughness={1} />
        {toneA.map((paver, index) => (
          <Instance key={index} position={paver.position} rotation={paver.rotation} scale={[paver.scale, 1, paver.scale]} />
        ))}
      </Instances>
      <Instances limit={toneB.length} receiveShadow>
        <boxGeometry args={[0.62, 0.05, 0.52]} />
        <meshStandardMaterial color="#646a63" roughness={1} />
        {toneB.map((paver, index) => (
          <Instance key={index} position={paver.position} rotation={paver.rotation} scale={[paver.scale, 1, paver.scale]} />
        ))}
      </Instances>

      <Instances limit={EDGE_STONES.length} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.26, 0]} />
        <meshStandardMaterial color="#6a6e70" roughness={0.95} />
        {EDGE_STONES.map((stone, index) => (
          <Instance key={index} position={stone.position} rotation={stone.rotation} scale={stone.scale} />
        ))}
      </Instances>

      <Instances limit={MOSS.length}>
        <sphereGeometry args={[0.24, 6, 5]} />
        <meshStandardMaterial color="#55703f" roughness={1} />
        {MOSS.map((patch, index) => (
          <Instance key={index} position={patch.position} rotation={patch.rotation} scale={[patch.scale, patch.scale * 0.4, patch.scale]} />
        ))}
      </Instances>

      {/* Grass tufts on the outer terrain add texture and depth. */}
      <Instances limit={GRASS.length}>
        <coneGeometry args={[0.16, 0.42, 5]} />
        <meshStandardMaterial color="#40532f" roughness={1} />
        {GRASS.map((tuft, index) => (
          <Instance key={index} position={tuft.position} rotation={tuft.rotation} scale={[tuft.scale, tuft.scale * 1.6, tuft.scale]} />
        ))}
      </Instances>

      <Instances limit={ROCKS.length} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.36, 0]} />
        <meshStandardMaterial color="#555b5f" roughness={1} />
        {ROCKS.map((rock, index) => (
          <Instance key={index} position={rock.position} rotation={rock.rotation} scale={rock.scale} />
        ))}
      </Instances>

      <PathCobbles from={[-5.0, -1.0]} to={[0.4, 2.5]} salt={1.7} />
      <PathCobbles from={[0.4, 2.5]} to={[5.6, -0.4]} salt={4.2} />

      {/* Large foreground rocks frame the composition without occluding actors. */}
      <mesh position={[-7.4, -0.15, 6.6]} rotation={[0.4, 0.7, 0.2]} castShadow receiveShadow>
        <dodecahedronGeometry args={[1.7, 0]} />
        <meshStandardMaterial color="#4c5357" roughness={1} />
      </mesh>
      <mesh position={[7.9, -0.25, 6.9]} rotation={[-0.3, -0.5, 0.15]} castShadow receiveShadow>
        <dodecahedronGeometry args={[1.3, 0]} />
        <meshStandardMaterial color="#4c5357" roughness={1} />
      </mesh>
    </group>
  )
}

function PineTree({ position, scale }: { position: [number, number, number]; scale: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.2, 1.2, 6]} />
        <meshStandardMaterial color="#3a2c1d" roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.6, 0]} castShadow>
        <coneGeometry args={[1.05, 1.7, 8]} />
        <meshStandardMaterial color="#26402f" roughness={1} />
      </mesh>
      <mesh position={[0, 2.5, 0]} castShadow>
        <coneGeometry args={[0.82, 1.4, 8]} />
        <meshStandardMaterial color="#2c4a36" roughness={1} />
      </mesh>
      <mesh position={[0, 3.35, 0]} castShadow>
        <coneGeometry args={[0.56, 1.15, 8]} />
        <meshStandardMaterial color="#315139" roughness={1} />
      </mesh>
    </group>
  )
}

function TimberHall({ position, rotation, scale }: { position: [number, number, number]; rotation: number; scale: number }) {
  const roofAngle = 0.7
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <mesh position={[0, 0.2, 0]} receiveShadow>
        <boxGeometry args={[6.2, 0.4, 4.0]} />
        <meshStandardMaterial color="#2a2118" roughness={1} />
      </mesh>
      <mesh position={[0, 1.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[5.8, 2.2, 3.6]} />
        <meshStandardMaterial color="#5c4230" roughness={0.95} />
      </mesh>
      {/* Corner posts read as timber framing. */}
      {[[-2.7, 1.7], [2.7, 1.7], [-2.7, -1.7], [2.7, -1.7]].map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, 1.35, z]} castShadow>
          <boxGeometry args={[0.28, 2.7, 0.28]} />
          <meshStandardMaterial color="#3d2c1e" roughness={0.95} />
        </mesh>
      ))}
      {/* Two long thatch slabs meeting at a ridge, with overhang. */}
      <mesh position={[0, 3.0, 1.05]} rotation={[-roofAngle, 0, 0]} castShadow>
        <boxGeometry args={[6.6, 0.22, 2.5]} />
        <meshStandardMaterial color="#7a6038" roughness={1} />
      </mesh>
      <mesh position={[0, 3.0, -1.05]} rotation={[roofAngle, 0, 0]} castShadow>
        <boxGeometry args={[6.6, 0.22, 2.5]} />
        <meshStandardMaterial color="#634c31" roughness={1} />
      </mesh>
      <mesh position={[0, 3.62, 0]} castShadow>
        <boxGeometry args={[6.7, 0.2, 0.34]} />
        <meshStandardMaterial color="#2a2118" roughness={0.95} />
      </mesh>
      {/* Gable ends close the roof so the silhouette reads as a hall, not a bare box. */}
      <mesh position={[-2.9, 2.4, 0]} rotation={[0, 0, Math.PI / 4]} castShadow>
        <boxGeometry args={[1.0, 1.0, 3.4]} />
        <meshStandardMaterial color="#4a3524" roughness={0.95} />
      </mesh>
      <mesh position={[2.9, 2.4, 0]} rotation={[0, 0, Math.PI / 4]} castShadow>
        <boxGeometry args={[1.0, 1.0, 3.4]} />
        <meshStandardMaterial color="#4a3524" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.95, 1.84]}>
        <boxGeometry args={[1.0, 1.9, 0.1]} />
        <meshStandardMaterial color="#2a1d12" roughness={0.95} />
      </mesh>
      <mesh position={[-1.7, 1.4, 1.82]}>
        <boxGeometry args={[0.55, 0.55, 0.06]} />
        <meshStandardMaterial color="#e8a75a" emissive="#f0b45a" emissiveIntensity={0.55} roughness={0.6} />
      </mesh>
      <mesh position={[1.7, 1.4, 1.82]}>
        <boxGeometry args={[0.55, 0.55, 0.06]} />
        <meshStandardMaterial color="#e8a75a" emissive="#f0b45a" emissiveIntensity={0.55} roughness={0.6} />
      </mesh>
    </group>
  )
}

// --- Stations ---------------------------------------------------------------

function ForgeStation({ reducedMotion }: { reducedMotion: boolean }) {
  const flames = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const node = flames.current
    if (!node || reducedMotion) return
    const t = clock.elapsedTime
    node.children.forEach((child, index) => {
      child.scale.y = 0.85 + Math.sin(t * (6 + index * 1.6) + index) * 0.15
      child.rotation.y = t * (1.1 + index * 0.35)
    })
  })
  return (
    <group position={STATION_POSITION.forge}>
      {/* Stone hearth block with a glowing mouth and a raised hood. */}
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

      {/* Anvil on a stump, directly in front of the forge lead. */}
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

      {/* Workbench with a couple of tools. */}
      <group position={[-1.15, 0, 1.05]}>
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.1, 0.12, 0.6]} />
          <meshStandardMaterial color="#5a4228" roughness={0.9} />
        </mesh>
        <mesh position={[-0.45, 0.25, 0]} castShadow>
          <boxGeometry args={[0.1, 0.5, 0.1]} />
          <meshStandardMaterial color="#463320" roughness={0.95} />
        </mesh>
        <mesh position={[0.45, 0.25, 0]} castShadow>
          <boxGeometry args={[0.1, 0.5, 0.1]} />
          <meshStandardMaterial color="#463320" roughness={0.95} />
        </mesh>
        <mesh position={[0.1, 0.6, 0]} rotation={[0, 0.3, 0]}>
          <boxGeometry args={[0.06, 0.5, 0.06]} />
          <meshStandardMaterial color="#6b4f33" roughness={0.9} />
        </mesh>
      </group>

      <Instances limit={FIREWOOD.length} position={[-1.95, 0, 0.2]} castShadow>
        <cylinderGeometry args={[0.11, 0.11, 0.5, 7]} />
        <meshStandardMaterial color="#5a4228" roughness={0.95} />
        {FIREWOOD.map((log, index) => (
          <Instance key={index} position={log.position} rotation={log.rotation} scale={log.scale} />
        ))}
      </Instances>

      <pointLight position={[0.4, 1.0, 0.9]} color="#ff8a3c" intensity={7} distance={7} decay={2} />
    </group>
  )
}

function PlanningTable({ reducedMotion }: { reducedMotion: boolean }) {
  const candle = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const node = candle.current
    if (!node || reducedMotion) return
    const material = node.material as THREE.MeshStandardMaterial
    material.emissiveIntensity = 0.9 + Math.sin(clock.elapsedTime * 6) * 0.18
  })
  return (
    <group position={STATION_POSITION['planning-table']}>
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
      {/* Parchment map with raised edges and loose map pieces. */}
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
      {/* Two candles supply the warm practical. */}
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
      <pointLight position={[-1.1, 1.35, -0.45]} color="#ffb85c" intensity={3.6} distance={5} decay={2} />
      {/* A bench and a stool on the worker side. */}
      <mesh position={[-2.1, 0.26, 1.5]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.16, 0.42]} />
        <meshStandardMaterial color="#4a3524" roughness={0.95} />
      </mesh>
      <mesh position={[2.05, 0.26, 1.6]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.52, 10]} />
        <meshStandardMaterial color="#4a3524" roughness={0.95} />
      </mesh>
    </group>
  )
}

function SignalPost({ reducedMotion }: { reducedMotion: boolean }) {
  const banner = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const node = banner.current
    if (!node || reducedMotion) return
    const t = clock.elapsedTime
    node.rotation.z = Math.sin(t * 0.8) * 0.05
    node.rotation.x = Math.sin(t * 0.6 + 1) * 0.03
  })
  return (
    <group position={STATION_POSITION['signal-post']}>
      <mesh position={[0, 2.5, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.15, 5.0, 8]} />
        <meshStandardMaterial color="#5a4228" roughness={0.95} />
      </mesh>
      <mesh position={[0, 4.3, 0]} castShadow>
        <boxGeometry args={[1.9, 0.16, 0.16]} />
        <meshStandardMaterial color="#5a4228" roughness={0.95} />
      </mesh>
      <mesh position={[0, 3.9, 0]} castShadow>
        <boxGeometry args={[1.4, 0.12, 0.12]} />
        <meshStandardMaterial color="#4a3524" roughness={0.95} />
      </mesh>
      {/* Cloth banner and accent pennant. */}
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
      {/* Crate base and a warm brazier at the watch point. */}
      <mesh position={[-0.7, 0.32, 0.4]} castShadow receiveShadow>
        <boxGeometry args={[0.78, 0.64, 0.78]} />
        <meshStandardMaterial color="#4a3524" roughness={0.95} />
      </mesh>
      <mesh position={[-0.7, 0.72, 0.4]} rotation={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[0.62, 0.6, 0.62]} />
        <meshStandardMaterial color="#553d28" roughness={0.95} />
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
        <pointLight position={[0, 0.85, 0]} color="#ff9b47" intensity={4} distance={5.5} decay={2} />
      </group>
    </group>
  )
}

function StationLabel({ id }: { id: StationId }) {
  const meta = STATION_META[id]
  return (
    <Html position={STATION_LABEL_POSITION[id]} center zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
      <div className="proto-station-label">
        <span>{meta.name}</span>
        <small>{meta.caption}</small>
      </div>
    </Html>
  )
}

// --- World ------------------------------------------------------------------

function CourtyardWorld({ state, selectedId, focus, focusRevision, paused, reducedMotion, showStats, statsSink, onSelect, onReady }: {
  state: ScenarioState
  selectedId?: string
  focus: SceneFocus
  focusRevision: number
  paused: boolean
  reducedMotion: boolean
  showStats: boolean
  statsSink: { current: RenderStats }
  onSelect: (id: string) => void
  onReady: () => void
}) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)

  const latestCelebration = useMemo(() => {
    const map = new Map<string, number>()
    for (const celebration of state.celebrations) map.set(celebration.agentId, celebration.id)
    return map
  }, [state.celebrations])

  useEffect(() => {
    onReady()
  }, [onReady])

  return (
    <>
      <color attach="background" args={['#0b131c']} />
      <fog attach="fog" args={['#1c2732', 34, 82]} />

      {/* Warm readable key from the camera side lights faces; cool fill and sky bounce
          keep the miniature lit rather than a black silhouette. */}
      <ambientLight intensity={0.6} color="#c9d4d6" />
      <hemisphereLight args={['#bcd0e2', '#6b6152', 0.75]} />
      <directionalLight
        castShadow
        position={[13, 19, 15]}
        intensity={2.0}
        color="#ffd9a6"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-bias={-0.0005}
      />

      <DuskSky />

      <CourtyardGround />
      {HALLS.map((hall, index) => <TimberHall key={index} {...hall} />)}
      {TREES.map((tree, index) => <PineTree key={index} {...tree} />)}

      <ForgeStation reducedMotion={reducedMotion} />
      <PlanningTable reducedMotion={reducedMotion} />
      <SignalPost reducedMotion={reducedMotion} />
      {/* Station names are overview-only; in focus the inspector carries the station. */}
      {focus.mode === 'overview' && STATION_IDS.map((id) => <StationLabel key={id} id={id} />)}

      {state.agents.map((agent, index) => {
        const placement = CHARACTER_PLACEMENT[agent.id]
        if (!placement) return null
        return (
          <group key={agent.id} position={placement.position} rotation={[0, placement.facing, 0]}>
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

      <CameraRig focus={focus} revision={focusRevision} reducedMotion={reducedMotion} controlsRef={controlsRef} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan={false}
        enableDamping
        minDistance={7}
        maxDistance={72}
        minPolarAngle={0.3}
        maxPolarAngle={1.35}
      />
      <StatsReporter sink={statsSink} enabled={showStats} />
    </>
  )
}

export interface CourtyardSceneProps {
  state: ScenarioState
  selectedId?: string
  focus: SceneFocus
  focusRevision: number
  paused: boolean
  reducedMotion: boolean
  showStats: boolean
  statsSink: { current: RenderStats }
  onSelect: (id: string) => void
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
            <p>3D courtyard unavailable.</p>
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
