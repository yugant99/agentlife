import test from 'node:test'
import assert from 'node:assert/strict'

import { BRIDGES, GATEWAY_ARCH, WORK_SPOTS } from './city.ts'
import {
  ARCH_NODE_ID,
  buildRoadGraph,
  canalDistance,
  isSegmentWalkable,
  isWalkable,
  nearestStreetNode,
  pathLength,
  pathToSpot,
  shortestPath,
  spotNodeId,
} from './cityGraph.ts'

const DISTRICTS = Object.keys(WORK_SPOTS)

test('every work spot and the arch are reachable from the Gateway arch', () => {
  const graph = buildRoadGraph()
  assert.ok(graph.nodes.has(ARCH_NODE_ID))
  for (const district of DISTRICTS) {
    const id = spotNodeId(district)
    assert.ok(graph.nodes.has(id), `missing node ${id}`)
    const path = shortestPath(graph, ARCH_NODE_ID, id)
    assert.ok(path.length > 0, `no route arch -> ${id}`)
    assert.equal(path[0], ARCH_NODE_ID)
    assert.equal(path[path.length - 1], id)
    assert.ok(pathLength(graph, path) > 0 || district === 'gateway', `zero-length route to ${id}`)
  }
})

test('no node sits inside water, canal, citadel or landmark footprints', () => {
  const graph = buildRoadGraph()
  assert.ok(graph.nodes.size > 60, `suspiciously small graph: ${graph.nodes.size} nodes`)
  for (const node of graph.nodes.values()) {
    assert.equal(isWalkable(node.x, node.z), true, `node ${node.id} at ${node.x},${node.z} is blocked`)
  }
})

test('no edge crosses water, canal, citadel or landmarks except at bridges', () => {
  const graph = buildRoadGraph()
  let edges = 0
  for (const [from, list] of graph.adjacency) {
    const a = graph.nodes.get(from)
    assert.ok(a)
    for (const edge of list) {
      const b = graph.nodes.get(edge.to)
      assert.ok(b)
      assert.ok(isSegmentWalkable(a.x, a.z, b.x, b.z), `edge ${from} -> ${edge.to} crosses a footprint`)
      // Mirror the check inline: a canal sample must sit near a bridge deck.
      for (let i = 0; i <= 8; i += 1) {
        const t = i / 8
        const x = a.x + (b.x - a.x) * t
        const z = a.z + (b.z - a.z) * t
        if (canalDistance(x, z) < 4) {
          const near = BRIDGES.some((bridge) => Math.hypot(x - bridge.x, z - bridge.z) < 5.5)
          assert.ok(near, `edge ${from} -> ${edge.to} crosses the canal away from any bridge`)
        }
      }
      edges += 1
    }
  }
  assert.ok(edges > 100, `suspiciously few edges: ${edges}`)
})

test('spot connectors spur to their nearest walkable intersection', () => {
  const graph = buildRoadGraph()
  // The arch node from the frozen-adjacent layout data matches the city export.
  const arch = graph.nodes.get(ARCH_NODE_ID)
  assert.ok(arch)
  assert.deepEqual([arch.x, arch.z], [...GATEWAY_ARCH])
  // Every connector has at least one street edge (a zero-length spur where the spot
  // sits exactly on an intersection, such as the Port quay and Citadel steps).
  for (const district of DISTRICTS) {
    const edges = graph.adjacency.get(spotNodeId(district)) ?? []
    assert.ok(edges.length >= 1, `${district} spot has no street edge`)
  }
  assert.ok((graph.adjacency.get(ARCH_NODE_ID) ?? []).length >= 1, 'arch has no street edge')
})

test('dijkstra prefers the shorter of two routes', () => {
  const graph = buildRoadGraph()
  const start = nearestStreetNode(graph, 0, 30)
  const foundry = spotNodeId('foundry')
  assert.ok(start)
  const direct = shortestPath(graph, start.id, foundry)
  assert.ok(direct.length > 1)
  const cost = pathLength(graph, direct)
  // Any detour through the far corner must cost more than the shortest route.
  const corner = nearestStreetNode(graph, 50, -50)
  assert.ok(corner)
  const detour = [...shortestPath(graph, start.id, corner.id), ...shortestPath(graph, corner.id, foundry).slice(1)]
  assert.ok(pathLength(graph, detour) >= cost)
})

test('pathToSpot starts at the worker and ends at the spot', () => {
  const graph = buildRoadGraph()
  const line = pathToSpot(graph, -36, -4, 'foundry')
  assert.deepEqual(line[0], [-36, -4])
  const [sx, sz] = WORK_SPOTS.foundry.center
  const last = line[line.length - 1]
  assert.deepEqual(last, [sx, sz])
  // Every leg of the polyline is walkable ground.
  for (let i = 0; i < line.length - 1; i += 1) {
    assert.ok(
      isSegmentWalkable(line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]),
      `leg ${i} of the foundry walk crosses a footprint`,
    )
  }
})

test('unknown nodes yield no path instead of throwing', () => {
  const graph = buildRoadGraph()
  assert.deepEqual(shortestPath(graph, 'nope', spotNodeId('port')), [])
  assert.deepEqual(shortestPath(graph, ARCH_NODE_ID, 'nope'), [])
})
