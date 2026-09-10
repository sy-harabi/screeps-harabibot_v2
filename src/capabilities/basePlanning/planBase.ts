import { distanceTransform } from "../../world/map/distanceTransform";
import { RoomCoordinate } from "../../world/map/roomCoordinate";
import { fromRoomIndex } from "../../world/map/roomGrid";
import {
  findTerrainRegions,
  TerrainRegion,
} from "../../world/map/terrainRegions";
import type { BasePlan, PlannedStructure } from "./basePlan";
import { planControllerArea } from "./planControllerArea";
import { planCore } from "./planCore";
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
): BasePlan | undefined {
  const distances = distanceTransform(terrain);

  const { regionByTile, regions } = findTerrainRegions(terrain, distances);

  const visual = new RoomVisual(roomName);

  const selectedRegionIds = selectBaseRegions(
    controller,
    regionByTile,
    regions,
  );

  visualizeSelectedRegions(selectedRegionIds, regions, visual);

  const selectedCenter = getSelectedRegionCenter(selectedRegionIds, regions);

  const controllerArea = planControllerArea(
    controller,
    selectedRegionIds,
    regionByTile,
    selectedCenter,
  );

  if (!controllerArea) {
    return;
  }

  visual.text("T", controllerArea.terminal.x, controllerArea.terminal.y);

  for (const chain of Object.values(controllerArea.upgradeChains)) {
    visualizeUpgradePath(visual, chain, "", "#ffd166");
  }

  const corePlan = planCore(
    controller,
    controllerArea?.terminal,
    controllerArea?.upgradeChains,
    selectedRegionIds,
    regionByTile,
    selectedCenter,
  );

  if (!corePlan) {
    return;
  }

  visual.text("M", corePlan.manager.x, corePlan.manager.y);
  visual.text("S", corePlan.storage.x, corePlan.storage.y);
  visual.text("A", corePlan.access.x, corePlan.access.y);

  corePlan.accessRoads.forEach((r) =>
    visual.structure(r.x, r.y, STRUCTURE_ROAD),
  );

  const structures: PlannedStructure[] = [];
  const anchor = { x: 25, y: 25 };

  return { version: 1, roomName, anchor, structures };
}

function visualizeSelectedRegions(
  selectedRegionIds: Set<number>,
  regions: readonly TerrainRegion[],
  visual: RoomVisual,
) {
  for (const region of regions) {
    if (selectedRegionIds.has(region.id)) {
      region.tileIndices.forEach((index) => {
        const { x, y } = fromRoomIndex(index);

        const color = getRegionColor(region.id, regions.length);
        visual.rect(x - 0.5, y - 0.5, 1, 1, {
          fill: color,
          opacity: 0.3,
          stroke: "transparent",
        });
      });
    }
  }
}

function getSelectedRegionCenter(
  selectedRegionIds: Set<number>,
  regions: readonly TerrainRegion[],
): RoomCoordinate {
  let sumX = 0;
  let sumY = 0;
  let numTiles = 0;

  for (const region of regions) {
    if (!selectedRegionIds.has(region.id)) {
      continue;
    }

    for (const index of region.tileIndices) {
      const { x, y } = fromRoomIndex(index);

      sumX += x;
      sumY += y;
      numTiles++;
    }
  }

  return {
    x: Math.round(sumX / numTiles),
    y: Math.round(sumY / numTiles),
  };
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
