import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Stylized distant black hole (visual approximation, not a geodesic ray tracer).
// Aggregate-only telemetry: `activeCount` (fresh+active) eases glow + spin over
// >=1.5 s, `needsYouCount` > 0 runs a slow gold rim sweep. Per-agent identity
// never drives the sky. Easing freezes on pause, snaps under reduced motion;
// the still frame stays legible. Without the optional counts the aggregate
// channels sit at their original levels (brightness base, rate 1, no flare).
//
// One draw pass, no lights, no shadows, no pointer handlers, no per-frame
// allocations. World-locked orientation (`worldLocked`) keeps position-follow
// without copying camera rotation so orbit parallaxes.
const STILL_TIME = 1.7
export const SKY_STILL_TIME = STILL_TIME
/** Ease time-constant for aggregate glow/spin/flare (>=1.5 s per contract). */
export const SKY_EASE_SECONDS = 1.5
const SKY_RADIUS = 400

/** Truthful targets from the aggregate fresh-active count. Pure (no three). */
export function skyTargetsFor(activeCount: number | undefined, baseBrightness: number): { bright: number; rate: number } {
  if (activeCount === undefined || !Number.isFinite(activeCount) || activeCount <= 0) {
    return { bright: baseBrightness, rate: 1 }
  }
  const active = Math.max(0, Math.floor(activeCount))
  return {
    bright: baseBrightness * (1 + 0.06 * Math.min(active, 12)),
    rate: 1 + Math.min(active, 10) * 0.05,
  }
}

/** Flare target: 1 while someone fresh needs you, else 0. Pure. */
export function skyFlareTargetFor(needsYouCount: number | undefined): number {
  return needsYouCount !== undefined && Number.isFinite(needsYouCount) && needsYouCount > 0 ? 1 : 0
}

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
  uniform float uFlare;
  uniform float uLite;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm3(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + 11.7;
      a *= 0.5;
    }
    return v;
  }
  float fbm2(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 2; i++) {
      v += a * vnoise(p);
      p = p * 2.11 + 7.3;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);

    // Deep-space base: dark below the horizon, faint blue-violet above.
    float h = d.y * 0.5 + 0.5;
    vec3 col = mix(vec3(0.014, 0.018, 0.040), vec3(0.032, 0.048, 0.110), smoothstep(0.05, 0.95, h));
    col += vec3(0.018, 0.010, 0.042) * smoothstep(0.55, 1.0, d.y);
    col = mix(vec3(0.010, 0.013, 0.030), col, smoothstep(-0.35, 0.03, d.y));

    vec3 C = normalize(uDir);
    float cosA = clamp(dot(d, C), -1.0, 1.0);
    float S = uSize;
    float rs = 0.055 * S;

    // Horizon glow: warm amber over the harbor, faint cyan underneath.
    float hor = exp(-abs(d.y) * 7.0);
    col += vec3(0.100, 0.062, 0.030) * hor * 0.55;
    col += vec3(0.020, 0.070, 0.080) * hor * 0.22;

    // Hole mask for scenery gating (same angles as the star mask below).
    float starMask = 1.0 - smoothstep(cos(0.1984 * S), cos(0.0744 * S), cosA);

    // Milky Way band + dust lane + faint nebula (scenery; skipped in lite).
    if (uLite < 0.5) {
      vec3 bandN = normalize(vec3(0.45, 0.25, 0.86));
      float bandD = abs(dot(d, bandN));
      float mwBand = exp(-pow(bandD / 0.28, 2.0));
      float mwBreak = fbm2(d.xz / (0.35 + abs(d.y)) * 1.4 + 3.7);
      col += vec3(0.095, 0.120, 0.200) * mwBand * (0.30 + 0.70 * mwBreak) * 0.55 * starMask;
      // Dust lane: thin darkening inside the band.
      col *= 1.0 - mwBand * smoothstep(0.45, 0.75, mwBreak) * 0.25 * starMask;
      // Faint violet/teal nebula, kept out of the hole glare.
      float neb = fbm2(vec2(d.x * 2.1 + 9.0, d.z * 2.1 - d.y * 3.0));
      col += mix(vec3(0.10, 0.06, 0.20), vec3(0.04, 0.14, 0.16), neb) * 0.10 * starMask;
    }

    // Magnitude stars: faint field + rare bright sparks with a cross glint.
    vec3 gridPos = d * 160.0;
    vec3 cell = floor(gridPos);
    float sh = hash13(cell);
    float starDist = length(fract(gridPos) - 0.5);
    float starPoint = 1.0 - smoothstep(0.02, 0.10, starDist);
    float twinkle = 0.6 + 0.4 * sin(uTime * 1.6 + sh * 43.0);
    col += vec3(0.50, 0.60, 0.80) * starPoint * step(0.986, sh) * twinkle * 0.32 * starMask;
    float brightStar = step(0.9972, sh) * (1.0 - smoothstep(0.0, 0.06, starDist)) * starMask;
    // Glint spikes across the star cell (two axes of the 3D cell). Not named cross,
    // which would shadow the built-in used for the disk basis below.
    vec2 f2 = abs(fract(gridPos.xy) - 0.5);
    float glint = (1.0 - smoothstep(0.0, 0.03, f2.x)) + (1.0 - smoothstep(0.0, 0.03, f2.y));
    col += vec3(0.85, 0.90, 1.0) * brightStar * (0.7 + 0.3 * glint) * (0.7 + 0.3 * twinkle);

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

      // Doppler flank: the left side runs hotter (stylized beaming).
      float beam = 1.0 + 0.9 * (1.0 - smoothstep(-0.16 * S, 0.10 * S, ux));

      // Near-side disk band, lensed arch, and faint lower echo.
      float frontY = (-0.052 - 0.30 * ux * ux) * S;
      float front = exp(-pow((uy - frontY) / (0.016 * S), 2.0)) * exp(-pow(ux / (0.20 * S), 2.0));
      float archY = (0.070 + 1.4 * ux * ux) * S;
      float arch = exp(-pow((uy - archY) / (0.013 * S), 2.0)) * exp(-pow(ux / (0.17 * S), 2.0));
      float echoY = (-0.105 + 1.1 * ux * ux) * S;
      float echo = exp(-pow((uy - echoY) / (0.012 * S), 2.0)) * exp(-pow(ux / (0.15 * S), 2.0)) * 0.5;

      // Polar streak turbulence: 3-octave value noise, no textures.
      // Lite skips the turbulence octaves and holds a flat mid value.
      float r = ang / rs;
      float th = atan(uy - frontY, ux);
      float streak = 0.5;
      if (uLite < 0.5) {
        streak = fbm3(vec2(th * 2.2 - uTime * 0.55 * (1.5 / max(r, 0.6)), r * 5.0));
      }
      float turb = 0.45 + 0.90 * streak;

      // White-hot inner edge cooling to amber outside.
      float temp = 1.0 - smoothstep(1.0, 2.8, r);
      vec3 diskWarm = vec3(1.00, 0.62, 0.32);
      vec3 diskHot = vec3(1.00, 0.96, 0.88);
      vec3 diskCol = mix(diskWarm, diskHot, clamp(temp + front * 0.4, 0.0, 1.0));
      float diskLight = (front * 1.15 + arch * 0.9 + echo * 0.6) * beam * turb;
      col += diskCol * (diskLight * uBright);

      // Thin photon rim kissing the shadow edge.
      float rim = exp(-pow((ang - rs) / (0.0035 * S), 2.0));
      col += vec3(0.92, 0.95, 1.0) * (rim * 0.60 * uBright);

      // Slow gold rim sweep while someone fresh needs you.
      if (uFlare > 0.001) {
        float rimAng = atan(uy, ux);
        float sweep = uTime * 0.45;
        float dAng = atan(sin(rimAng - sweep), cos(rimAng - sweep));
        float band = exp(-pow(dAng / 0.55, 2.0));
        col += vec3(1.0, 0.76, 0.32) * rim * band * uFlare * 1.4;
      }
    }

    gl_FragColor = vec4(col, 1.0);
  }
`

export function BlackHoleBackdrop({ reducedMotion, size = 1, brightness = 1, direction = [0.18, 0.24, -1.0], paused = false, stillTime = STILL_TIME, worldLocked = false, activeCount, needsYouCount, detail = 'full' }: {
  reducedMotion: boolean
  size?: number
  brightness?: number
  direction?: [number, number, number]
  paused?: boolean
  stillTime?: number
  worldLocked?: boolean
  /** Aggregate fresh-active count: eases glow + spin over >=1.5 s. Undefined keeps the original still brightness. */
  activeCount?: number
  /** Aggregate fresh needs-input count: slow gold rim sweep while > 0. Undefined disables the flare. */
  needsYouCount?: number
  /** 'full' keeps the unchanged look; 'lite' skips the Milky Way and turbulence octaves. The lead wires lite on the low tier. */
  detail?: 'full' | 'lite'
}) {
  const mesh = useRef<THREE.Mesh>(null)
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const stillRef = useRef(stillTime)
  stillRef.current = stillTime
  const baseRef = useRef(brightness)
  baseRef.current = brightness
  const activeRef = useRef(activeCount)
  activeRef.current = activeCount
  const needsRef = useRef(needsYouCount)
  needsRef.current = needsYouCount
  // Eased aggregate state: refs only, never React state per frame.
  const brightRef = useRef(brightness)
  const rateRef = useRef(1)
  const flareRef = useRef(0)
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
      uFlare: { value: 0 },
      uLite: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  }), [])

  useEffect(() => {
    material.uniforms.uSize.value = size
    ;(material.uniforms.uDir.value as THREE.Vector3).set(direction[0], direction[1], direction[2]).normalize()
    material.uniforms.uLite.value = detail === 'lite' ? 1 : 0
  }, [material, size, direction, detail])
  const geometry = useMemo(() => new THREE.SphereGeometry(SKY_RADIUS, 24, 16), [])

  useEffect(() => () => {
    material.dispose()
    geometry.dispose()
  }, [material, geometry])

  useFrame(({ camera, clock }) => {
    const node = mesh.current
    if (!node) return
    node.position.copy(camera.position)
    if (!worldLocked) node.quaternion.copy(camera.quaternion)
    const still = stillRef.current
    // Aggregate targets, computed inline (no allocation) from the latest props.
    const base = baseRef.current
    const active = activeRef.current
    let targetBright = base
    let targetRate = 1
    if (active !== undefined && Number.isFinite(active) && active > 0) {
      const a = Math.max(0, Math.floor(active))
      targetBright = base * (1 + 0.06 * Math.min(a, 12))
      targetRate = 1 + Math.min(a, 10) * 0.05
    }
    const needy = needsRef.current
    const flareTarget = needy !== undefined && Number.isFinite(needy) && needy > 0 ? 1 : 0
    if (reducedRef.current) {
      // Still pin: snap to truthful levels, hold the clock.
      brightRef.current = targetBright
      rateRef.current = targetRate
      flareRef.current = flareTarget
      material.uniforms.uBright.value = brightRef.current
      material.uniforms.uFlare.value = flareRef.current
      if (material.uniforms.uTime.value !== still) material.uniforms.uTime.value = still
      last.current = clock.elapsedTime
      time.current = still
      return
    }
    // Pause freezes the sky; hidden tabs skip the delta. Phase is preserved either way.
    if (pausedRef.current || (typeof document !== 'undefined' && document.hidden)) return
    const now = clock.elapsedTime
    const prev = last.current
    const delta = prev === null ? 0 : Math.max(0, now - prev)
    last.current = now
    const k = Math.min(1, delta / SKY_EASE_SECONDS)
    if (prev === null) {
      // First frame: start at the truthful level so there is no flash.
      brightRef.current = targetBright
      rateRef.current = targetRate
      flareRef.current = flareTarget
    } else if (k > 0) {
      brightRef.current += (targetBright - brightRef.current) * k
      rateRef.current += (targetRate - rateRef.current) * k
      flareRef.current += (flareTarget - flareRef.current) * k
    }
    time.current += Math.min(delta, 0.06) * rateRef.current
    material.uniforms.uTime.value = time.current
    material.uniforms.uBright.value = brightRef.current
    material.uniforms.uFlare.value = flareRef.current
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
