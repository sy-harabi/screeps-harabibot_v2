type Coordinate = {
  readonly x: number
  readonly y: number
}

type TrafficCreep = (Creep | PowerCreep) & {
  _intendedPackedCoord?: number
  _movePriority?: number
  _workingPos?: RoomPosition
  _workingRange?: number
  _possibleMoves?: Coordinate[]
  _canMove?: boolean
  _matchedPackedCoord?: number
}

type TrafficRoom = Room & {
  _runTrafficManager?: boolean
}

type CostProvider = CostMatrix | undefined | (() => CostMatrix | undefined)

const DIRECTIONS: readonly (Coordinate | undefined)[] = [
  undefined,
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
]

export function registerMove(
  creep: Creep | PowerCreep,
  target: RoomPosition | DirectionConstant,
  priority = 1,
): void {
  const trafficCreep = creep as TrafficCreep
  const targetCoordinate = typeof target === "number" ? getDirectionTarget(creep.pos, target) : target

  trafficCreep._intendedPackedCoord = packCoordinate(targetCoordinate)
  trafficCreep._movePriority = Math.floor(priority)
  ;(creep.room as TrafficRoom)._runTrafficManager = true
}

export function setWorkingArea(creep: Creep | PowerCreep, pos: RoomPosition, range: number): void {
  const trafficCreep = creep as TrafficCreep

  trafficCreep._workingPos = pos
  trafficCreep._workingRange = range
}

export function getIntendedCoordinate(creep: Creep | PowerCreep): Coordinate | undefined {
  const packedCoordinate = getIntendedPackedCoordinate(creep as TrafficCreep)

  return packedCoordinate === undefined ? undefined : unpackCoordinate(packedCoordinate)
}

export function runTraffic(room: Room, costProvider?: CostProvider, movementCostThreshold = 255): void {
  if (!(room as TrafficRoom)._runTrafficManager) {
    return
  }

  const costs = typeof costProvider === "function" ? costProvider() : costProvider
  const movementMap = new Map<number, TrafficCreep>()
  const terrain = Game.map.getRoomTerrain(room.name)
  const creepsInRoom = [
    ...room.find(FIND_MY_CREEPS),
    ...room.find(FIND_MY_POWER_CREEPS),
  ] as TrafficCreep[]

  for (const creep of creepsInRoom) {
    if (vacatesEdgeTile(creep)) {
      continue
    }

    assignCreepToCoordinate(creep, creep.pos, movementMap)
  }

  for (const creep of creepsInRoom) {
    if (vacatesEdgeTile(creep)) {
      continue
    }

    const intendedPackedCoordinate = getIntendedPackedCoordinate(creep)

    if (intendedPackedCoordinate === undefined) {
      continue
    }

    const matchedPackedCoordinate = getMatchedPackedCoordinate(creep)

    if (matchedPackedCoordinate === intendedPackedCoordinate) {
      continue
    }

    const visitedCreeps = new Set<string>()

    if (matchedPackedCoordinate !== undefined) {
      movementMap.delete(matchedPackedCoordinate)
    }
    deleteMatchedPackedCoordinate(creep)

    if (
      depthFirstSearch(creep, 0, terrain, costs, movementCostThreshold, movementMap, visitedCreeps) > 0
    ) {
      continue
    }

    assignCreepToCoordinate(creep, creep.pos, movementMap)
  }

  for (const creep of creepsInRoom) {
    resolveMovement(creep)
  }
}

function depthFirstSearch(
  creep: TrafficCreep,
  score: number,
  terrain: RoomTerrain,
  costs: CostMatrix | undefined,
  movementCostThreshold: number,
  movementMap: Map<number, TrafficCreep>,
  visitedCreeps: Set<string>,
): number {
  visitedCreeps.add(creep.name)

  if (!creep.my) {
    return -Infinity
  }

  const emptyTiles: Coordinate[] = []
  const occupiedTiles: Coordinate[] = []

  for (const coordinate of getPossibleMoves(creep, terrain, costs, movementCostThreshold)) {
    if (movementMap.has(packCoordinate(coordinate))) {
      occupiedTiles.push(coordinate)
    } else {
      emptyTiles.push(coordinate)
    }
  }

  for (const coordinate of [...emptyTiles, ...occupiedTiles]) {
    const packedCoordinate = packCoordinate(coordinate)
    let nextScore = score

    if (getIntendedPackedCoordinate(creep) === packedCoordinate) {
      nextScore += getMovePriority(creep)
    }

    const occupyingCreep = movementMap.get(packedCoordinate)

    if (occupyingCreep === undefined) {
      if (nextScore > 0) {
        assignCreepToCoordinate(creep, coordinate, movementMap)
      }
      return nextScore
    }

    if (visitedCreeps.has(occupyingCreep.name)) {
      continue
    }

    if (getIntendedPackedCoordinate(occupyingCreep) === packedCoordinate) {
      nextScore -= getMovePriority(occupyingCreep)
    }

    const result = depthFirstSearch(
      occupyingCreep,
      nextScore,
      terrain,
      costs,
      movementCostThreshold,
      movementMap,
      visitedCreeps,
    )

    if (result > 0) {
      assignCreepToCoordinate(creep, coordinate, movementMap)
      return result
    }
  }

  return -Infinity
}

function getPossibleMoves(
  creep: TrafficCreep,
  terrain: RoomTerrain,
  costs: CostMatrix | undefined,
  movementCostThreshold: number,
): Coordinate[] {
  if (creep._possibleMoves !== undefined) {
    return creep._possibleMoves
  }

  const possibleMoves: Coordinate[] = []

  if (!canMove(creep)) {
    creep._possibleMoves = possibleMoves
    return possibleMoves
  }

  const intendedPackedCoordinate = getIntendedPackedCoordinate(creep)

  if (intendedPackedCoordinate !== undefined) {
    possibleMoves.push(unpackCoordinate(intendedPackedCoordinate))
    creep._possibleMoves = possibleMoves
    return possibleMoves
  }

  const outOfWorkingArea: Coordinate[] = []
  const offset = (Game.time + getNameHash(creep.name)) % 8

  for (let index = 0; index < 8; index++) {
    const delta = DIRECTIONS[((index + offset) % 8) + 1]

    if (delta === undefined) {
      continue
    }

    const coordinate = {
      x: creep.pos.x + delta.x,
      y: creep.pos.y + delta.y,
    }

    if (!isValidMove(coordinate, terrain, costs, movementCostThreshold)) {
      continue
    }

    const workingArea = getWorkingArea(creep)

    if (workingArea !== undefined && workingArea.pos.getRangeTo(coordinate.x, coordinate.y) > workingArea.range) {
      outOfWorkingArea.push(coordinate)
      continue
    }

    possibleMoves.push(coordinate)
  }

  possibleMoves.push(...outOfWorkingArea)
  creep._possibleMoves = possibleMoves

  return possibleMoves
}

function canMove(creep: TrafficCreep): boolean {
  if (creep._canMove !== undefined) {
    return creep._canMove
  }

  if (creep instanceof PowerCreep) {
    creep._canMove = true
    return true
  }

  if (creep.fatigue > 0) {
    creep._canMove = false
    return false
  }

  creep._canMove = creep.body.some((part) => part.type === MOVE)
  return creep._canMove
}

function isValidMove(
  coordinate: Coordinate,
  terrain: RoomTerrain,
  costs: CostMatrix | undefined,
  movementCostThreshold: number,
): boolean {
  if (terrain.get(coordinate.x, coordinate.y) === TERRAIN_MASK_WALL) {
    return false
  }

  if (coordinate.x === 0 || coordinate.x === 49 || coordinate.y === 0 || coordinate.y === 49) {
    return false
  }

  return costs === undefined || costs.get(coordinate.x, coordinate.y) < movementCostThreshold
}

function vacatesEdgeTile(creep: TrafficCreep): boolean {
  const { x, y } = creep.pos

  if (x !== 0 && x !== 49 && y !== 0 && y !== 49) {
    return false
  }

  const intendedPackedCoordinate = getIntendedPackedCoordinate(creep)

  return intendedPackedCoordinate === undefined || intendedPackedCoordinate === packCoordinate(creep.pos)
}

function resolveMovement(creep: TrafficCreep): void {
  const matchedPackedCoordinate = getMatchedPackedCoordinate(creep)

  if (matchedPackedCoordinate === undefined) {
    return
  }

  const matchedPosition = unpackCoordinate(matchedPackedCoordinate)

  if (!creep.pos.isEqualTo(matchedPosition.x, matchedPosition.y)) {
    creep.move(creep.pos.getDirectionTo(matchedPosition.x, matchedPosition.y))
  }
}

function assignCreepToCoordinate(
  creep: TrafficCreep,
  coordinate: Coordinate,
  movementMap: Map<number, TrafficCreep>,
): void {
  const packedCoordinate = packCoordinate(coordinate)

  creep._matchedPackedCoord = packedCoordinate
  movementMap.set(packedCoordinate, creep)
}

function getDirectionTarget(pos: RoomPosition, direction: DirectionConstant): Coordinate {
  const delta = DIRECTIONS[direction]

  if (delta === undefined) {
    return { x: pos.x, y: pos.y }
  }

  return {
    x: Math.max(0, Math.min(49, pos.x + delta.x)),
    y: Math.max(0, Math.min(49, pos.y + delta.y)),
  }
}

function getWorkingArea(creep: TrafficCreep): { pos: RoomPosition; range: number } | undefined {
  if (creep._workingPos === undefined) {
    return undefined
  }

  return {
    pos: creep._workingPos,
    range: creep._workingRange ?? 0,
  }
}

function getMovePriority(creep: TrafficCreep): number {
  return creep._movePriority ?? 1
}

function getIntendedPackedCoordinate(creep: TrafficCreep): number | undefined {
  return creep._intendedPackedCoord
}

function getMatchedPackedCoordinate(creep: TrafficCreep): number | undefined {
  return creep._matchedPackedCoord
}

function deleteMatchedPackedCoordinate(creep: TrafficCreep): void {
  delete creep._matchedPackedCoord
}

function getNameHash(name: string): number {
  let hash = 0

  for (let index = 0; index < name.length; index++) {
    hash += name.charCodeAt(index)
  }

  return hash
}

function packCoordinate(coordinate: Coordinate): number {
  return 50 * coordinate.y + coordinate.x
}

function unpackCoordinate(packedCoordinate: number): Coordinate {
  const x = packedCoordinate % 50

  return {
    x,
    y: (packedCoordinate - x) / 50,
  }
}
