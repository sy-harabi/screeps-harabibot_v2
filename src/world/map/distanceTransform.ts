import { isInsideRoom, ROOM_AREA, ROOM_SIZE, toRoomIndex } from "./roomGrid";

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

/**
 * Computes the Chebyshev distance to the nearest terrain wall within the room.
 * Diagonal and cardinal steps both count as one; plains and swamps are treated alike.
 * Positions outside the room are ignored, so exits are not treated as walls.
 *
 * @returns A new array indexed by `y * ROOM_SIZE + x`. Wall tiles have distance 0;
 * all tiles have distance 255 if the room contains no walls.
 */
export function distanceTransform(terrain: RoomTerrain): Uint8Array {
  const distances = new Uint8Array(ROOM_AREA);

  for (let x = 0; x <= ROOM_SIZE - 1; x++) {
    for (let y = 0; y <= ROOM_SIZE - 1; y++) {
      const index = toRoomIndex(x, y);

      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        distances[index] = 0;
        continue;
      }

      distances[index] = 255;
    }
  }

  for (let x = 0; x <= ROOM_SIZE - 1; x++) {
    for (let y = 0; y <= ROOM_SIZE - 1; y++) {
      const index = toRoomIndex(x, y);
      let minDistance = distances[index];

      for (const offset of FORWARD_OFFSETS) {
        const neighborX = x + offset.x;
        const neighborY = y + offset.y;

        if (!isInsideRoom(neighborX, neighborY)) {
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

        if (!isInsideRoom(neighborX, neighborY)) {
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
