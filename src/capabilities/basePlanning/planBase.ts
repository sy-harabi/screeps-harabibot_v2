import { distanceTransform } from "../../world/map/distanceTransform";
import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate";
import { fromRoomIndex, ROOM_AREA } from "../../world/map/roomGrid";
import {
  findTerrainRegions,
  TerrainRegion,
} from "../../world/map/terrainRegions";
import type { BasePlan, PlannedStructure } from "./basePlan";
import { classifyDefensiveTiles } from "./classifyDefensiveTiles";
import {
  ControllerAreaCandidate,
  findControllerAreaCandidates,
} from "./findControllerAreaCandidates";
import { CorePlan, findCorePlans } from "./findCorePlans";
import { planLabs } from "./planLabs";
import { planOuterRampartRoads } from "./planOuterRampartRoads";
import { planOuterRamparts } from "./planOuterRamparts";
import { planResourceTree } from "./planResourceTree";
import { planStructureSlots } from "./planStructureSlots";
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

  // visualizeSelectedRegions(selectedRegionIds, regions, visual);

  const outerRampartPlan = planOuterRamparts(
    terrain,
    controller,
    selectedRegionIds,
    regionByTile,
    visual,
  );

  if (!outerRampartPlan) {
    return;
  }

  const defensiveTiles = classifyDefensiveTiles(outerRampartPlan, visual);

  // From this point on, the min-cut result is the source of truth for the
  // buildable base interior. The original terrain-region selection is only an
  // input to outer-rampart planning and must not constrain downstream plans.
  const safePlanningMask = buildSafePlanningMask(
    outerRampartPlan.insideMask,
    defensiveTiles.dangerousMask,
    defensiveTiles.repairMask,
  );

  const planningCenter = getMaskCenter(outerRampartPlan.insideMask);

  const controllerAreaCandidates = findControllerAreaCandidates(
    controller,
    safePlanningMask,
  );

  let bestTier = Infinity;
  let bestDistance = Infinity;
  let bestCorePlan: CorePlan | undefined;
  let bestControllerArea: ControllerAreaCandidate | undefined;

  for (const controllerAreaCandidate of controllerAreaCandidates) {
    if (controllerAreaCandidate.tier > bestTier) {
      continue;
    }

    const corePlans = findCorePlans(controllerAreaCandidate, safePlanningMask);

    for (const corePlan of corePlans) {
      const candidateDistance = getRange(corePlan.firstSpawn, planningCenter);
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
  visual.structure(
    bestCorePlan.factory.x,
    bestCorePlan.factory.y,
    STRUCTURE_FACTORY,
  );
  visual.structure(
    bestCorePlan.powerSpawn.x,
    bestCorePlan.powerSpawn.y,
    STRUCTURE_POWER_SPAWN,
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

  const rampartRoadPlan = planOuterRampartRoads(
    terrain,
    controller,
    sources,
    minerals,
    outerRampartPlan,
    bestControllerArea,
    bestCorePlan,
    resourceTree,
    visual,
  );

  if (!rampartRoadPlan) {
    return;
  }

  const labPlan = planLabs(
    terrain,
    controller,
    sources,
    minerals,
    safePlanningMask,
    bestControllerArea,
    bestCorePlan,
    resourceTree,
    rampartRoadPlan,
    visual,
  );

  if (!labPlan) {
    return;
  }

  // Run the complete slot planner, including branch generation, inside the
  // safe planning space first. Dangerous and repair tiles are relaxed only if
  // that whole attempt cannot reach the required slot quota.
  let slotPlan = planStructureSlots(
    terrain,
    safePlanningMask,
    bestControllerArea,
    bestCorePlan,
    resourceTree,
    rampartRoadPlan,
    labPlan,
    visual,
  );

  if (!slotPlan) {
    return;
  }

  if (!slotPlan) {
    slotPlan = planStructureSlots(
      terrain,
      outerRampartPlan.insideMask,
      bestControllerArea,
      bestCorePlan,
      resourceTree,
      rampartRoadPlan,
      labPlan,
      visual,
    );
  }

  if (!slotPlan) {
    return;
  }

  Game.map.visual.text("SUCCESS", new RoomPosition(25, 25, roomName));

  visual.connectRoads();

  const structures: PlannedStructure[] = [];
  const anchor = { x: 25, y: 25 };

  return { version: 1, roomName, anchor, structures };
}

function buildSafePlanningMask(
  insideMask: Uint8Array,
  dangerousMask: Uint8Array,
  repairMask: Uint8Array,
): Uint8Array {
  const result = insideMask.slice();

  for (let index = 0; index < ROOM_AREA; index++) {
    if (dangerousMask[index] || repairMask[index]) {
      result[index] = 0;
    }
  }

  return result;
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

function getMaskCenter(mask: Uint8Array): RoomCoordinate {
  let sumX = 0;
  let sumY = 0;
  let numTiles = 0;

  for (let index = 0; index < ROOM_AREA; index++) {
    if (!mask[index]) {
      continue;
    }

    const { x, y } = fromRoomIndex(index);
    sumX += x;
    sumY += y;
    numTiles++;
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
