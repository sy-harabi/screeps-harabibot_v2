import { findMinimumTileCut } from "../../world/map/minCut";
import type { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";

export interface OuterRampartPlan {
  readonly ramparts: RoomCoordinate[];
  readonly rampartMask: Uint8Array;
  readonly insideMask: Uint8Array;
  readonly outsideMask: Uint8Array;
}

/**
 * Converts the selected terrain regions into the actual outer defensive line.
 *
 * The selected area is eroded by one traversable tile and the remaining
 * interior is protected by a minimum tile cut against the walkable fringe
 * immediately outside the selected regions. This keeps the cut near the
 * selected-region boundary while allowing walls and narrow boundary geometry
 * to shorten the rampart line.
 */
export function planOuterRamparts(
  terrain: RoomTerrain,
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
  const sinkMask = buildOuterFringeMask(terrain, selectedMask);

  const result = findMinimumTileCut(terrain, sourceMask, sinkMask);

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
 * Walkable non-selected tiles touching the selected area are sufficient sinks:
 * every path leaving the selected regions must enter this fringe first.
 */
function buildOuterFringeMask(
  terrain: RoomTerrain,
  selectedMask: Uint8Array,
): Uint8Array {
  const sinkMask = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    if (!selectedMask[index]) {
      continue;
    }

    const coordinate = fromRoomIndex(index);

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = coordinate.x + offset.x;
      const y = coordinate.y + offset.y;

      if (!isInsideRoom(x, y)) {
        continue;
      }

      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        continue;
      }

      const neighborIndex = toRoomIndex(x, y);

      if (!selectedMask[neighborIndex]) {
        sinkMask[neighborIndex] = 1;
      }
    }
  }

  return sinkMask;
}
