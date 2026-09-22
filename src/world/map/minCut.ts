import type { RoomCoordinate } from "./roomCoordinate"
import { fromRoomIndex, isInsideRoom, NEIGHBOR_OFFSETS, ROOM_AREA, toRoomIndex } from "./roomGrid"

export interface MinimumTileCutResult {
  readonly cuts: RoomCoordinate[]
  readonly cutMask: Uint8Array
  readonly insideMask: Uint8Array
  readonly outsideMask: Uint8Array
  readonly totalCost: number
}

interface FlowEdge {
  readonly to: number
  readonly reverseIndex: number
  capacity: number
}

const IN_NODE_OFFSET = 0
const OUT_NODE_OFFSET = 1
const NUM_TILE_NODES = ROOM_AREA * 2
const SOURCE_NODE = NUM_TILE_NODES
const SINK_NODE = NUM_TILE_NODES + 1
const NUM_NODES = NUM_TILE_NODES + 2

/**
 * Finds a minimum-cost vertex cut separating protected source tiles from sink
 * tiles. Each walkable room tile is split into an in-node and an out-node;
 * cutting the tile means saturating that tile's in -> out edge.
 *
 * Source tiles are protected and therefore cannot themselves be selected as
 * cuts. Walls are omitted from the graph entirely.
 */
export function findMinimumTileCut(
  terrain: RoomTerrain,
  sourceMask: Uint8Array,
  sinkMask: Uint8Array,
  tileCosts?: ArrayLike<number>,
): MinimumTileCutResult | undefined {
  validateInput(sourceMask, sinkMask, tileCosts)

  let totalFiniteCapacity = 0

  for (let index = 0; index < ROOM_AREA; index++) {
    const { x, y } = fromRoomIndex(index)

    if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
      continue
    }

    totalFiniteCapacity += getTileCost(index, tileCosts)
  }

  // Larger than every possible finite tile cut, so any flow reaching this
  // value means the source/sink constraints cannot be separated legally.
  const infiniteCapacity = totalFiniteCapacity + 1
  const flow = new Dinic(NUM_NODES)

  let numSources = 0
  let numSinks = 0

  for (let index = 0; index < ROOM_AREA; index++) {
    const coordinate = fromRoomIndex(index)

    if (terrain.get(coordinate.x, coordinate.y) === TERRAIN_MASK_WALL) {
      continue
    }

    if (sourceMask[index] && sinkMask[index]) {
      return
    }

    const inNode = getInNode(index)
    const outNode = getOutNode(index)
    const tileCapacity = sourceMask[index] ? infiniteCapacity : getTileCost(index, tileCosts)

    flow.addEdge(inNode, outNode, tileCapacity)

    if (sourceMask[index]) {
      flow.addEdge(SOURCE_NODE, inNode, infiniteCapacity)
      numSources++
    }

    if (sinkMask[index]) {
      flow.addEdge(inNode, SINK_NODE, infiniteCapacity)
      numSinks++
    }

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborX = coordinate.x + offset.x
      const neighborY = coordinate.y + offset.y

      if (!isInsideRoom(neighborX, neighborY)) {
        continue
      }

      if (terrain.get(neighborX, neighborY) === TERRAIN_MASK_WALL) {
        continue
      }

      const neighborIndex = toRoomIndex(neighborX, neighborY)
      flow.addEdge(outNode, getInNode(neighborIndex), infiniteCapacity)
    }
  }

  if (numSources === 0 || numSinks === 0) {
    return
  }

  const maxFlow = flow.getMaxFlow(SOURCE_NODE, SINK_NODE, infiniteCapacity)

  if (maxFlow >= infiniteCapacity) {
    return
  }

  const reachable = flow.getResidualReachable(SOURCE_NODE)
  const cutMask = new Uint8Array(ROOM_AREA)
  const insideMask = new Uint8Array(ROOM_AREA)
  const outsideMask = new Uint8Array(ROOM_AREA)
  const cuts: RoomCoordinate[] = []
  let totalCost = 0

  for (let index = 0; index < ROOM_AREA; index++) {
    const coordinate = fromRoomIndex(index)

    if (terrain.get(coordinate.x, coordinate.y) === TERRAIN_MASK_WALL) {
      continue
    }

    const inReachable = reachable[getInNode(index)] === 1
    const outReachable = reachable[getOutNode(index)] === 1

    if (inReachable && !outReachable) {
      cutMask[index] = 1
      cuts.push(coordinate)
      totalCost += getTileCost(index, tileCosts)
      continue
    }

    if (inReachable && outReachable) {
      insideMask[index] = 1
      continue
    }

    outsideMask[index] = 1
  }

  return {
    cuts,
    cutMask,
    insideMask,
    outsideMask,
    totalCost,
  }
}

function validateInput(sourceMask: Uint8Array, sinkMask: Uint8Array, tileCosts?: ArrayLike<number>): void {
  if (sourceMask.length !== ROOM_AREA || sinkMask.length !== ROOM_AREA) {
    throw new Error("Minimum tile cut masks must cover the entire room")
  }

  if (tileCosts !== undefined && tileCosts.length !== ROOM_AREA) {
    throw new Error("Minimum tile cut costs must cover the entire room")
  }

  if (tileCosts === undefined) {
    return
  }

  for (let index = 0; index < ROOM_AREA; index++) {
    const cost = tileCosts[index]

    if (!Number.isFinite(cost) || !Number.isInteger(cost) || cost < 0) {
      throw new Error(`Invalid minimum tile cut cost at room index ${index}`)
    }
  }
}

function getTileCost(index: number, tileCosts?: ArrayLike<number>): number {
  return tileCosts?.[index] ?? 1
}

function getInNode(index: number): number {
  return index * 2 + IN_NODE_OFFSET
}

function getOutNode(index: number): number {
  return index * 2 + OUT_NODE_OFFSET
}

class Dinic {
  private readonly graph: FlowEdge[][]

  constructor(numNodes: number) {
    this.graph = Array.from({ length: numNodes }, () => [])
  }

  addEdge(from: number, to: number, capacity: number): void {
    const forward: FlowEdge = {
      to,
      reverseIndex: this.graph[to].length,
      capacity,
    }

    const reverse: FlowEdge = {
      to: from,
      reverseIndex: this.graph[from].length,
      capacity: 0,
    }

    this.graph[from].push(forward)
    this.graph[to].push(reverse)
  }

  getMaxFlow(source: number, sink: number, stopAt: number): number {
    let totalFlow = 0
    const levels = new Int16Array(this.graph.length)
    const nextEdge = new Int32Array(this.graph.length)

    while (this.buildLevels(source, sink, levels)) {
      nextEdge.fill(0)

      while (totalFlow < stopAt) {
        const pushed = this.sendFlow(source, sink, stopAt - totalFlow, levels, nextEdge)

        if (pushed === 0) {
          break
        }

        totalFlow += pushed
      }

      if (totalFlow >= stopAt) {
        break
      }
    }

    return totalFlow
  }

  getResidualReachable(source: number): Uint8Array {
    const reachable = new Uint8Array(this.graph.length)
    const queue = new Int32Array(this.graph.length)
    let head = 0
    let tail = 0

    reachable[source] = 1
    queue[tail++] = source

    while (head < tail) {
      const node = queue[head++]

      for (const edge of this.graph[node]) {
        if (edge.capacity <= 0 || reachable[edge.to]) {
          continue
        }

        reachable[edge.to] = 1
        queue[tail++] = edge.to
      }
    }

    return reachable
  }

  private buildLevels(source: number, sink: number, levels: Int16Array): boolean {
    levels.fill(-1)

    const queue = new Int32Array(this.graph.length)
    let head = 0
    let tail = 0

    levels[source] = 0
    queue[tail++] = source

    while (head < tail) {
      const node = queue[head++]

      for (const edge of this.graph[node]) {
        if (edge.capacity <= 0 || levels[edge.to] !== -1) {
          continue
        }

        levels[edge.to] = levels[node] + 1
        queue[tail++] = edge.to
      }
    }

    return levels[sink] !== -1
  }

  private sendFlow(node: number, sink: number, maxFlow: number, levels: Int16Array, nextEdge: Int32Array): number {
    if (node === sink) {
      return maxFlow
    }

    const edges = this.graph[node]

    for (; nextEdge[node] < edges.length; nextEdge[node]++) {
      const edge = edges[nextEdge[node]]

      if (edge.capacity <= 0 || levels[edge.to] !== levels[node] + 1) {
        continue
      }

      const pushed = this.sendFlow(edge.to, sink, Math.min(maxFlow, edge.capacity), levels, nextEdge)

      if (pushed <= 0) {
        continue
      }

      edge.capacity -= pushed
      this.graph[edge.to][edge.reverseIndex].capacity += pushed
      return pushed
    }

    return 0
  }
}
