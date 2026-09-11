import { PriorityQueue } from "../../utils/priorityQueue";
import { RoomCoordinate } from "./roomCoordinate";
import {
  forEachCoordinateAtRange,
  fromRoomIndex,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  toRoomIndex,
} from "./roomGrid";

export function dijkstraMap(
  terrain: RoomTerrain,
  startCoordinates: readonly RoomCoordinate[],
  getCost: (x: number, y: number) => number,
  canVisit?: (x: number, y: number) => boolean,
): Int32Array {
  const distances = new Int32Array(ROOM_AREA);
  distances.fill(-1);

  const queue = new PriorityQueue<number>();

  const visted = new Uint8Array(ROOM_AREA);

  for (const coordinate of startCoordinates) {
    const index = toRoomIndex(coordinate.x, coordinate.y);

    queue.push(index, 0);
    distances[index] = 0;
  }

  while (queue.size > 0) {
    const candidate = queue.pop();

    if (candidate === undefined) {
      break;
    }

    const index = candidate;

    if (visted[index]) {
      continue;
    }

    const distance = distances[index];

    const coordinate = fromRoomIndex(index);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborX = coordinate.x + offset.x;
      const neighborY = coordinate.y + offset.y;

      if (canVisit && !canVisit(neighborX, neighborY)) {
        continue;
      }

      const cost = getCost(neighborX, neighborY);

      const nextDistance = distance + cost;

      const neighborIndex = toRoomIndex(neighborX, neighborY);

      if (
        distances[neighborIndex] !== -1 &&
        nextDistance >= distances[neighborIndex]
      ) {
        continue;
      }

      distances[neighborIndex] = nextDistance;

      queue.push(index, -nextDistance);
    }
  }

  return distances;
}
