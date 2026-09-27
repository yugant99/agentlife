import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Original decorative art for slice 1: a stylized distant black hole rendered as a
// visual approximation (dark center, tilted luminous ring, bent-light look). It is
// not a geodesic ray tracer and never reflects agent status, activity, or progress.
// Reads no telemetry; accepts only `reducedMotion`. One draw pass, no lights, no
// shadows, no pointer handlers, no per-frame allocations.
const STILL_TIME = 1.7
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
    // mesh copies the camera orientation each frame, so this direction is
    // screen-fixed and orbit cannot move the hole out of frame.
    vec3 C = normalize(vec3(0.18, 0.24, -1.0));
    float cosA = clamp(dot(d, C), -1.0, 1.0);

    float rs = 0.055;

    // Sparse dim stars, kept out of the hole's immediate glare. The mask uses cosA
    // directly (cos 0.1984 ≈ 0.9804, cos 0.0744 ≈ 0.9972) so no acos is needed here.
    vec3 gridPos = d * 160.0;
    vec3 cell = floor(gridPos);
    float sh = hash13(cell);
    float starDist = length(fract(gridPos) - 0.5);
    float starPoint = 1.0 - smoothstep(0.02, 0.10, starDist);
    float starMask = 1.0 - smoothstep(0.9804, 0.9972, cosA);
    float twinkle = 0.6 + 0.4 * sin(uTime * 1.6 + sh * 43.0);
    col += vec3(0.50, 0.60, 0.80) * starPoint * step(0.986, sh) * twinkle * 0.32 * starMask;

    // Bounded detail region: past ~0.64 rad (cosA < 0.80) every disk/glow/rim term
    // is below ~1% strength, so the costly acos plus the exp/atan cluster runs only
    // for near-hole pixels. Look is unchanged; still a single draw pass.
    if (cosA > 0.80) {
      float ang = acos(cosA);
      vec3 R = normalize(cross(vec3(0.0, 1.0, 0.0), C));
      vec3 U = cross(C, R);
      vec3 off = d - C * cosA;
      float ux = dot(off, R);
      float uy = dot(off, U);

      // Cool diffuse glow around the hole.
      float glow = exp(-pow(ang / 0.30, 2.0));
      col += vec3(0.10, 0.16, 0.32) * glow * 0.55;

      // Dark central silhouette.
      float shadow = 1.0 - smoothstep(rs - 0.010, rs + 0.010, ang);
      col *= 1.0 - shadow * 0.96;

      // One-sided brightness (stylized beaming): the left flank runs hotter.
      float beam = 1.0 + 0.55 * (1.0 - smoothstep(-0.16, 0.10, ux));

      // Near-side disk: a thin bright band crossing just below the shadow.
      float frontY = -0.052 - 0.30 * ux * ux;
      float front = exp(-pow((uy - frontY) / 0.016, 2.0)) * exp(-pow(ux / 0.20, 2.0));

      // Far-side lensed arch: bent light arcing over the shadow.
      float archY = 0.070 + 1.4 * ux * ux;
      float arch = exp(-pow((uy - archY) / 0.013, 2.0)) * exp(-pow(ux / 0.17, 2.0));

      // Faint lower echo of the bend, mostly swallowed by the shadow.
      float echoY = -0.105 + 1.1 * ux * ux;
      float echo = exp(-pow((uy - echoY) / 0.012, 2.0)) * exp(-pow(ux / 0.15, 2.0)) * 0.5;

      // Slow shimmer along the disk; frozen to STILL_TIME under reduced motion.
      float flow = 0.86 + 0.14 * sin(atan(uy - frontY, ux) * 2.0 - uTime * 0.4);

      vec3 diskWarm = vec3(1.00, 0.80, 0.55);
      vec3 diskHot = vec3(1.00, 0.93, 0.78);
      float diskLight = (front * 1.15 + arch * 0.9 + echo * 0.6) * beam * flow;
      col += mix(diskWarm, diskHot, clamp(front, 0.0, 1.0)) * diskLight;

      // Thin photon rim kissing the shadow edge.
      float rim = exp(-pow((ang - rs) / 0.0045, 2.0));
      col += vec3(0.85, 0.90, 1.0) * rim * 0.55;
    }

    gl_FragColor = vec4(col, 1.0);
  }
`

export function BlackHoleBackdrop({ reducedMotion }: { reducedMotion: boolean }) {
  const mesh = useRef<THREE.Mesh>(null)
  // Read inside the frame loop through a ref so the prop never captures a stale value.
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uTime: { value: STILL_TIME } },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  }), [])
  const geometry = useMemo(() => new THREE.SphereGeometry(SKY_RADIUS, 32, 24), [])

  useEffect(() => () => {
    material.dispose()
    geometry.dispose()
  }, [material, geometry])

  useFrame(({ camera, clock }) => {
    const node = mesh.current
    if (!node) return
    // Camera-relative sky: follow position and orientation so the composition holds
    // the same quiet upper-screen placement through orbit. Both copies reuse the
    // mesh's own vectors, so no per-frame allocations occur here.
    node.position.copy(camera.position)
    node.quaternion.copy(camera.quaternion)
    if (reducedRef.current) {
      if (material.uniforms.uTime.value !== STILL_TIME) material.uniforms.uTime.value = STILL_TIME
      return
    }
    // Pause animation when the tab is hidden; no per-frame allocations here.
    if (typeof document !== 'undefined' && document.hidden) return
    material.uniforms.uTime.value = clock.elapsedTime
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
