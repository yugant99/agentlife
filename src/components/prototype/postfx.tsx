// Threshold bloom + grade composer (Wave 3 Lane 3A). three's own add-ons only,
// no new packages. HalfFloat targets so emissives above 1.0 halate; the sky and
// lit diffuse stay under the threshold. OutputPass applies ACES once — there is
// no separate tone-mapping pass. Grain freezes while paused or under reduced
// motion. Bloom 'off' renders nothing here so R3F draws directly.

import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import {
  BLOOM_RADIUS,
  BLOOM_STRENGTH,
  BLOOM_THRESHOLD,
  bloomResolution,
  gradeParamsForState,
} from './grade'
import type { BloomMode } from './grade'

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.055 },
    uTime: { value: 0 },
  } as { [uniform: string]: THREE.IUniform },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uTime;
    varying vec2 vUv;
    float gradeHash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Gentle grade only: warm the mids a touch, tuck the shadows cool.
      c.rgb = c.rgb * vec3(1.03, 1.0, 0.97) + vec3(0.003, 0.0015, -0.0015);
      float d = distance(vUv, vec2(0.5, 0.5));
      c.rgb *= 1.0 - uVignette * smoothstep(0.32, 0.78, d);
      float g = gradeHash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 7.13);
      c.rgb += (g - 0.5) * uGrain;
      gl_FragColor = c;
    }
  `,
}

function PostFXInner({ bloom, paused, reducedMotion }: {
  bloom: BloomMode
  paused: boolean
  reducedMotion: boolean
}) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  // Tier changes move the Canvas DPR without resizing it; targets must follow.
  const dpr = useThree((state) => state.viewport.dpr)
  const entry = useRef<{ composer: EffectComposer; bloom: UnrealBloomPass; grade: ShaderPass } | null>(null)

  useEffect(() => {
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType })
    const composer = new EffectComposer(gl, target)
    const first = bloomResolution(Math.max(1, size.width), Math.max(1, size.height), bloom)
      ?? { width: 2, height: 2 }
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(first.width, first.height),
      BLOOM_STRENGTH[bloom] ?? 0,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    )
    const gradePass = new ShaderPass(GradeShader)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(bloomPass)
    composer.addPass(gradePass)
    // OutputPass stays last so ACES + sRGB apply exactly once.
    composer.addPass(new OutputPass())
    entry.current = { composer, bloom: bloomPass, grade: gradePass }
    return () => {
      entry.current = null
      bloomPass.dispose()
      ;(composer as unknown as { dispose?: () => void }).dispose?.()
      target.dispose()
    }
    // Created once per canvas; resize and tier changes apply below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera])

  useEffect(() => {
    const current = entry.current
    if (!current) return
    const grade = gradeParamsForState(paused, reducedMotion)
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = grade.exposure
    current.composer.setPixelRatio(gl.getPixelRatio())
    current.composer.setSize(Math.max(1, size.width), Math.max(1, size.height))
    // UnrealBloomPass mips at half its input size, so feed double the target:
    // 'half' stays half-res, 'quarter' lands at quarter-res.
    const scale = bloom === 'half' ? 0.5 : 0.25
    current.bloom.setSize(
      Math.max(1, Math.floor(size.width * scale * 2)),
      Math.max(1, Math.floor(size.height * scale * 2)),
    )
    current.bloom.strength = BLOOM_STRENGTH[bloom] ?? 0
    current.bloom.radius = BLOOM_RADIUS
    current.bloom.threshold = BLOOM_THRESHOLD
    current.grade.uniforms['uVignette'].value = grade.vignetteStrength
    current.grade.uniforms['uGrain'].value = grade.grainAmount
  }, [gl, scene, camera, size, dpr, bloom, paused, reducedMotion])

  // Positive priority takes over the render loop while the composer is live.
  useFrame((state) => {
    const current = entry.current
    if (!current) return
    current.grade.uniforms['uTime'].value = paused || reducedMotion ? 0.5 : state.clock.elapsedTime
    current.composer.render()
  }, 1)

  return null
}

export function PostFX({ bloom, paused, reducedMotion }: {
  bloom: BloomMode
  paused: boolean
  reducedMotion: boolean
}) {
  // 'off' (low tier): no composer, no priority subscription — R3F renders normally.
  if (bloom === 'off') return null
  return <PostFXInner bloom={bloom} paused={paused} reducedMotion={reducedMotion} />
}
