// Lamp-cone near fade. Pure (no three.js) so node tests can load it. The lamp
// light cones in haze.tsx are additive and read as soft glow from district and
// city distance, but at agent zoom one cone fills the frame and reads as a solid
// beige party hat. The patch fades each cone fragment by its view depth: gone
// inside CONE_FADE_NEAR, full beyond CONE_FADE_FAR.

/** View depth (world units) at and below which a cone is invisible. */
export const CONE_FADE_NEAR = 22
/** View depth at and beyond which a cone is at full strength. */
export const CONE_FADE_FAR = 60

/** GLSL smoothstep mirror: the cone's opacity factor at a view depth. */
export function coneFadeAt(depth: number): number {
  if (!Number.isFinite(depth)) return 0
  const t = Math.min(1, Math.max(0, (depth - CONE_FADE_NEAR) / (CONE_FADE_FAR - CONE_FADE_NEAR)))
  return t * t * (3 - 2 * t)
}

export interface PatchableShader {
  vertexShader: string
  fragmentShader: string
}

const glslFloat = (value: number) => (Number.isInteger(value) ? `${value}.0` : `${value}`)

/**
 * Patch a MeshBasicMaterial shader (three r180 chunk names) so fragment alpha
 * scales by coneFadeAt(view depth). Returns false and leaves the shader alone if
 * an expected chunk is missing, so a three upgrade keeps the unfaded cones.
 */
export function patchConeFadeShader(shader: PatchableShader): boolean {
  const projectChunk = '#include <project_vertex>'
  const opaqueChunk = '#include <opaque_fragment>'
  if (!shader.vertexShader.includes(projectChunk) || !shader.fragmentShader.includes(opaqueChunk)) return false
  shader.vertexShader = `varying float vConeDepth;\n${shader.vertexShader.replace(
    projectChunk,
    `${projectChunk}\n\tvConeDepth = -mvPosition.z;`,
  )}`
  shader.fragmentShader = `varying float vConeDepth;\n${shader.fragmentShader.replace(
    opaqueChunk,
    `diffuseColor.a *= smoothstep( ${glslFloat(CONE_FADE_NEAR)}, ${glslFloat(CONE_FADE_FAR)}, vConeDepth );\n\t${opaqueChunk}`,
  )}`
  return true
}
