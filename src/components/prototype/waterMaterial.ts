// Jade-mirror water material (Wave 2 Lane 2B). A fog-aware ShaderMaterial with
// two scrolled procedural normal octaves, a small world-space swell, foam seams
// at the sheet edges plus pier rings, and the needs-you beam as an amber pillar.
// No Reflector, Water.js or SSR. Time is pinned by the caller while paused or
// under reduced motion; the shader only reads uTime.

import * as THREE from 'three'

export const STILL_TIME = 1.7
export const WATER_SWELL = 0.15

export interface JadeWaterMaterial extends THREE.ShaderMaterial {
  uniforms: {
    [uniform: string]: THREE.IUniform
    uTime: { value: number }
    uBeamXZ: { value: THREE.Vector2 }
    uBeamStrength: { value: number }
  }
}

const VERT = /* glsl */ `
#include <fog_pars_vertex>
uniform float uTime;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float swell = sin(wp.x * 0.35 + uTime * 0.9) * 0.5 + sin(wp.z * 0.42 - uTime * 0.7) * 0.5;
  wp.y += swell * ${WATER_SWELL.toFixed(2)};
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAG = /* glsl */ `
#include <fog_pars_fragment>
uniform float uTime;
uniform vec2 uBeamXZ;
uniform float uBeamStrength;
varying vec3 vWorld;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  // Two scrolled procedural normal octaves, no textures.
  float n1 = vnoise(vWorld.xz * 0.32 + vec2(uTime * 0.06, uTime * 0.03));
  float n2 = vnoise(vWorld.xz * 0.85 - vec2(uTime * 0.045, uTime * 0.07));
  vec3 n = normalize(vec3((n1 - 0.5) * 0.55 + (n2 - 0.5) * 0.3, 1.0, (n2 - 0.5) * 0.55 - (n1 - 0.5) * 0.3));
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(view, n), 0.0), 3.0);
  vec3 deep = vec3(0.039, 0.118, 0.149);
  vec3 sky = vec3(0.086, 0.161, 0.227);
  vec3 col = mix(deep, sky, fres);
  // Analytic sun glint plus sparse sparkle from the second octave.
  vec3 sunDir = normalize(vec3(0.55, 0.75, 0.36));
  vec3 halfV = normalize(sunDir + view);
  col += vec3(1.0, 0.82, 0.58) * pow(max(dot(n, halfV), 0.0), 90.0) * 0.55;
  col += vec3(0.45, 0.75, 0.72) * step(0.985, n2) * 0.35;
  // Foam seams at banks: sheet edges with scrolling breakup.
  float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float seam = 1.0 - smoothstep(0.0, 0.09, edge);
  float breakup = vnoise(vWorld.xz * 1.4 + vec2(0.0, uTime * 0.18));
  col = mix(col, vec3(0.62, 0.78, 0.76), seam * smoothstep(0.35, 0.75, breakup) * 0.55);
  // Pier rings + AO: four piers share x=-52, z=32/44/56/68.
  float pier = 0.0;
  float ao = 0.0;
  for (int i = 0; i < 4; i += 1) {
    float pz = 32.0 + float(i) * 12.0;
    float d = distance(vWorld.xz, vec2(-52.0, pz));
    pier += exp(-pow(d - 9.5, 2.0) / 2.5) * smoothstep(0.3, 0.7, breakup);
    ao += exp(-d * d / 90.0);
  }
  col = mix(col, vec3(0.6, 0.75, 0.73), clamp(pier, 0.0, 1.0) * 0.4);
  col *= 1.0 - clamp(ao, 0.0, 1.0) * 0.25;
  // Needs-you beam reflected as a trembling amber pillar.
  float bd = distance(vWorld.xz, uBeamXZ);
  float pillar = uBeamStrength * exp(-bd * bd / 18.0);
  pillar *= 0.75 + 0.25 * sin(uTime * 3.0 + vWorld.z * 0.8 + vWorld.x * 0.5);
  col += vec3(1.0, 0.62, 0.28) * pillar * 0.85;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`

export function createJadeWaterMaterial(): JadeWaterMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: STILL_TIME },
      uBeamXZ: { value: new THREE.Vector2(0, 20) },
      uBeamStrength: { value: 0 },
    },
  ]) as JadeWaterMaterial['uniforms']
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
  }) as JadeWaterMaterial
  return material
}
