// Road graph for walking workers (plan 002, Lane B). Pure and self-contained apart
// from layout data in city.ts: no Three.js, no DOM, no clocks, so plain Node tests can
// load it via `--experimental-strip-types`.
//
// Nodes are street intersections on the existing grid, plus one connector per work
// spot and the Gateway arch. Edges run between adjacent intersections, or as short
// spurs from the nearest intersection to a spot/arch. No node or edge may pass
// through water, the canal (except near a bridge deck), the citadel core or the
// authored landmarks. Shortest path is a small Dijkstra over ~120 nodes; it runs
// only when a worker retargets, never per frame.

import {
  BRIDGES, CANAL_POINTS, CANAL_WIDTH, GATEWAY_ARCH, HARBOR, STREET_GRID, WORK_SPOTS,
} from './city.ts'
import type { DistrictId } from './city.ts'

export interface GraphNode {
  id: string
  x: number
  z: number
  kind: 'street' | 'spot' | 'arch'
  district?: DistrictId
}

export interface GraphEdge {
  from: string
  to: string
  length: number
}

export interface RoadGraph {
  nodes: Map<string, GraphNode>
  adjacency: Map<string, GraphEdge[]>
}

// --- Footprints (world x/z; kept in sync with the authored landmarks) ------------

export const CITADEL_HALF = 13
export const ARCHIVE_ROTONDA = { x: 34, z: -28, r: 12 }
export const OBSERVATORY_BASE = { x: 4, z: 42, r: 10 }
export const FOUNDRY_HALL = { x0: -47, x1: -29, z0: -23, z1: -9 }
export const GATEWAY_PILLARS: [number, number][] = [[41, 12], [51, 12]]
export const PILLAR_R = 2
/** Street intersections keep this clearance from the canal centre line. */
export const CANAL_PAD = CANAL_WIDTH / 2 + 1
/** A canal crossing is only legal within this distance of a bridge deck. */
export const BRIDGE_R = 5.5

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

export function canalDistance(x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < CANAL_POINTS.length - 1; i += 1) {
    best = Math.min(best, distToSegment(x, z, CANAL_POINTS[i][0], CANAL_POINTS[i][1], CANAL_POINTS[i + 1][0], CANAL_POINTS[i + 1][1]))
  }
  return best
}

export function bridgeDistance(x: number, z: number): number {
  let best = Infinity
  for (const bridge of BRIDGES) best = Math.min(best, Math.hypot(x - bridge.x, z - bridge.z))
  return best
}

export function inWater(x: number, z: number): boolean {
  return x > HARBOR.x0 - 1 && x < HARBOR.x1 + 1 && z > HARBOR.z0 - 1 && z < HARBOR.z1 + 1
}

export function inCitadelCore(x: number, z: number): boolean {
  return Math.abs(x) < CITADEL_HALF && Math.abs(z) < CITADEL_HALF
}

export function inLandmark(x: number, z: number): boolean {
  if (Math.hypot(x - ARCHIVE_ROTONDA.x, z - ARCHIVE_ROTONDA.z) < ARCHIVE_ROTONDA.r) return true
  if (Math.hypot(x - OBSERVATORY_BASE.x, z - OBSERVATORY_BASE.z) < OBSERVATORY_BASE.r) return true
  if (x > FOUNDRY_HALL.x0 && x < FOUNDRY_HALL.x1 && z > FOUNDRY_HALL.z0 && z < FOUNDRY_HALL.z1) return true
  for (const [px, pz] of GATEWAY_PILLARS) {
    if (Math.hypot(x - px, z - pz) < PILLAR_R) return true
  }
  return false
}

/** A single ground point is walkable when it avoids every footprint. */
export function isWalkable(x: number, z: number): boolean {
  if (inWater(x, z)) return false
  if (inCitadelCore(x, z)) return false
  if (inLandmark(x, z)) return false
  if (canalDistance(x, z) < CANAL_PAD) return false
  return true
}

/**
 * A street segment is walkable when every sample avoids hard footprints, with one
 * exception: a sample inside the canal pad is legal within BRIDGE_R of a bridge
 * deck (the worker crosses on the bridge).
 */
export function isSegmentWalkable(ax: number, az: number, bx: number, bz: number): boolean {
  const SAMPLES = 8
  for (let i = 0; i <= SAMPLES; i += 1) {
    const t = i / SAMPLES
    const x = ax + (bx - ax) * t
    const z = az + (bz - az) * t
    if (inWater(x, z) || inCitadelCore(x, z) || inLandmark(x, z)) return false
    if (canalDistance(x, z) < CANAL_PAD && bridgeDistance(x, z) > BRIDGE_R) return false
  }
  return true
}

export function spotNodeId(district: DistrictId): string {
  return `spot:${district}`
}

export const ARCH_NODE_ID = 'arch'

function addEdge(adjacency: Map<string, GraphEdge[]>, from: string, to: string, length: number): void {
  const list = adjacency.get(from) ?? []
  list.push({ from, to, length })
  adjacency.set(from, list)
}

function link(adjacency: Map<string, GraphEdge[]>, a: GraphNode, b: GraphNode): void {
  if (!isSegmentWalkable(a.x, a.z, b.x, b.z)) return
  const length = Math.hypot(a.x - b.x, a.z - b.z)
  addEdge(adjacency, a.id, b.id, length)
  addEdge(adjacency, b.id, a.id, length)
}

export function buildRoadGraph(): RoadGraph {
  const nodes = new Map<string, GraphNode>()
  const adjacency = new Map<string, GraphEdge[]>()
  const byCoord = new Map<string, GraphNode>()

  for (const gx of STREET_GRID) {
    for (const gz of STREET_GRID) {
      if (!isWalkable(gx, gz)) continue
      const node: GraphNode = { id: `s:${gx},${gz}`, x: gx, z: gz, kind: 'street' }
      nodes.set(node.id, node)
      byCoord.set(`${gx},${gz}`, node)
    }
  }

  // Adjacent intersections along both street axes.
  const STEP = STREET_GRID[1] - STREET_GRID[0]
  for (const node of nodes.values()) {
    for (const [dx, dz] of [[STEP, 0], [0, STEP]] as const) {
      const other = byCoord.get(`${node.x + dx},${node.z + dz}`)
      if (other) link(adjacency, node, other)
    }
  }

  // One connector per work spot plus the Gateway arch, each spurred to the nearest
  // walkable intersection.
  const connectors: GraphNode[] = (Object.keys(WORK_SPOTS) as DistrictId[]).map((district) => ({
    id: spotNodeId(district),
    x: WORK_SPOTS[district].center[0],
    z: WORK_SPOTS[district].center[1],
    kind: 'spot',
    district,
  }))
  connectors.push({ id: ARCH_NODE_ID, x: GATEWAY_ARCH[0], z: GATEWAY_ARCH[1], kind: 'arch' })
  for (const connector of connectors) {
    nodes.set(connector.id, connector)
    let best: GraphNode | undefined
    let bestDist = Infinity
    for (const node of nodes.values()) {
      if (node.kind !== 'street') continue
      const d = Math.hypot(node.x - connector.x, node.z - connector.z)
      if (d < bestDist) { bestDist = d; best = node }
    }
    if (best) link(adjacency, connector, best)
  }

  return { nodes, adjacency }
}

/** The closest street node to a free ground point (for a worker mid-plaza). */
export function nearestStreetNode(graph: RoadGraph, x: number, z: number): GraphNode | undefined {
  let best: GraphNode | undefined
  let bestDist = Infinity
  for (const node of graph.nodes.values()) {
    if (node.kind !== 'street') continue
    const d = Math.hypot(node.x - x, node.z - z)
    if (d < bestDist) { bestDist = d; best = node }
  }
  return best
}

/** Small Dijkstra over node ids. Returns [] when there is no route. */
export function shortestPath(graph: RoadGraph, fromId: string, toId: string): string[] {
  if (!graph.nodes.has(fromId) || !graph.nodes.has(toId)) return []
  if (fromId === toId) return [fromId]
  const dist = new Map<string, number>([[fromId, 0]])
  const prev = new Map<string, string>()
  const visited = new Set<string>()
  for (;;) {
    let current: string | undefined
    let best = Infinity
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) { best = d; current = id }
    }
    if (current === undefined) return []
    if (current === toId) break
    visited.add(current)
    for (const edge of graph.adjacency.get(current) ?? []) {
      if (visited.has(edge.to)) continue
      const next = best + edge.length
      if (next < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next)
        prev.set(edge.to, current)
      }
    }
  }
  const path = [toId]
  let cursor = toId
  while (cursor !== fromId) {
    const step = prev.get(cursor)
    if (!step) return []
    cursor = step
    path.unshift(cursor)
  }
  return path
}

export function pathLength(graph: RoadGraph, path: string[]): number {
  let total = 0
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = graph.nodes.get(path[i])
    const b = graph.nodes.get(path[i + 1])
    if (!a || !b) return Infinity
    total += Math.hypot(a.x - b.x, a.z - b.z)
  }
  return total
}

/**
 * A walking polyline from a free ground point to a district work spot (or the
 * Gateway arch when `district` is 'gateway' and `toArch` is set): the worker's own
 * position first, then the street route, then the spot. Pure; the frame loop walks it.
 */
export function pathToSpot(
  graph: RoadGraph,
  fromX: number,
  fromZ: number,
  district: DistrictId,
  toArch = false,
): [number, number][] {
  const targetId = toArch ? ARCH_NODE_ID : spotNodeId(district)
  const target = graph.nodes.get(targetId)
  const start = nearestStreetNode(graph, fromX, fromZ)
  if (!target || !start) return [[fromX, fromZ]]
  const ids = shortestPath(graph, start.id, targetId)
  if (ids.length === 0) return [[fromX, fromZ]]
  const polyline: [number, number][] = [[fromX, fromZ]]
  for (const id of ids) {
    const node = graph.nodes.get(id)
    if (node) polyline.push([node.x, node.z])
  }
  return polyline
}
