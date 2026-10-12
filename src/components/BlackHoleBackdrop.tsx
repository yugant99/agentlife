import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Original decorative art for slice 1: a stylized distant black hole rendered as a
// visual approximation (dark center, tilted luminous ring, bent-light look). It is
// not a geodesic ray tracer and never reflects agent status, activity, or progress.
// Reads no telemetry; accepts only `reducedMotion`. One draw pass, no lights, no
// shadows, no pointer handlers, no per-frame allocations.
//
// Optional world-locked orientation (`worldLocked`, set by the city): position follows
// the camera so the sky stays behind geometry, but rotation never copies the camera, so
// orbit parallaxes. Without it the original screen-fixed sky is unchanged.
// Reduced motion pins the clock to a still frame; pause freezes phase.
const STILL_TIME = 1.7
export const SKY_STILL_TIME = STILL_TIME
const SKY_RADIUS = 400

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Pin the sky to the far plane so it always sits behind village geometry.
    gl_Position.z = gl_Position.w;
  }
`

const fragmentShader = /* glsl */ `
  varying vec3 vDir;
  uniform float uTime;
  uniform float uSize;
  uniform float uBright;
  uniform vec3 uDir;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 d = normalize(vDir);

    // Deep-space base: dark below the horizon, faint blue-violet above.
    float h = d.y * 0.5 + 0.5;
    vec3 col = mix(vec3(0.014, 0.018, 0.040), vec3(0.032, 0.048, 0.110), smoothstep(0.05, 0.95, h));
    col += vec3(0.018, 0.010, 0.042) * smoothstep(0.55, 1.0, d.y);
    col = mix(vec3(0.010, 0.013, 0.030), col, smoothstep(-0.35, 0.03, d.y));

    // Quiet upper-screen placement for the hole. Lowered and eased toward center
    // from (0.28, 0.34) so the dark center and ring sit fully inside the normal
    // viewport, subordinate above the village, with margin to the top edge. The
    // mesh follows the camera position each frame. With worldLocked it never copies the
    // camera rotation, so this direction is fixed in world space and orbit parallaxes;
    // otherwise it copies the rotation and the direction is camera-relative (original).
    vec3 C = normalize(uDir);
    float cosA = clamp(dot(d, C), -1.0, 1.0);

    float S = uSize;
    float rs = 0.055 * S;

    // Sparse dim stars, kept out of the hole's immediate glare. The mask uses cosA
    // directly (cos 0.1984 ≈ 0.9804, cos 0.0744 ≈ 0.9972) so no acos is needed here.
    vec3 gridPos = d * 160.0;
    vec3 cell = floor(gridPos);
    float sh = hash13(cell);
    float starDist = length(fract(gridPos) - 0.5);
    float starPoint = 1.0 - smoothstep(0.02, 0.10, starDist);
    float starMask = 1.0 - smoothstep(cos(0.1984 * S), cos(0.0744 * S), cosA);
    float twinkle = 0.6 + 0.4 * sin(uTime * 1.6 + sh * 43.0);
    col += vec3(0.50, 0.60, 0.80) * starPoint * step(0.986, sh) * twinkle * 0.32 * starMask;

    // Bounded detail region scaled with the effect; if S grows, the costly branch grows.
    if (cosA > cos(min(0.64 * S, 1.45))) {
      float ang = acos(cosA);
      vec3 R = normalize(cross(vec3(0.0, 1.0, 0.0), C));
      vec3 U = cross(C, R);
      vec3 off = d - C * cosA;
      float ux = dot(off, R);
      float uy = dot(off, U);

      // Cool diffuse glow around the hole.
      float glow = exp(-pow(ang / (0.30 * S), 2.0));
      col += vec3(0.10, 0.16, 0.32) * glow * 0.55 * uBright;

      // Dark central silhouette.
      float shadow = 1.0 - smoothstep(rs - 0.010 * S, rs + 0.010 * S, ang);
      col *= 1.0 - shadow * 0.96;

      // One-sided brightness (stylized beaming): the left flank runs hotter.
      float beam = 1.0 + 0.55 * (1.0 - smoothstep(-0.16 * S, 0.10 * S, ux));

      // Near-side disk: a thin bright band crossing just below the shadow.
      float frontY = (-0.052 - 0.30 * ux * ux) * S;
      float front = exp(-pow((uy - frontY) / (0.016 * S), 2.0)) * exp(-pow(ux / (0.20 * S), 2.0));

      // Far-side lensed arch: bent light arcing over the shadow.
      float archY = (0.070 + 1.4 * ux * ux) * S;
      float arch = exp(-pow((uy - archY) / (0.013 * S), 2.0)) * exp(-pow(ux / (0.17 * S), 2.0));

      // Faint lower echo of the bend, mostly swallowed by the shadow.
      float echoY = (-0.105 + 1.1 * ux * ux) * S;
      float echo = exp(-pow((uy - echoY) / (0.012 * S), 2.0)) * exp(-pow(ux / (0.15 * S), 2.0)) * 0.5;

      // Slow shimmer along the disk; frozen to STILL_TIME under reduced motion.
      float flow = 0.86 + 0.14 * sin(atan(uy - frontY, ux) * 2.0 - uTime * 0.4);

      vec3 diskWarm = vec3(1.00, 0.80, 0.55);
      vec3 diskHot = vec3(1.00, 0.93, 0.78);
      float diskLight = (front * 1.15 + arch * 0.9 + echo * 0.6) * beam * flow;
      col += mix(diskWarm, diskHot, clamp(front, 0.0, 1.0)) * (diskLight * uBright);

      // Thin photon rim kissing the shadow edge.
      float rim = exp(-pow((ang - rs) / (0.0045 * S), 2.0));
      col += vec3(0.85, 0.90, 1.0) * (rim * 0.55 * uBright);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`

export function BlackHoleBackdrop({ reducedMotion, size = 1, brightness = 1, direction = [0.18, 0.24, -1.0], paused = false, stillTime = STILL_TIME, worldLocked = false }: {
  reducedMotion: boolean
  // Optional, backward-compatible composition controls. Defaults reproduce the original
  // rendering exactly, so the main app's usage is unchanged.
  size?: number
  brightness?: number
  direction?: [number, number, number]
  paused?: boolean
  // Still pin for reduced motion: the clock holds this value instead of advancing.
  stillTime?: number
  /** City only: keep the hole fixed in world space so orbiting parallaxes. Default keeps the original screen-fixed sky. */
  worldLocked?: boolean
}) {
  const mesh = useRef<THREE.Mesh>(null)
  // Read inside the frame loop through refs so props never capture stale values.
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const stillRef = useRef(stillTime)
  stillRef.current = stillTime
  // Local clock: advances only while not paused, so Pause freezes the sky and preserves
  // phase. Reduced motion holds the still frame instead.
  const time = useRef(STILL_TIME)
  const last = useRef<number | null>(null)

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: STILL_TIME },
      uSize: { value: size },
      uBright: { value: brightness },
      uDir: { value: new THREE.Vector3(direction[0], direction[1], direction[2]).normalize() },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  }), [])

  useEffect(() => {
    material.uniforms.uSize.value = size
    material.uniforms.uBright.value = brightness
    ;(material.uniforms.uDir.value as THREE.Vector3).set(direction[0], direction[1], direction[2]).normalize()
  }, [material, size, brightness, direction])
  const geometry = useMemo(() => new THREE.SphereGeometry(SKY_RADIUS, 24, 16), [])

  useEffect(() => () => {
    material.dispose()
    geometry.dispose()
  }, [material, geometry])

  useFrame(({ camera, clock }) => {
    const node = mesh.current
    if (!node) return
    // Follow position so the sky stays behind geometry; copy rotation only when the sky
    // is not world-locked. Reuses the mesh's own vector, so no
    // per-frame allocations occur here.
    node.position.copy(camera.position)
    if (!worldLocked) node.quaternion.copy(camera.quaternion)
    const now = clock.elapsedTime
    const delta = last.current === null ? 0 : Math.max(0, now - last.current)
    last.current = now
    const still = stillRef.current
    if (reducedRef.current) {
      if (material.uniforms.uTime.value !== still) material.uniforms.uTime.value = still
      return
    }
    // Pause freezes the sky; hidden tabs skip the delta. Phase is preserved either way.
    if (pausedRef.current || (typeof document !== 'undefined' && document.hidden)) return
    time.current += Math.min(delta, 0.06)
    material.uniforms.uTime.value = time.current
  })

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      renderOrder={-1}
      frustumCulled={false}
      raycast={() => undefined}
    />
  )
}
