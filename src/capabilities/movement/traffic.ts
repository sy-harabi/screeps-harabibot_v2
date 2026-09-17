type Coordinate = {
  readonly x: number
  readonly y: number
}

type TrafficCreep = (Creep | PowerCreep) & {
  _intendedPackedCoord?: number
  _moveScore?: number
  _workingPos?: RoomPosition
  _workingRange?: number
  _possibleMoves?: Coordinate[]
  _canMove?: boolean
}

type TrafficRoom = Room & {
  _runTrafficManager?: boolean
}

type CostProvider = CostMatrix | undefined | (() => CostMatrix | undefined)

const ROOM_SIZE = 50
const ROOM_AREA = ROOM_SIZE * ROOM_SIZE
const EMPTY = 0
const UNASSIGNED = -1

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
  score = 1,
): void {
  const trafficCreep = creep as TrafficCreep
  const targetCoordinate = typeof target === "number" ? getDirectionTarget(creep.pos, target) : target

  trafficCreep._intendedPackedCoord = packCoordinate(targetCoordinate)
  trafficCreep._moveScore = Math.floor(score)
  ;(creep.room as TrafficRoom)._runTrafficManager = true
}

export function clearMoveRequest(creep: Creep | PowerCreep): void {
  const trafficCreep = creep as TrafficCreep

  delete trafficCreep._intendedPackedCoord
  delete trafficCreep._moveScore
}

export function setWorkingArea(creep: Creep | PowerCreep, pos: RoomPosition, range: number): void {
  const trafficCreep = creep as TrafficCreep

  trafficCreep._workingPos = pos
  trafficCreep._workingRange = range
}

export function getIntendedCoord(creep: Creep | PowerCreep): Coordinate | undefined {
  const packedCoordinate = getIntendedPackedCoordinate(creep as TrafficCreep)

  return packedCoordinate === undefined ? undefined : unpackCoordinate(packedCoordinate)
}

export function run(room: Room, costProvider?: CostProvider, movementCostThreshold = 255): void {
  if (!(room as TrafficRoom)._runTrafficManager) {
    return
  }

  const costs = typeof costProvider === "function" ? costProvider() : costProvider
  const terrain = Game.map.getRoomTerrain(room.name)
  const creeps = [...room.find(FIND_MY_CREEPS), ...room.find(FIND_MY_POWER_CREEPS)] as TrafficCreep[]

  if (creeps.length === 0) {
    return
  }

  // 0 means empty; creep index + 1 identifies the assigned occupant.
  const occupancy = new Int16Array(ROOM_AREA)
  const matchedCoordinates = new Int16Array(creeps.length)
  const currentCoordinates = new Int16Array(creeps.length)
  const visitedAtSearch = new Uint16Array(creeps.length)

  matchedCoordinates.fill(UNASSIGNED)

  for (let creepIndex = 0; creepIndex < creeps.length; creepIndex++) {
    const creep = creeps[creepIndex]
    const packedCoordinate = packCoordinate(creep.pos)

    currentCoordinates[creepIndex] = packedCoordinate

    if (vacatesEdgeTile(creep)) {
      continue
    }

    assignCreepToCoordinate(creepIndex, packedCoordinate, occupancy, matchedCoordinates)
  }

  let searchId = 0

  // Keep the original one-pass behavior: each creep receives one chance to improve
  // the current assignment, and successful earlier assignments remain in place.
  for (let creepIndex = 0; creepIndex < creeps.length; creepIndex++) {
    const creep = creeps[creepIndex]

    if (vacatesEdgeTile(creep)) {
      continue
    }

    const intendedPackedCoordinate = getIntendedPackedCoordinate(creep)

    if (intendedPackedCoordinate === undefined) {
      continue
    }

    const matchedPackedCoordinate = matchedCoordinates[creepIndex]

    if (matchedPackedCoordinate === intendedPackedCoordinate) {
      continue
    }

    if (matchedPackedCoordinate !== UNASSIGNED) {
      occupancy[matchedPackedCoordinate] = EMPTY
    }
    matchedCoordinates[creepIndex] = UNASSIGNED

    searchId++

    if (
      depthFirstSearch(
        creepIndex,
        0,
        searchId,
        creeps,
        terrain,
        costs,
        movementCostThreshold,
        occupancy,
        matchedCoordinates,
        visitedAtSearch,
      ) > 0
    ) {
      continue
    }

    assignCreepToCoordinate(creepIndex, currentCoordinates[creepIndex], occupancy, matchedCoordinates)
  }

  for (let creepIndex = 0; creepIndex < creeps.length; creepIndex++) {
    resolveMovement(creeps[creepIndex], matchedCoordinates[creepIndex])
  }
}

function depthFirstSearch(
  creepIndex: number,
  score: number,
  searchId: number,
  creeps: readonly TrafficCreep[],
  terrain: RoomTerrain,
  costs: CostMatrix | undefined,
  movementCostThreshold: number,
  occupancy: Int16Array,
  matchedCoordinates: Int16Array,
  visitedAtSearch: Uint16Array,
): number {
  visitedAtSearch[creepIndex] = searchId

  const creep = creeps[creepIndex]
  const possibleMoves = getPossibleMoves(creep, terrain, costs, movementCostThreshold)

  // Preserve the original preference for empty tiles before occupied tiles without
  // allocating temporary empty/occupied arrays for every recursive search.
  for (let occupancyPass = 0; occupancyPass < 2; occupancyPass++) {
    const seekOccupied = occupancyPass === 1

    for (const coordinate of possibleMoves) {
      const packedCoordinate = packCoordinate(coordinate)
      const occupantCode = occupancy[packedCoordinate]
      const isOccupied = occupantCode !== EMPTY

      if (isOccupied !== seekOccupied) {
        continue
      }

      // Score changes belong to this branch only. A failed branch must not affect
      // later candidate branches from the same creep.
      let nextScore = score

      if (getIntendedPackedCoordinate(creep) === packedCoordinate) {
        nextScore += getMoveScore(creep)
      }

      if (!isOccupied) {
        if (nextScore > 0) {
          assignCreepToCoordinate(creepIndex, packedCoordinate, occupancy, matchedCoordinates)
        }
        return nextScore
      }

      const occupyingCreepIndex = occupantCode - 1

      if (visitedAtSearch[occupyingCreepIndex] === searchId) {
        continue
      }

      const occupyingCreep = creeps[occupyingCreepIndex]

      if (getIntendedPackedCoordinate(occupyingCreep) === packedCoordinate) {
        nextScore -= getMoveScore(occupyingCreep)
      }

      const result = depthFirstSearch(
        occupyingCreepIndex,
        nextScore,
        searchId,
        creeps,
        terrain,
        costs,
        movementCostThreshold,
        occupancy,
        matchedCoordinates,
        visitedAtSearch,
      )

      if (result > 0) {
        assignCreepToCoordinate(creepIndex, packedCoordinate, occupancy, matchedCoordinates)
        return result
      }
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
  const workingArea = getWorkingArea(creep)

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

function resolveMovement(creep: TrafficCreep, matchedPackedCoordinate: number): void {
  if (matchedPackedCoordinate === UNASSIGNED) {
    return
  }

  const matchedPosition = unpackCoordinate(matchedPackedCoordinate)

  if (!creep.pos.isEqualTo(matchedPosition.x, matchedPosition.y)) {
    creep.move(creep.pos.getDirectionTo(matchedPosition.x, matchedPosition.y))
  }
}

function assignCreepToCoordinate(
  creepIndex: number,
  packedCoordinate: number,
  occupancy: Int16Array,
  matchedCoordinates: Int16Array,
): void {
  matchedCoordinates[creepIndex] = packedCoordinate
  occupancy[packedCoordinate] = creepIndex + 1
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

function getMoveScore(creep: TrafficCreep): number {
  return creep._moveScore ?? 1
}

function getIntendedPackedCoordinate(creep: TrafficCreep): number | undefined {
  return creep._intendedPackedCoord
}

function getNameHash(name: string): number {
  let hash = 0

  for (let index = 0; index < name.length; index++) {
    hash += name.charCodeAt(index)
  }

  return hash
}

function packCoordinate(coordinate: Coordinate): number {
  return ROOM_SIZE * coordinate.y + coordinate.x
}

function unpackCoordinate(packedCoordinate: number): Coordinate {
  const x = packedCoordinate % ROOM_SIZE

  return {
    x,
    y: (packedCoordinate - x) / ROOM_SIZE,
  }
}
