import { floodFill } from "../../world/map/floodFill";
import { findMinimumTileCut } from "../../world/map/minCut";
import type { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  forEachCoordinateAtRange,
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  ROOM_SIZE,
  toRoomIndex,
} from "../../world/map/roomGrid";

const BASE_RAMPART_COST = 10;
const EXIT_SINK_RANGE = 1;
const MAX_RAMPART_DISTANCE = 5;

export interface OuterRampartPlan {
  readonly ramparts: RoomCoordinate[];
  readonly rampartMask: Uint8Array;
  readonly insideMask: Uint8Array;
  readonly outsideMask: Uint8Array;
}

/**
 * Converts the selected terrain regions into the actual outer defensive line.
 *
 * The selected area is eroded by one traversable tile and protected from the
 * room exits and a fixed-distance frontier around the selected regions. Cut
 * cost increases with 8-directional walk distance from the controller,
 * preferring ramparts that are faster to reinforce and repair within that
 * maximum distance.
 */
export function planOuterRamparts(
  terrain: RoomTerrain,
  controller: StructureController,
  selectedRegionIds: ReadonlySet<number>,
  regionByTile: Int16Array,
  visual: RoomVisual,
): OuterRampartPlan | undefined {
  const selectedMask = buildSelectedRegionMask(
    terrain,
    selectedRegionIds,
    regionByTile,
  );
  const sourceMask = shrinkSelectedRegion(terrain, selectedMask);
  const sinkMask = buildExitSinkMask(terrain);
  addRegionDistanceSinks(terrain, selectedMask, sinkMask);
  const tileCosts = buildControllerDistanceCosts(terrain, controller.pos);

  const result = findMinimumTileCut(terrain, sourceMask, sinkMask, tileCosts);

  if (!result || result.cuts.length === 0) {
    return;
  }

  for (const rampart of result.cuts) {
    visual.structure(rampart.x, rampart.y, STRUCTURE_RAMPART);
  }

  return {
    ramparts: result.cuts,
    rampartMask: result.cutMask,
    insideMask: result.insideMask,
    outsideMask: result.outsideMask,
  };
}

function buildSelectedRegionMask(
  terrain: RoomTerrain,
  selectedRegionIds: ReadonlySet<number>,
  regionByTile: Int16Array,
): Uint8Array {
  const selectedMask = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    if (!selectedRegionIds.has(regionByTile[index])) {
      continue;
    }

    const { x, y } = fromRoomIndex(index);

    if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
      continue;
    }

    selectedMask[index] = 1;
  }

  return selectedMask;
}

/**
 * One-tile erosion against traversable non-selected space. Terrain walls do
 * not consume the defensive margin because they already block movement.
 */
function shrinkSelectedRegion(
  terrain: RoomTerrain,
  selectedMask: Uint8Array,
): Uint8Array {
  const sourceMask = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    if (!selectedMask[index]) {
      continue;
    }

    const coordinate = fromRoomIndex(index);
    let survivesShrink = true;

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = coordinate.x + offset.x;
      const y = coordinate.y + offset.y;

      if (!isInsideRoom(x, y)) {
        survivesShrink = false;
        break;
      }

      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        continue;
      }

      if (!selectedMask[toRoomIndex(x, y)]) {
        survivesShrink = false;
        break;
      }
    }

    if (survivesShrink) {
      sourceMask[index] = 1;
    }
  }

  return sourceMask;
}

/**
 * Treat each walkable room exit and its range-1 interior as sink territory so
 * the minimum cut cannot settle directly on the room border.
 */
function buildExitSinkMask(terrain: RoomTerrain): Uint8Array {
  const sinkMask = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    const { x, y } = fromRoomIndex(index);

    if (x !== 0 && x !== ROOM_SIZE - 1 && y !== 0 && y !== ROOM_SIZE - 1) {
      continue;
    }

    if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
      continue;
    }

    for (let dy = -EXIT_SINK_RANGE; dy <= EXIT_SINK_RANGE; dy++) {
      for (let dx = -EXIT_SINK_RANGE; dx <= EXIT_SINK_RANGE; dx++) {
        const sinkX = x + dx;
        const sinkY = y + dy;

        if (!isInsideRoom(sinkX, sinkY)) {
          continue;
        }

        if (terrain.get(sinkX, sinkY) === TERRAIN_MASK_WALL) {
          continue;
        }

        sinkMask[toRoomIndex(sinkX, sinkY)] = 1;
      }
    }
  }

  return sinkMask;
}

/**
 * Adds the walkable frontier exactly MAX_RAMPART_DISTANCE flood-fill steps
 * away from the selected regions as sink territory. This constrains the cut to
 * remain within that distance without replacing the existing room-exit sinks.
 */
function addRegionDistanceSinks(
  terrain: RoomTerrain,
  selectedMask: Uint8Array,
  sinkMask: Uint8Array,
): void {
  const startCoordinates: RoomCoordinate[] = [];

  for (let index = 0; index < ROOM_AREA; index++) {
    if (selectedMask[index]) {
      startCoordinates.push(fromRoomIndex(index));
    }
  }

  const { distances } = floodFill(terrain, startCoordinates);

  for (let index = 0; index < ROOM_AREA; index++) {
    if (distances[index] === MAX_RAMPART_DISTANCE) {
      sinkMask[index] = 1;
    }
  }
}

/**
 * Rampart capacity is its base construction/maintenance cost plus the number
 * of 8-directional flood-fill steps from the controller. Swamps intentionally
 * have no extra weight: this distance approximates reinforcement travel time
 * rather than road construction cost.
 */
function buildControllerDistanceCosts(
  terrain: RoomTerrain,
  controller: RoomCoordinate,
): Uint16Array {
  const startCoordinates: RoomCoordinate[] = [];

  forEachCoordinateAtRange(controller, 1, (x, y) => {
    startCoordinates.push({ x, y });
  });
  const { distances } = floodFill(terrain, startCoordinates);

  const tileCosts = new Uint16Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    const distance = distances[index];

    tileCosts[index] =
      BASE_RAMPART_COST + (distance >= 0 ? distance : ROOM_SIZE);
  }

  return tileCosts;
}
