import { RoomCoordinate } from "../../world/map/roomCoordinate";
import { ROOM_AREA, ROOM_SIZE, toRoomIndex } from "../../world/map/roomGrid";

const FORWARD_OFFSETS = [
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: -1 },
  { x: -1, y: 1 },
];

const BACKWARD_OFFSETS = [
  { x: 1, y: 0 },
  { x: 0, y: +1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
];

export const NEIGHBOR_OFFSETS: readonly RoomCoordinate[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

/**
 * Computes the Chebyshev distance to the nearest terrain wall within the room.
 * Diagonal and cardinal steps both count as one; plains and swamps are treated alike.
 * Positions outside the room are ignored, so exits are not treated as walls.
 *
 * @returns A new array indexed by `y * ROOM_SIZE + x`. Wall tiles have distance 0;
 * all tiles have distance 255 if the room contains no walls.
 */
export function distanceTransformForBasePlanning(
  terrain: RoomTerrain,
): Uint8Array {
  const distances = new Uint8Array(ROOM_AREA);

  distances.fill(255);

  for (let x = 0; x <= ROOM_SIZE - 1; x++) {
    for (const y of [0, ROOM_SIZE - 1]) {
      markNeighborsAsWall(distances, terrain, x, y);
    }
  }

  for (let y = 1; y <= ROOM_SIZE - 2; y++) {
    for (const x of [0, ROOM_SIZE - 1]) {
      markNeighborsAsWall(distances, terrain, x, y);
    }
  }

  for (let x = 0; x <= ROOM_SIZE - 1; x++) {
    for (let y = 0; y <= ROOM_SIZE - 1; y++) {
      const index = toRoomIndex(x, y);

      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        distances[index] = 0;
        continue;
      }
    }
  }

  for (let x = 0; x <= ROOM_SIZE - 1; x++) {
    for (let y = 0; y <= ROOM_SIZE - 1; y++) {
      const index = toRoomIndex(x, y);
      let minDistance = distances[index];

      for (const offset of FORWARD_OFFSETS) {
        const neighborX = x + offset.x;
        const neighborY = y + offset.y;

        if (
          neighborX < 0 ||
          neighborX >= ROOM_SIZE ||
          neighborY < 0 ||
          neighborY >= ROOM_SIZE
        ) {
          continue;
        }

        const neighborIndex = toRoomIndex(neighborX, neighborY);

        const candidateDistance = distances[neighborIndex] + 1;
        if (candidateDistance < minDistance) {
          minDistance = candidateDistance;
        }
      }

      distances[index] = minDistance;
    }
  }

  for (let x = ROOM_SIZE - 1; x >= 0; x--) {
    for (let y = ROOM_SIZE - 1; y >= 0; y--) {
      const index = toRoomIndex(x, y);
      let minDistance = distances[index];

      for (const offset of BACKWARD_OFFSETS) {
        const neighborX = x + offset.x;
        const neighborY = y + offset.y;

        if (
          neighborX < 0 ||
          neighborX >= ROOM_SIZE ||
          neighborY < 0 ||
          neighborY >= ROOM_SIZE
        ) {
          continue;
        }

        const neighborIndex = toRoomIndex(neighborX, neighborY);
        const candidateDistance = distances[neighborIndex] + 1;
        if (candidateDistance < minDistance) {
          minDistance = candidateDistance;
        }
      }

      distances[index] = minDistance;
    }
  }

  return distances;
}

function markNeighborsAsWall(
  distances: Uint8Array,
  terrain: RoomTerrain,
  x: number,
  y: number,
) {
  const index = toRoomIndex(x, y);

  distances[index] = 0;

  if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
    return;
  }

  distances[index] = 0;

  for (const offset of NEIGHBOR_OFFSETS) {
    const neighborX = x + offset.x;
    const neighborY = y + offset.y;

    if (
      neighborX < 0 ||
      neighborX >= ROOM_SIZE ||
      neighborY < 0 ||
      neighborY >= ROOM_SIZE
    ) {
      continue;
    }

    const neighborIndex = toRoomIndex(neighborX, neighborY);

    distances[neighborIndex] = 0;
  }
}
