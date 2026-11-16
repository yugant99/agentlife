import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BLACK_HOLE_ARC_HALF_HEIGHT_DEG,
  BLACK_HOLE_ARC_HALF_WIDTH_DEG,
  BLACK_HOLE_CORE_DEG,
  BLACK_HOLE_DIRECTION,
  DEFAULT_MAX_POLAR,
  SCENE_FOV_DEG,
  SHOWCASE_DEFAULT_QUALITY,
  SHOWCASE_FIRST_SHOT_MS,
  SHOWCASE_MAX_POLAR,
  SHOWCASE_POSES,
  SHOWCASE_SHOT_MS,
  SHOWCASE_CAST,
  SHOWCASE_EVENT_LABELS,
  STORY_BEATS,
  STORY_START_STEP,
  STORY_TOTAL_MS,
  directionInView,
  parseShowcaseFlag,
  polarAngle,
  showcaseQuality,
  showcaseCastState,
  showcaseShot,
  storyBeatStarts,
  storyShot,
} from './showcase.ts'
import { DWELL_MS, SCENARIO_STEPS, advanceScenario, resetScenario } from './scenario.ts'
import { toCitySnapshot } from './scenarioBridge.ts'
import { placementFor } from './toronto.ts'
import { LANDMARKS } from './landmarks/landmarkTypes.ts'
import { HERO_CELL, HERO_HEIGHT, HERO_SPIRE_HEIGHT, MAIN_PARTS, PODIUM_PARTS, UPPER_PARTS } from './city.ts'

test('flag parsing: only showcase=1 turns it on', () => {
  assert.equal(parseShowcaseFlag('?showcase=1'), true)
  assert.equal(parseShowcaseFlag('?debug=1&showcase=1'), true)
  assert.equal(parseShowcaseFlag('?showcase=0'), false)
  assert.equal(parseShowcaseFlag('?showcase'), false)
  assert.equal(parseShowcaseFlag(''), false)
})

test('quality: explicit ?quality= wins, showcase pins medium, otherwise unpinned', () => {
  assert.equal(SHOWCASE_DEFAULT_QUALITY, 'medium')
  assert.equal(showcaseQuality(null, true), 'medium')
  assert.equal(showcaseQuality('high', true), 'high')
  assert.equal(showcaseQuality('low', false), 'low')
  assert.equal(showcaseQuality(null, false), null)
})

test('reel alternates poses with unique ids; first move is quicker', () => {
  const first = showcaseShot(0, 1)
  const second = showcaseShot(1, 2)
  const third = showcaseShot(2, 3)
  assert.equal(first.durationMs, SHOWCASE_FIRST_SHOT_MS)
  assert.equal(second.durationMs, SHOWCASE_SHOT_MS)
  assert.deepEqual(first.position, SHOWCASE_POSES[0].position)
  assert.deepEqual(second.position, SHOWCASE_POSES[1].position)
  assert.deepEqual(third.position, SHOWCASE_POSES[0].position)
  assert.notEqual(first.id, second.id)
  assert.ok(first.id.startsWith('showcase-'))
  // Shots carry copies, never the shared pose arrays.
  first.position[0] = 999
  assert.notEqual(SHOWCASE_POSES[0].position[0], 999)
  // Bad steps fall back to the first pose.
  assert.deepEqual(showcaseShot(Number.NaN, 4).position, SHOWCASE_POSES[0].position)
})

test('every pose sits inside the showcase orbit limits (controls never clamp it)', () => {
  assert.ok(SHOWCASE_MAX_POLAR > DEFAULT_MAX_POLAR)
  for (const pose of SHOWCASE_POSES) {
    const polar = polarAngle(pose)
    assert.ok(polar >= 0.22, `polar ${polar} under the minimum`)
    assert.ok(polar <= SHOWCASE_MAX_POLAR, `polar ${polar} over the showcase limit`)
  }
})

// Horizontal half-FOV for an aspect ratio, given the fixed vertical FOV.
function halfWidthDeg(aspect) {
  const halfV = (SCENE_FOV_DEG / 2) * (Math.PI / 180)
  return Math.atan(Math.tan(halfV) * aspect) * (180 / Math.PI)
}

test('the arcs fit vertically and the whole hole fits at 16:9 at every pose', () => {
  const halfV = SCENE_FOV_DEG / 2
  const half169 = halfWidthDeg(16 / 9)
  for (const pose of SHOWCASE_POSES) {
    const { up, right } = directionInView(pose, BLACK_HOLE_DIRECTION)
    // One degree of headroom: the top arc grazed the edge at a one-degree pitch.
    assert.ok(up + BLACK_HOLE_ARC_HALF_HEIGHT_DEG <= halfV - 1, `arc top ${up + BLACK_HOLE_ARC_HALF_HEIGHT_DEG} too close to the top edge`)
    assert.ok(up - BLACK_HOLE_ARC_HALF_HEIGHT_DEG >= -halfV, `arc bottom ${up - BLACK_HOLE_ARC_HALF_HEIGHT_DEG} below frame`)
    assert.ok(Math.abs(right) + BLACK_HOLE_ARC_HALF_WIDTH_DEG <= half169, `arcs ${right} outside a 16:9 frame`)
  }
})

test('square crops keep the core and clip the arc tips evenly', () => {
  const halfSquare = halfWidthDeg(1)
  for (const pose of SHOWCASE_POSES) {
    const { right } = directionInView(pose, BLACK_HOLE_DIRECTION)
    assert.ok(Math.abs(right) + BLACK_HOLE_CORE_DEG <= halfSquare, `core ${right} outside a square crop`)
    // Aimed at the hole, so any clipping of the arc tips is symmetric.
    assert.ok(Math.abs(right) <= 1, `hole ${right} degrees off centre`)
  }
})

test('no tall tower cuts through the hole at any pose', () => {
  const cn = placementFor('cn-tower')
  const cnSpec = LANDMARKS.find((spec) => spec.id === 'cn-tower')
  const towers = [
    { name: 'CN Tower', x: cn.x, z: cn.z, top: cnSpec.height * cn.scale },
    { name: 'hero needle', x: HERO_CELL[0], z: HERO_CELL[1], top: HERO_HEIGHT + HERO_SPIRE_HEIGHT },
  ]
  for (const pose of SHOWCASE_POSES) {
    const hole = directionInView(pose, BLACK_HOLE_DIRECTION)
    for (const tower of towers) {
      const tip = directionInView(pose, [tower.x - pose.position[0], tower.top - pose.position[1], tower.z - pose.position[2]])
      const belowCore = tip.up < hole.up - BLACK_HOLE_CORE_DEG
      const beside = Math.abs(tip.right - hole.right) >= BLACK_HOLE_CORE_DEG + 3
      assert.ok(belowCore || beside, `${tower.name} crosses the hole at pose ${pose.position} (${(tip.right - hole.right).toFixed(1)} degrees off)`)
    }
  }
})

test('the default overview cannot frame the hole (why showcase needs its own limit)', () => {
  // The overview looks down ~30 degrees; the hole sits ~12 degrees above the horizon.
  const overview = { position: [79.8, 103, 144.4], target: [0, 8, 0] }
  const { up } = directionInView(overview, BLACK_HOLE_DIRECTION)
  assert.ok(up > SCENE_FOV_DEG / 2, `expected the hole above the overview frame, got ${up}`)
})

// --- Story -------------------------------------------------------------------

const stepTime = (step) => (step - STORY_START_STEP) * DWELL_MS
const firstStepAfterStart = (predicate) => {
  for (let step = STORY_START_STEP + 1; step < SCENARIO_STEPS.length; step += 1) {
    if (predicate(SCENARIO_STEPS[step])) return step
  }
  return -1
}
const beatWindow = (name) => {
  const starts = storyBeatStarts()
  const index = STORY_BEATS.findIndex((beat) => beat.name === name)
  return { start: starts[index], arrive: starts[index] + STORY_BEATS[index].shot.durationMs, end: starts[index] + STORY_BEATS[index].holdMs }
}

test('the ship beat is framed while the freighter is still sailing', () => {
  const ship = firstStepAfterStart((step) => Boolean(step.ship))
  assert.ok(ship > STORY_START_STEP)
  const { arrive, end } = beatWindow('ship')
  const sailSeconds = 9 // SHIP_SAIL_SECONDS in CourtyardScene.tsx
  assert.ok(arrive <= stepTime(ship) + (sailSeconds * 1000) / 2, 'camera arrives after most of the departure')
  assert.ok(end >= stepTime(ship) + sailSeconds * 1000 - 1000, 'camera leaves before the freighter clears the harbor')
})

test('the needs-you beat is up before the call and holds while the agent walks over', () => {
  const needs = firstStepAfterStart((step) => step.changes.some((change) => change.workState === 'needs-input'))
  assert.ok(needs > STORY_START_STEP)
  const beat = STORY_BEATS.find((b) => b.name === 'needs-you')
  assert.equal(beat.hud, true)
  assert.equal(beat.follow, 'needs-you')
  const { start, end } = beatWindow('needs-you')
  assert.ok(start <= stepTime(needs), 'needs-you shot starts after the call')
  assert.ok(end >= stepTime(needs) + 10000, 'needs-you shot ends before a 10 s walk to the Citadel finishes')
})

test('story shape: skyline first, dashboard last, HUD only for the payoff, about 45 s', () => {
  assert.equal(STORY_BEATS[0].name, 'skyline')
  assert.equal(STORY_BEATS[STORY_BEATS.length - 1].name, 'dashboard')
  assert.ok(STORY_BEATS.filter((b) => b.hud).every((b) => b.name === 'needs-you' || b.name === 'dashboard'))
  assert.ok(STORY_TOTAL_MS >= 35000 && STORY_TOTAL_MS <= 60000, `story is ${STORY_TOTAL_MS} ms`)
  for (const beat of STORY_BEATS) assert.ok(beat.shot.durationMs <= beat.holdMs, `${beat.name} glides past its hold`)
  // Shots carry the showcase prefix (input releases them) and fresh ids.
  const ids = STORY_BEATS.map((_, i) => storyShot(i, i + 1).id)
  assert.ok(ids.every((id) => id.startsWith('showcase-')))
  assert.equal(new Set(ids).size, ids.length)
  // Every story shot sits inside the showcase orbit limit.
  for (const beat of STORY_BEATS) {
    assert.ok(polarAngle({ position: beat.shot.position, target: beat.shot.target }) <= SHOWCASE_MAX_POLAR, `${beat.name} would be clamped`)
  }
})

// Solid boxes the camera must never pass through: every building part and every
// landmark's footprint up to its height (a generous box for the thin CN Tower).
function obstacles() {
  const boxes = [...PODIUM_PARTS, ...MAIN_PARTS, ...UPPER_PARTS].map((p) => ({
    x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2, top: p.y0 + p.h, name: `building ${p.x},${p.z}`,
  }))
  for (const spec of LANDMARKS) {
    const place = placementFor(spec.id)
    const hw = (spec.footprint.w * place.scale) / 2
    const hd = (spec.footprint.d * place.scale) / 2
    boxes.push({ x0: place.x - hw, x1: place.x + hw, z0: place.z - hd, z1: place.z + hd, top: spec.height * place.scale, name: spec.id })
  }
  return boxes
}

function firstHit(from, to, boxes) {
  for (let i = 0; i <= 400; i += 1) {
    const s = i / 400
    const p = from.map((v, k) => v + (to[k] - v) * s)
    const hit = boxes.find((b) => p[0] > b.x0 && p[0] < b.x1 && p[2] > b.z0 && p[2] < b.z1 && p[1] < b.top)
    if (hit) return `${hit.name} at ${p.map((v) => v.toFixed(1)).join(',')}`
  }
  return null
}

test('no fixed story shot looks through, or glides through, a building or landmark', () => {
  const boxes = obstacles()
  const fixed = STORY_BEATS.filter((b) => b.follow === 'none')
  for (const beat of fixed) {
    const hit = firstHit(beat.shot.position, beat.shot.target, boxes)
    assert.equal(hit, null, `${beat.name}: view blocked by ${hit}`)
  }
  // Glides between consecutive fixed beats (the needs-you beat hands off to the
  // scene's agent view, whose slot only the scene knows).
  for (let i = 1; i < STORY_BEATS.length; i += 1) {
    const prev = STORY_BEATS[i - 1]
    const next = STORY_BEATS[i]
    if (prev.follow !== 'none' || next.follow !== 'none') continue
    const hit = firstHit(prev.shot.position, next.shot.position, boxes)
    assert.equal(hit, null, `${prev.name} -> ${next.name} glides through ${hit}`)
  }
  // After the story the drift glides from the dashboard to the first skyline pose.
  const last = STORY_BEATS[STORY_BEATS.length - 1]
  assert.equal(firstHit(last.shot.position, SHOWCASE_POSES[0].position, boxes), null)
})

// --- Showcase cast -----------------------------------------------------------

test('every simulated agent is recast as a Claude Code, Codex or OpenCode agent', () => {
  let day = resetScenario()
  const ids = new Set(day.agents.map((agent) => agent.id))
  for (let step = 1; step < SCENARIO_STEPS.length; step += 1) {
    day = advanceScenario(day)
    for (const agent of day.agents) ids.add(agent.id)
  }
  for (const id of ids) assert.ok(SHOWCASE_CAST[id], `no showcase cast for ${id}`)
  const providers = new Set(Object.values(SHOWCASE_CAST).map((entry) => entry.provider))
  for (const provider of ['claude-code', 'codex', 'opencode']) assert.ok(providers.has(provider), `no ${provider} agent`)
  // The agent that needs you in the story is Claude Code.
  assert.equal(SHOWCASE_CAST.sigrid.provider, 'claude-code')
})

test('every event line is relabeled and no mythic name reaches the clip', () => {
  const mythic = /Sigrid|Bjorn|Astrid|Eirik|Halvard|Yrsa|Loom|banner|forging|harbor call/
  for (const step of SCENARIO_STEPS) {
    const relabeled = SHOWCASE_EVENT_LABELS[step.label]
    assert.ok(relabeled, `no showcase label for "${step.label}"`)
    assert.ok(!mythic.test(relabeled), `mythic wording left in "${relabeled}"`)
  }
  for (const entry of Object.values(SHOWCASE_CAST)) assert.ok(!mythic.test(entry.name + entry.role))
})

test('recasting keeps scenario mechanics and parent links, and leaves the source state alone', () => {
  let day = resetScenario()
  for (let step = 0; step < 13; step += 1) day = advanceScenario(day)
  const cast = showcaseCastState(day)
  assert.equal(cast.agents.length, day.agents.length)
  cast.agents.forEach((agent, i) => {
    const original = day.agents[i]
    assert.equal(agent.id, original.id)
    assert.equal(agent.workState, original.workState)
    assert.equal(agent.toolKind, original.toolKind)
    assert.equal(agent.station, original.station)
    assert.equal(agent.workspace, 'mythic-city')
  })
  // Loom (sub-agent) keeps pointing at Bjorn, now a Codex agent.
  const snapshot = toCitySnapshot(cast, 0)
  const loom = snapshot.agents.find((agent) => agent.name === 'Codex sub-agent')
  const codex = snapshot.agents.find((agent) => agent.name === 'Codex')
  assert.ok(loom && codex)
  assert.equal(loom.parentId, codex.id)
  assert.equal(SHOWCASE_EVENT_LABELS[day.lastEvent], cast.lastEvent)
  assert.notEqual(day.agents.find((agent) => agent.id === 'sigrid').name, 'Claude Code')
})
