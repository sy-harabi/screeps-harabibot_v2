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
import type { OuterRampartPlan } from "./planOuterRamparts";
import type { ResourceTreePlan } from "./planResourceTree";

export interface OuterRampartRoadPlan {
  readonly roads: RoomCoordinate[];
}

interface RampartComponent {
  readonly tileIndices: readonly number[];
}

interface RampartTarget {
  readonly componentIndex: number;
  readonly coordinate: RoomCoordinate;
  readonly distance: number;
}

export function planOuterRampartRoads(
  terrain: RoomTerrain,
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  outerRampartPlan: OuterRampartPlan,
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  visual: RoomVisual,
  existingSpawn?: RoomCoordinate,
): OuterRampartRoadPlan | undefined {
  const roadNetworkMask = new Uint8Array(ROOM_AREA);

  for (const { x, y } of [...corePlan.roads, ...resourceTree.roads]) {
    roadNetworkMask[toRoomIndex(x, y)] = 1;
  }

  const blockedMask = buildRampartRoadBlockedMask(
    controller,
    sources,
    minerals,
    controllerArea,
    corePlan,
    resourceTree,
    existingSpawn,
  );
  const upgradeChainCostMap = buildUpgradeChainCostMap(controllerArea);
  const components = findRampartComponents(outerRampartPlan.rampartMask);
  const remainingComponents = components.map((_, index) => index);
  const roads: RoomCoordinate[] = [];

  while (remainingComponents.length > 0) {
    const distanceMap = buildRampartDistanceMap(
      terrain,
      outerRampartPlan,
      corePlan,
      blockedMask,
      upgradeChainCostMap,
      roadNetworkMask,
    );

    const target = findClosestRampartTarget(
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
      roadNetworkMask,
    );

    if (!path) {
      return;
    }

    for (const coordinate of path) {
      const index = toRoomIndex(coordinate.x, coordinate.y);

      if (roadNetworkMask[index]) {
        continue;
      }

      roadNetworkMask[index] = 1;
      roads.push(coordinate);
      visual.structure(coordinate.x, coordinate.y, STRUCTURE_ROAD);
    }

    const remainingIndex = remainingComponents.indexOf(target.componentIndex);
    remainingComponents.splice(remainingIndex, 1);
  }

  return { roads };
}

function findRampartComponents(rampartMask: Uint8Array): RampartComponent[] {
  const visited = new Uint8Array(ROOM_AREA);
  const components: RampartComponent[] = [];

  for (let startIndex = 0; startIndex < ROOM_AREA; startIndex++) {
    if (!rampartMask[startIndex] || visited[startIndex]) {
      continue;
    }

    const tileIndices = [startIndex];
    visited[startIndex] = 1;
    let queueHead = 0;

    while (queueHead < tileIndices.length) {
      const current = fromRoomIndex(tileIndices[queueHead]);
      queueHead++;

      for (const offset of NEIGHBOR_OFFSETS) {
        const x = current.x + offset.x;
        const y = current.y + offset.y;

        if (!isInsideRoom(x, y)) {
          continue;
        }

        const neighborIndex = toRoomIndex(x, y);

        if (!rampartMask[neighborIndex] || visited[neighborIndex]) {
          continue;
        }

        visited[neighborIndex] = 1;
        tileIndices.push(neighborIndex);
      }
    }

    components.push({ tileIndices });
  }

  return components;
}

function buildRampartRoadBlockedMask(
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  existingSpawn?: RoomCoordinate,
): Uint8Array {
  const blockedMask = new Uint8Array(ROOM_AREA);
  const block = ({ x, y }: RoomCoordinate): void => {
    blockedMask[toRoomIndex(x, y)] = 1;
  };

  block(controller.pos);
  block(controllerArea.storage);
  block(corePlan.manager);
  block(corePlan.terminal);
  block(corePlan.firstSpawn);
  block(corePlan.link);
  block(corePlan.factory);
  block(corePlan.powerSpawn);
  corePlan.parking.forEach(block);

  if (existingSpawn) {
    block(existingSpawn);
  }

  for (const resource of [...sources, ...minerals]) {
    block(resource.pos);
  }

  for (const branch of resourceTree.branches) {
    block(branch.container);

    if (branch.link) {
      block(branch.link);
    }
  }

  return blockedMask;
}

function buildRampartDistanceMap(
  terrain: RoomTerrain,
  outerRampartPlan: OuterRampartPlan,
  corePlan: CorePlan,
  blockedMask: Uint8Array,
  upgradeChainCostMap: Int16Array,
  roadNetworkMask: Uint8Array,
): Int32Array {
  return dijkstraMap(
    terrain,
    corePlan.roads,
    (x, y, terrainType) =>
      getRampartRoadCost(
        toRoomIndex(x, y),
        terrainType,
        upgradeChainCostMap,
        roadNetworkMask,
      ),
    (x, y) => {
      const index = toRoomIndex(x, y);

      return !!(
        (outerRampartPlan.insideMask[index] ||
          outerRampartPlan.rampartMask[index]) &&
        blockedMask[index] === 0
      );
    },
  );
}

function findClosestRampartTarget(
  components: readonly RampartComponent[],
  remainingComponents: readonly number[],
  distanceMap: Int32Array,
): RampartTarget | undefined {
  let bestTarget: RampartTarget | undefined;

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
  roadNetworkMask: Uint8Array,
): RoomCoordinate[] | undefined {
  let currentIndex = toRoomIndex(start.x, start.y);

  if (distanceMap[currentIndex] < 0) {
    return;
  }

  const path: RoomCoordinate[] = [];

  while (!roadNetworkMask[currentIndex]) {
    const current = fromRoomIndex(currentIndex);
    const currentDistance = distanceMap[currentIndex];

    if (currentDistance <= 0) {
      return;
    }

    path.push(current);

    const currentCost = getRampartRoadCost(
      currentIndex,
      terrain.get(current.x, current.y),
      upgradeChainCostMap,
      roadNetworkMask,
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

      if (roadNetworkMask[neighborIndex]) {
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

function getRampartRoadCost(
  index: number,
  terrainType: number,
  upgradeChainCostMap: Int16Array,
  roadNetworkMask: Uint8Array,
): number {
  const upgradeChainCost = upgradeChainCostMap[index];

  if (upgradeChainCost >= 0) {
    return upgradeChainCost;
  }

  if (roadNetworkMask[index]) {
    return 3;
  }

  return terrainType === TERRAIN_MASK_SWAMP ? 6 : 5;
}
