import {
  forEachCoordinateInRange,
  NEIGHBOR_OFFSETS,
  toRoomIndex,
} from "../../world/map/roomGrid";

export function selectBaseRegions(
  controller: StructureController,
  regionByTile: Int16Array,
): Set<number> {
  const selectedRegionIds = new Set<number>();

  forEachCoordinateInRange(controller.pos, 1, (x, y) => {
    const index = toRoomIndex(x, y);
    if (regionByTile[index] >= 0) {
      selectedRegionIds.add(index);
    }
  });

  return selectedRegionIds;
}
