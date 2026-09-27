import type { RoomCoordinate } from "../../world/map/roomCoordinate"
import { forEachCoordinateAtRange } from "../../world/map/roomGrid"

export function getMiningPositions(
  roomName: string,
  coordinate: RoomCoordinate,
  path: readonly RoomPosition[],
): RoomPosition[] {
  const primary = path[path.length - 1]

  if (primary === undefined) {
    return []
  }

  const positions = [primary]
  const terrain = Game.map.getRoomTerrain(roomName)

  forEachCoordinateAtRange(coordinate, 1, (x, y) => {
    if (primary.x === x && primary.y === y) {
      return
    }

    if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
      return
    }

    positions.push(new RoomPosition(x, y, roomName))
  })

  return positions
}

export function getSourceContainer(path: readonly RoomPosition[]): StructureContainer | undefined {
  const pos = path[path.length - 1]

  if (pos === undefined || Game.rooms[pos.roomName] === undefined) {
    return
  }

  return pos
    .lookFor(LOOK_STRUCTURES)
    .find((structure): structure is StructureContainer => structure.structureType === STRUCTURE_CONTAINER)
}
