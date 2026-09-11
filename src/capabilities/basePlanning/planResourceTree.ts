import { dijkstraMap } from "../../world/map/dijkstraMap";
import { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  forEachCoordinateAtRange,
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";
import { ControllerAreaCandidate } from "./findControllerAreaCandidates";
import { CorePlan } from "./findCorePlans";

export function planResourceTree(
  terrain: RoomTerrain,
  controller: StructureController,
  sources: Source[],
  minerals: Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  visual: RoomVisual,
) {
  const blockedMap = new Uint8Array(ROOM_AREA);

  blockedMap[toRoomIndex(controllerArea.storage.x, controllerArea.storage.y)] =
    1;

  for (const chain of Object.values(controllerArea.upgradeChains)) {
    chain.forEach((tile: RoomCoordinate) => {
      blockedMap[toRoomIndex(tile.x, tile.y)] = 1;
    });
  }

  blockedMap[toRoomIndex(corePlan.firstSpawn.x, corePlan.firstSpawn.y)] = 1;

  blockedMap[toRoomIndex(corePlan.terminal.x, corePlan.terminal.y)] = 1;

  blockedMap[toRoomIndex(corePlan.link.x, corePlan.link.y)] = 1;

  blockedMap[toRoomIndex(corePlan.manager.x, corePlan.manager.y)] = 1;

  const distanceMap = dijkstraMap(
    terrain,
    corePlan.roads,
    (x, y, terrainType) => {
      if (terrainType === TERRAIN_MASK_SWAMP) {
        return 6;
      }

      return 5;
    },
    (x, y) => {
      if (blockedMap[toRoomIndex(x, y)] === 1) {
        return false;
      }

      return true;
    },
  );

  // for (let index = 0; index < ROOM_AREA; index++) {
  //   const coordinate = fromRoomIndex(index);

  //   if (distanceMap[index] > 0) {
  //     visual.text(distanceMap[index] + "", coordinate.x, coordinate.y, {
  //       font: 0.5,
  //       stroke: "black",
  //     });
  //   }
  // }

  const resourcePathMask = new Uint8Array(ROOM_AREA);
  const targetMask = new Uint8Array(ROOM_AREA);

  let resourceBit = 1;

  for (const coordinate of [...sources, ...minerals].map((obj) => obj.pos)) {
    let targetCoordinates: RoomCoordinate[] = [];

    let minDistance = Infinity;

    forEachCoordinateAtRange(coordinate, 1, (x, y) => {
      const distance = distanceMap[toRoomIndex(x, y)];

      if (distance < 0) {
        return;
      }

      if (distance < minDistance) {
        minDistance = distance;
        targetCoordinates = [{ x, y }];
      } else if (distance === minDistance) {
        targetCoordinates.push({ x, y });
      }
    });

    for (const target of targetCoordinates) {
      targetMask[toRoomIndex(target.x, target.y)] |= resourceBit;
    }

    const pathMask = buildShortestPathMask(
      targetCoordinates,
      terrain,
      distanceMap,
      (x, y, terrainType) => {
        if (terrainType === TERRAIN_MASK_WALL) {
          return -1;
        }

        if (terrainType === TERRAIN_MASK_SWAMP) {
          return 6;
        }

        return 5;
      },
    );

    for (let index = 0; index < ROOM_AREA; index++) {
      const coordinate = fromRoomIndex(index);

      if (pathMask[index] > 0) {
        resourcePathMask[index] |= resourceBit;
        visual.text(resourcePathMask[index] + "", coordinate.x, coordinate.y, {
          font: 0.5,
          stroke: "black",
        });
      }
    }

    resourceBit <<= 1;
  }
}

function buildShortestPathMask(
  targetCoordinates: RoomCoordinate[],
  terrain: RoomTerrain,
  distanceMap: Int32Array,
  getCost: (x: number, y: number, terrainType: number) => number,
): Uint8Array {
  const mask = new Uint8Array(ROOM_AREA);
  const queue: number[] = [];

  for (const target of targetCoordinates) {
    const index = toRoomIndex(target.x, target.y);

    mask[index] = 1;
    queue.push(index);
  }

  let queueHead = 0;

  while (queueHead < queue.length) {
    const index = queue[queueHead];
    queueHead++;
    const current = fromRoomIndex(index);
    const currentDistance = distanceMap[index];

    if (currentDistance === 0) {
      continue;
    }

    const terrainType = terrain.get(current.x, current.y);
    const currentCost = getCost(current.x, current.y, terrainType);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborX = current.x + offset.x;
      const neighborY = current.y + offset.y;

      if (!isInsideRoom(neighborX, neighborY)) {
        continue;
      }

      const neighborIndex = toRoomIndex(neighborX, neighborY);

      if (distanceMap[neighborIndex] < 0) {
        continue;
      }

      if (mask[neighborIndex]) {
        continue;
      }

      if (distanceMap[neighborIndex] + currentCost !== currentDistance) {
        continue;
      }

      mask[neighborIndex] = 1;
      queue.push(neighborIndex);
    }
  }

  return mask;
}
