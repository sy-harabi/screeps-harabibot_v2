import { distanceTransform } from "../../world/map/distanceTransform";
import { RoomCoordinate } from "../../world/map/roomCoordinate";
import { fromRoomIndex, toRoomIndex } from "../../world/map/roomGrid";
import { findTerrainRegions } from "../../world/map/terrainRegions";
import type { BasePlan, PlannedStructure } from "./basePlan";
import {
  findTerminalCandidates,
  findUpgradeRoots,
  findUpgradeTiles,
  followUpgradeWall,
  planControllerArea,
} from "./planControllerArea";
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

  const selectedRegionIds = selectBaseRegions(
    controller,
    regionByTile,
    regions,
  );

  let selectedRegionSumX = 0;
  let selectedRegionSumY = 0;
  let totalNumSelectedRegionTiles = 0;

  for (const region of regions) {
    if (selectedRegionIds.has(region.id)) {
      totalNumSelectedRegionTiles += region.tileIndices.length;

      region.tileIndices.forEach((index) => {
        const { x, y } = fromRoomIndex(index);
        selectedRegionSumX += x;
        selectedRegionSumY += y;

        const color = getRegionColor(region.id, regions.length);
        visual.rect(x - 0.5, y - 0.5, 1, 1, {
          fill: color,
          opacity: 0.3,
          stroke: "transparent",
        });
      });
    }
  }

  const selectedCenter: RoomCoordinate = {
    x: Math.round(selectedRegionSumX / totalNumSelectedRegionTiles),
    y: Math.round(selectedRegionSumY / totalNumSelectedRegionTiles),
  };

  const controllerArea = planControllerArea(
    controller,
    selectedRegionIds,
    regionByTile,
    selectedCenter,
  );

  if (controllerArea) {
    visual.text("T", controllerArea.terminal.x, controllerArea.terminal.y);

    for (const chain of Object.values(controllerArea.upgradeChains)) {
      visualizeUpgradePath(visual, chain, "", "#ffd166");
    }
  }

  const structures: PlannedStructure[] = [];
  const anchor = { x: 25, y: 25 };

  return { version: 1, roomName, anchor, structures };
}

function visualizeUpgradePath(
  visual: RoomVisual,
  path: RoomCoordinate[],
  label: string,
  color: string,
): void {
  path.forEach((coordinate, index) => {
    if (index > 0) {
      const previous = path[index - 1];
      visual.arrow(
        new RoomPosition(previous.x, previous.y, visual.roomName),
        new RoomPosition(coordinate.x, coordinate.y, visual.roomName),
        {
          color,
          opacity: 0.8,
        },
      );
    }

    visual.text(`${label}${index + 1}`, coordinate.x, coordinate.y, {
      color,
      font: 0.45,
      stroke: "black",
    });
  });
}

function getRegionColor(regionId: number, regionCount: number): string {
  const hue = (regionId * 360) / regionCount;
  return `hsl(${hue}, 70%, 50%)`;
}
