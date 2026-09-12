import { distanceTransform } from "../../world/map/distanceTransform";
import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate";
import { fromRoomIndex } from "../../world/map/roomGrid";
import {
  findTerrainRegions,
  TerrainRegion,
} from "../../world/map/terrainRegions";
import type { BasePlan, PlannedStructure } from "./basePlan";
import {
  ControllerAreaCandidate,
  findControllerAreaCandidates,
} from "./findControllerAreaCandidates";
import { CorePlan, findCorePlans } from "./findCorePlans";
import {
  findRegionBoundaryComponents,
  RegionBoundaryComponent,
} from "./findRegionBoundaryComponents";
import { planLabs } from "./planLabs";
import { planResourceTree } from "./planResourceTree";
import { selectBaseRegions } from "./selectBaseRegions";

/**
 * Base planner entry point for the Screeps runtime.
 */
export function planBase(
  roomName: string,
  terrain: RoomTerrain,
  controller: StructureController,
  sources: Source[],
  minerals: Mineral[],
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

  const boundaryComponents = findRegionBoundaryComponents(
    selectedRegionIds,
    regionByTile,
  );

  visualizeRegionBoundaryComponents(boundaryComponents, visual);

  const selectedCenter = getSelectedRegionCenter(selectedRegionIds, regions);

  const controllerAreaCandidates = findControllerAreaCandidates(
    controller,
    selectedRegionIds,
    regionByTile,
  );

  let bestTier = Infinity;
  let bestDistance = Infinity;
  let bestCorePlan: CorePlan | undefined;
  let bestControllerArea: ControllerAreaCandidate | undefined;

  for (const controllerAreaCandidate of controllerAreaCandidates) {
    if (controllerAreaCandidate.tier > bestTier) {
      continue;
    }

    const corePlans = findCorePlans(
      controllerAreaCandidate,
      selectedRegionIds,
      regionByTile,
    );

    for (const corePlan of corePlans) {
      const candidateDistance = getRange(corePlan.firstSpawn, selectedCenter);
      if (
        controllerAreaCandidate.tier < bestTier ||
        candidateDistance < bestDistance
      ) {
        bestTier = controllerAreaCandidate.tier;
        bestDistance = candidateDistance;
        bestCorePlan = corePlan;
        bestControllerArea = controllerAreaCandidate;
      }
    }
  }

  if (!bestCorePlan || !bestControllerArea) {
    return;
  }

  visual.structure(
    bestControllerArea.storage.x,
    bestControllerArea.storage.y,
    STRUCTURE_STORAGE,
  );

  for (const chain of Object.values(bestControllerArea.upgradeChains)) {
    visualizeUpgradePath(visual, chain, "", "#ffd166");
  }

  visual.text("M", bestCorePlan.manager.x, bestCorePlan.manager.y);
  visual.structure(
    bestCorePlan.terminal.x,
    bestCorePlan.terminal.y,
    STRUCTURE_TERMINAL,
  );
  visual.structure(bestCorePlan.link.x, bestCorePlan.link.y, STRUCTURE_LINK);
  visual.structure(
    bestCorePlan.firstSpawn.x,
    bestCorePlan.firstSpawn.y,
    STRUCTURE_SPAWN,
  );

  bestCorePlan.roads.forEach((road) =>
    visual.structure(road.x, road.y, STRUCTURE_ROAD),
  );

  const resourceTree = planResourceTree(
    terrain,
    sources,
    minerals,
    bestControllerArea,
    bestCorePlan,
    visual,
  );

  if (resourceTree === undefined) {
    return;
  }

  const labPlan = planLabs(
    terrain,
    controller,
    sources,
    minerals,
    selectedRegionIds,
    regionByTile,
    bestControllerArea,
    bestCorePlan,
    resourceTree,
    visual,
  );

  if (!labPlan) {
    return;
  }

  Game.map.visual.text("SUCCESS", new RoomPosition(25, 25, roomName));

  visual.connectRoads();

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

function visualizeRegionBoundaryComponents(
  components: readonly RegionBoundaryComponent[],
  visual: RoomVisual,
): void {
  components.forEach((component, index) => {
    const color = getRegionColor(index, components.length);

    for (const tileIndex of component.tileIndices) {
      const { x, y } = fromRoomIndex(tileIndex);
      visual.circle(x, y, {
        radius: 0.18,
        fill: color,
        opacity: 0.9,
        stroke: "transparent",
      });
    }

    const { x, y } = component.representativeTile;

    visual.circle(x, y, {
      radius: 0.38,
      fill: "transparent",
      stroke: "#ffffff",
      strokeWidth: 0.08,
      opacity: 1,
    });

    visual.text(`B${index}`, x, y - 0.45, {
      color: "#ffffff",
      font: 0.35,
      stroke: "black",
    });
  });
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
