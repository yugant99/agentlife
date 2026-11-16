import test from 'node:test'
import assert from 'node:assert/strict'

import { CONE_FADE_FAR, CONE_FADE_NEAR, coneFadeAt, patchConeFadeShader } from './coneFade.ts'
import { CITY_DISTANCE } from './tour.ts'

test('cones vanish at agent zoom and keep full glow from the city view', () => {
  assert.ok(CONE_FADE_NEAR < CONE_FADE_FAR)
  assert.equal(coneFadeAt(0), 0)
  assert.equal(coneFadeAt(CONE_FADE_NEAR), 0)
  assert.equal(coneFadeAt(CONE_FADE_FAR), 1)
  assert.equal(coneFadeAt(CITY_DISTANCE), 1)
  assert.equal(coneFadeAt(Number.NaN), 0)
  // Monotonic in between.
  let last = 0
  for (let d = CONE_FADE_NEAR; d <= CONE_FADE_FAR; d += 2) {
    const value = coneFadeAt(d)
    assert.ok(value >= last)
    last = value
  }
})

test('the patch fades alpha by view depth and backs off on unknown shaders', () => {
  const shader = {
    vertexShader: 'void main() {\n\t#include <project_vertex>\n}',
    fragmentShader: 'void main() {\n\t#include <opaque_fragment>\n}',
  }
  assert.equal(patchConeFadeShader(shader), true)
  assert.ok(shader.vertexShader.startsWith('varying float vConeDepth;'))
  assert.ok(shader.vertexShader.includes('vConeDepth = -mvPosition.z;'))
  assert.ok(shader.fragmentShader.includes(`smoothstep( ${CONE_FADE_NEAR}.0, ${CONE_FADE_FAR}.0, vConeDepth )`))
  // The fade runs before the output chunk, which still follows.
  assert.ok(shader.fragmentShader.indexOf('smoothstep') < shader.fragmentShader.indexOf('#include <opaque_fragment>'))

  const foreign = { vertexShader: 'void main() {}', fragmentShader: 'void main() {}' }
  assert.equal(patchConeFadeShader(foreign), false)
  assert.equal(foreign.vertexShader, 'void main() {}')
})
