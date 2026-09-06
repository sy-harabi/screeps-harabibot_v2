import { distanceTransform } from "../../world/map/distanceTransform";
import { fromRoomIndex, ROOM_AREA } from "../../world/map/roomGrid";
import { findTerrainRegions } from "../../world/map/terrainRegions";
import type { BasePlan, PlannedStructure } from "./basePlan";
import { selectBaseRegions } from "./selectBaseRegions";

/**
 * Base planner entry point for the Screeps runtime.
 */
export function planBase(
  roomName: string,
  terrain: RoomTerrain,
  controller: StructureController,
  sources: Source[],
  mineral: Mineral[],
): BasePlan {
  const distances = distanceTransform(terrain);

  const { regionByTile, regions } = findTerrainRegions(terrain, distances);

  const visual = new RoomVisual(roomName);

  for (let i = 0; i < ROOM_AREA; i++) {
    const regionId = regionByTile[i];

    if (i >= regionId) {
      const { x, y } = fromRoomIndex(i);

      const color = getRegionColor(regionId, regions.length);
      visual.rect(x - 0.5, y - 0.5, 1, 1, {
        fill: color,
        opacity: 0.3,
        stroke: "transparent",
      });
    }
  }

  const selectedRegionIds = selectBaseRegions(
    controller,
    regionByTile,
    regions,
  );

  for (const region of regions) {
    if (selectedRegionIds.has(region.id)) {
      region.tileIndices.forEach((index) => {
        const { x, y } = fromRoomIndex(index);
        visual.text("S", x, y);
      });
    }
  }

  const structures: PlannedStructure[] = [];
  const anchor = { x: 25, y: 25 };

  return { version: 1, roomName, anchor, structures };
}

function getRegionColor(regionId: number, regionCount: number): string {
  const hue = (regionId * 360) / regionCount;
  return `hsl(${hue}, 70%, 50%)`;
}
