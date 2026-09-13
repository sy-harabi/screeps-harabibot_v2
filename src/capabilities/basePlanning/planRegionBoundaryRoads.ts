import { dijkstraMap } from "../../world/map/dijkstraMap";
import type { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";
import type { ControllerAreaCandidate } from "./findControllerAreaCandidates";
import type { CorePlan } from "./findCorePlans";
import type { RegionBoundaryComponent } from "./findRegionBoundaryComponents";
import type { ResourceTreePlan } from "./planResourceTree";

export interface RegionBoundaryRoadPlan {
  readonly roads: RoomCoordinate[];
}

interface BoundaryTarget {
  readonly componentIndex: number;
  readonly coordinate: RoomCoordinate;
  readonly distance: number;
}

export function planRegionBoundaryRoads(
  terrain: RoomTerrain,
  components: readonly RegionBoundaryComponent[],
  selectedRegionIds: ReadonlySet<number>,
  regionByTile: Int16Array,
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  visual: RoomVisual,
): RegionBoundaryRoadPlan | undefined {
  const roadMask = new Uint8Array(ROOM_AREA);

  for (const { x, y } of [...corePlan.roads, ...resourceTree.roads]) {
    roadMask[toRoomIndex(x, y)] = 1;
  }

  const upgradeChainCostMap = buildUpgradeChainCostMap(controllerArea);
  const remainingComponents = components.map((_, index) => index);
  const roads: RoomCoordinate[] = [];

  while (remainingComponents.length > 0) {
    const distanceMap = buildBoundaryDistanceMap(
      terrain,
      selectedRegionIds,
      regionByTile,
      corePlan,
      resourceTree,
      upgradeChainCostMap,
      roadMask,
    );

    const target = findClosestBoundaryTarget(
      components,
      remainingComponents,
      distanceMap,
    );

    if (!target) {
      return;
    }

    const path = tracePathToExistingRoad(
      terrain,
      target.coordinate,
      distanceMap,
      upgradeChainCostMap,
      roadMask,
    );

    if (!path) {
      return;
    }

    for (const coordinate of path) {
      const index = toRoomIndex(coordinate.x, coordinate.y);

      if (roadMask[index]) {
        continue;
      }

      roadMask[index] = 1;
      roads.push(coordinate);
      visual.structure(coordinate.x, coordinate.y, STRUCTURE_ROAD);
    }

    const remainingIndex = remainingComponents.indexOf(target.componentIndex);
    remainingComponents.splice(remainingIndex, 1);
  }

  return { roads };
}

function buildBoundaryDistanceMap(
  terrain: RoomTerrain,
  selectedRegionIds: ReadonlySet<number>,
  regionByTile: Int16Array,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  upgradeChainCostMap: Int16Array,
  roadMask: Uint8Array,
): Int32Array {
  return dijkstraMap(
    terrain,
    corePlan.roads,
    (x, y, terrainType) =>
      getBoundaryRoadCost(
        toRoomIndex(x, y),
        terrainType,
        upgradeChainCostMap,
        roadMask,
      ),
    (x, y) => {
      const index = toRoomIndex(x, y);

      if (!selectedRegionIds.has(regionByTile[index])) {
        return false;
      }

      return (
        resourceTree.coreDistanceMap[index] >= 0 ||
        upgradeChainCostMap[index] >= 0
      );
    },
  );
}

function findClosestBoundaryTarget(
  components: readonly RegionBoundaryComponent[],
  remainingComponents: readonly number[],
  distanceMap: Int32Array,
): BoundaryTarget | undefined {
  let bestTarget: BoundaryTarget | undefined;

  for (const componentIndex of remainingComponents) {
    const component = components[componentIndex];

    for (const tileIndex of component.tileIndices) {
      const distance = distanceMap[tileIndex];

      if (distance < 0) {
        continue;
      }

      if (
        bestTarget &&
        (distance > bestTarget.distance ||
          (distance === bestTarget.distance &&
            (componentIndex > bestTarget.componentIndex ||
              (componentIndex === bestTarget.componentIndex &&
                tileIndex >=
                  toRoomIndex(
                    bestTarget.coordinate.x,
                    bestTarget.coordinate.y,
                  )))))
      ) {
        continue;
      }

      bestTarget = {
        componentIndex,
        coordinate: fromRoomIndex(tileIndex),
        distance,
      };
    }
  }

  return bestTarget;
}

function buildUpgradeChainCostMap(
  controllerArea: ControllerAreaCandidate,
): Int16Array {
  const costMap = new Int16Array(ROOM_AREA);
  costMap.fill(-1);

  const { left, middle, right } = controllerArea.upgradeChains;

  for (const chain of [left, middle, right]) {
    chain.forEach(({ x, y }, tileIndex) => {
      costMap[toRoomIndex(x, y)] = 50 - tileIndex * 5;
    });
  }

  return costMap;
}

function tracePathToExistingRoad(
  terrain: RoomTerrain,
  start: RoomCoordinate,
  distanceMap: Int32Array,
  upgradeChainCostMap: Int16Array,
  roadMask: Uint8Array,
): RoomCoordinate[] | undefined {
  let currentIndex = toRoomIndex(start.x, start.y);

  if (distanceMap[currentIndex] < 0) {
    return;
  }

  const path: RoomCoordinate[] = [];

  while (!roadMask[currentIndex]) {
    const current = fromRoomIndex(currentIndex);
    const currentDistance = distanceMap[currentIndex];

    if (currentDistance <= 0) {
      return;
    }

    path.push(current);

    const currentCost = getBoundaryRoadCost(
      currentIndex,
      terrain.get(current.x, current.y),
      upgradeChainCostMap,
      roadMask,
    );
    let bestRoadIndex = -1;
    let bestIndex = -1;

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = current.x + offset.x;
      const y = current.y + offset.y;

      if (!isInsideRoom(x, y)) {
        continue;
      }

      const neighborIndex = toRoomIndex(x, y);
      const neighborDistance = distanceMap[neighborIndex];

      if (
        neighborDistance < 0 ||
        neighborDistance + currentCost !== currentDistance
      ) {
        continue;
      }

      if (roadMask[neighborIndex]) {
        if (bestRoadIndex < 0 || neighborIndex < bestRoadIndex) {
          bestRoadIndex = neighborIndex;
        }
        continue;
      }

      if (bestIndex < 0 || neighborIndex < bestIndex) {
        bestIndex = neighborIndex;
      }
    }

    const nextIndex = bestRoadIndex >= 0 ? bestRoadIndex : bestIndex;

    if (nextIndex < 0) {
      return;
    }

    currentIndex = nextIndex;
  }

  return path;
}

function getBoundaryRoadCost(
  index: number,
  terrainType: number,
  upgradeChainCostMap: Int16Array,
  roadMask: Uint8Array,
): number {
  const upgradeChainCost = upgradeChainCostMap[index];

  if (upgradeChainCost >= 0) {
    return upgradeChainCost;
  }

  if (roadMask[index]) {
    return 3;
  }

  return terrainType === TERRAIN_MASK_SWAMP ? 6 : 5;
}
