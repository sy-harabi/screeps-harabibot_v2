import { dijkstraMap } from "../../world/map/dijkstraMap";
import { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  forEachCoordinateAtRange,
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";
import { ControllerAreaCandidate } from "./findControllerAreaCandidates";
import { CorePlan } from "./findCorePlans";

const INF = 30000;

const DECISION_NONE = 0;
const DECISION_TARGET = 1;
const DECISION_CONTINUE = 2;
const DECISION_SPLIT = 3;

interface ResourceTarget {
  readonly targetId: Id<Source> | Id<Mineral>;
  readonly coordinate: RoomCoordinate;
  readonly bit: number;
  readonly kind: "source" | "mineral";
}

interface SelectedResourceTarget extends ResourceTarget {
  readonly container: RoomCoordinate;
  readonly link?: RoomCoordinate;
}

interface ContainerSelection {
  readonly container: RoomCoordinate;
  readonly link?: RoomCoordinate;
}

export interface ResourceBranchPlan {
  readonly targetId: Id<Source> | Id<Mineral>;
  readonly container: RoomCoordinate;
  readonly link?: RoomCoordinate;
  readonly roads: RoomCoordinate[];
}

export interface ResourceTreePlan {
  readonly roads: RoomCoordinate[];
  readonly branches: ResourceBranchPlan[];
  readonly coreDistanceMap: Int32Array;
}

export function planResourceTree(
  terrain: RoomTerrain,
  sources: Source[],
  minerals: Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  visual: RoomVisual,
): ResourceTreePlan | undefined {
  const targets: ResourceTarget[] = [
    ...sources.map((source, index) => ({
      targetId: source.id,
      coordinate: source.pos,
      bit: 1 << index,
      kind: "source" as const,
    })),
    ...minerals.map((mineral, index) => ({
      targetId: mineral.id,
      coordinate: mineral.pos,
      bit: 1 << (sources.length + index),
      kind: "mineral" as const,
    })),
  ];

  if (targets.length === 0) {
    const blockedMap = buildBlockedMap(
      sources,
      minerals,
      controllerArea,
      corePlan,
    );

    return {
      roads: [],
      branches: [],
      coreDistanceMap: buildResourceDistanceMap(
        terrain,
        blockedMap,
        corePlan.roads,
      ),
    };
  }

  const blockedMap = buildBlockedMap(
    sources,
    minerals,
    controllerArea,
    corePlan,
  );
  const coreRoadMask = new Uint8Array(ROOM_AREA);

  corePlan.roads.forEach(({ x, y }) => {
    coreRoadMask[toRoomIndex(x, y)] = 1;
  });

  const selectedTargets = selectResourceContainers(
    terrain,
    targets,
    blockedMap,
    coreRoadMask,
    corePlan.roads,
  );

  if (!selectedTargets) {
    return;
  }

  const distanceMap = buildResourceDistanceMap(
    terrain,
    blockedMap,
    corePlan.roads,
  );

  const resourcePathMask = new Uint8Array(ROOM_AREA);
  const targetMask = new Uint8Array(ROOM_AREA);

  for (const target of selectedTargets) {
    const targetCoordinates = findClosestReachableAdjacentCoordinates(
      target.container,
      distanceMap,
    );

    if (targetCoordinates.length === 0) {
      return;
    }

    for (const coordinate of targetCoordinates) {
      targetMask[toRoomIndex(coordinate.x, coordinate.y)] |= target.bit;
    }

    const pathMask = buildShortestPathMask(
      targetCoordinates,
      terrain,
      distanceMap,
      getRoadCost,
    );

    for (let index = 0; index < ROOM_AREA; index++) {
      if (pathMask[index]) {
        resourcePathMask[index] |= target.bit;
      }
    }
  }

  const maskCount = 1 << targets.length;
  const fullMask = maskCount - 1;
  const stateCount = ROOM_AREA * maskCount;

  const dp = new Int16Array(stateCount);
  dp.fill(INF);

  const decisionType = new Uint8Array(stateCount);
  const decisionValue = new Int16Array(stateCount);
  decisionValue.fill(-1);

  const pathIndices: number[] = [];

  for (let index = 0; index < ROOM_AREA; index++) {
    if (resourcePathMask[index]) {
      pathIndices.push(index);
    }
  }

  pathIndices.sort(
    (left, right) => distanceMap[right] - distanceMap[left] || left - right,
  );

  for (const index of pathIndices) {
    const coordinate = fromRoomIndex(index);
    const tileCost = distanceMap[index] === 0 ? 0 : 1;

    for (let mask = 1; mask <= fullMask; mask++) {
      if ((resourcePathMask[index] & mask) !== mask) {
        continue;
      }

      const key = index * maskCount + mask;
      let best = INF;
      let bestDecisionType = DECISION_NONE;
      let bestDecisionValue = -1;

      if ((targetMask[index] & mask) === mask) {
        best = tileCost;
        bestDecisionType = DECISION_TARGET;
      }

      for (const offset of NEIGHBOR_OFFSETS) {
        const nextX = coordinate.x + offset.x;
        const nextY = coordinate.y + offset.y;

        if (!isInsideRoom(nextX, nextY)) {
          continue;
        }

        const nextIndex = toRoomIndex(nextX, nextY);

        if ((resourcePathMask[nextIndex] & mask) !== mask) {
          continue;
        }

        const terrainType = terrain.get(nextX, nextY);
        const nextCost = getRoadCost(nextX, nextY, terrainType);

        if (distanceMap[index] + nextCost !== distanceMap[nextIndex]) {
          continue;
        }

        const rest = dp[nextIndex * maskCount + mask];

        if (rest >= INF) {
          continue;
        }

        const candidate = tileCost + rest;

        if (candidate < best) {
          best = candidate;
          bestDecisionType = DECISION_CONTINUE;
          bestDecisionValue = nextIndex;
        }
      }

      for (
        let leftMask = (mask - 1) & mask;
        leftMask > 0;
        leftMask = (leftMask - 1) & mask
      ) {
        const rightMask = mask ^ leftMask;

        if (leftMask > rightMask) {
          continue;
        }

        const leftCost = dp[index * maskCount + leftMask];
        const rightCost = dp[index * maskCount + rightMask];

        if (leftCost >= INF || rightCost >= INF) {
          continue;
        }

        const candidate = leftCost + rightCost - tileCost;

        if (candidate < best) {
          best = candidate;
          bestDecisionType = DECISION_SPLIT;
          bestDecisionValue = leftMask;
        }
      }

      dp[key] = best;
      decisionType[key] = bestDecisionType;
      decisionValue[key] = bestDecisionValue;
    }
  }

  const rootDp = new Int16Array(maskCount);
  rootDp.fill(INF);

  const rootDecisionType = new Uint8Array(maskCount);
  const rootDecisionValue = new Int16Array(maskCount);
  rootDecisionValue.fill(-1);

  const rootIndices = corePlan.roads.map((road) => toRoomIndex(road.x, road.y));

  for (let mask = 1; mask <= fullMask; mask++) {
    let best = INF;
    let bestDecisionType = DECISION_NONE;
    let bestDecisionValue = -1;

    for (const index of rootIndices) {
      if ((resourcePathMask[index] & mask) !== mask) {
        continue;
      }

      const candidate = dp[index * maskCount + mask];

      if (candidate < best) {
        best = candidate;
        bestDecisionType = DECISION_CONTINUE;
        bestDecisionValue = index;
      }
    }

    for (
      let leftMask = (mask - 1) & mask;
      leftMask > 0;
      leftMask = (leftMask - 1) & mask
    ) {
      const rightMask = mask ^ leftMask;

      if (leftMask > rightMask) {
        continue;
      }

      const leftCost = rootDp[leftMask];
      const rightCost = rootDp[rightMask];

      if (leftCost >= INF || rightCost >= INF) {
        continue;
      }

      const candidate = leftCost + rightCost;

      if (candidate < best) {
        best = candidate;
        bestDecisionType = DECISION_SPLIT;
        bestDecisionValue = leftMask;
      }
    }

    rootDp[mask] = best;
    rootDecisionType[mask] = bestDecisionType;
    rootDecisionValue[mask] = bestDecisionValue;
  }

  if (rootDp[fullMask] >= INF) {
    return;
  }

  const roadMask = traceResourceTree(
    fullMask,
    maskCount,
    distanceMap,
    decisionType,
    decisionValue,
    rootDecisionType,
    rootDecisionValue,
  );

  const roads: RoomCoordinate[] = [];

  for (let index = 0; index < ROOM_AREA; index++) {
    if (!roadMask[index]) {
      continue;
    }

    const coordinate = fromRoomIndex(index);
    roads.push(coordinate);
    visual.structure(coordinate.x, coordinate.y, STRUCTURE_ROAD);
  }

  const selectedTargetByBit = new Map(
    selectedTargets.map((target) => [target.bit, target]),
  );

  const branches: ResourceBranchPlan[] = [];

  for (const target of targets) {
    const selectedTarget = selectedTargetByBit.get(target.bit);

    if (!selectedTarget) {
      return;
    }

    const branchRoadIndices = traceResourceBranch(
      target.bit,
      fullMask,
      maskCount,
      distanceMap,
      decisionType,
      decisionValue,
      rootDecisionType,
      rootDecisionValue,
    );

    const branchRoads = branchRoadIndices.map(fromRoomIndex);

    branches.push({
      targetId: target.targetId,
      container: selectedTarget.container,
      link: selectedTarget.link,
      roads: branchRoads,
    });

    visual.structure(
      selectedTarget.container.x,
      selectedTarget.container.y,
      STRUCTURE_CONTAINER,
    );

    if (selectedTarget.link) {
      visual.structure(
        selectedTarget.link.x,
        selectedTarget.link.y,
        STRUCTURE_LINK,
      );
    }
  }

  return { roads, branches, coreDistanceMap: distanceMap };
}

function buildBlockedMap(
  sources: Source[],
  minerals: Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
): Uint8Array {
  const blockedMap = new Uint8Array(ROOM_AREA);

  blockedMap[toRoomIndex(controllerArea.storage.x, controllerArea.storage.y)] =
    1;

  for (const chain of Object.values(controllerArea.upgradeChains)) {
    chain.forEach((tile: RoomCoordinate) => {
      blockedMap[toRoomIndex(tile.x, tile.y)] = 1;
    });
  }

  blockedMap[toRoomIndex(corePlan.firstSpawn.x, corePlan.firstSpawn.y)] = 1;
  blockedMap[toRoomIndex(corePlan.terminal.x, corePlan.terminal.y)] = 1;
  blockedMap[toRoomIndex(corePlan.link.x, corePlan.link.y)] = 1;
  blockedMap[toRoomIndex(corePlan.manager.x, corePlan.manager.y)] = 1;

  for (const resource of [...sources, ...minerals]) {
    blockedMap[toRoomIndex(resource.pos.x, resource.pos.y)] = 1;
  }

  return blockedMap;
}

function selectResourceContainers(
  terrain: RoomTerrain,
  targets: ResourceTarget[],
  blockedMap: Uint8Array,
  coreRoadMask: Uint8Array,
  coreRoads: readonly RoomCoordinate[],
): SelectedResourceTarget[] | undefined {
  const selectedTargets: SelectedResourceTarget[] = [];
  const remainingTargets = [...targets];

  while (remainingTargets.length > 0) {
    const distanceMap = buildResourceDistanceMap(
      terrain,
      blockedMap,
      coreRoads,
    );

    let selectedIndex = -1;
    let selectedCandidates: RoomCoordinate[] = [];
    let selectedDistance = Infinity;

    for (let index = 0; index < remainingTargets.length; index++) {
      const target = remainingTargets[index];
      const candidates = findReachableContainerCandidates(
        target,
        distanceMap,
        coreRoadMask,
      );
      const minDistance = getMinimumDistance(candidates, distanceMap);

      if (minDistance < selectedDistance) {
        selectedIndex = index;
        selectedCandidates = candidates;
        selectedDistance = minDistance;
      }
    }

    if (selectedIndex < 0 || selectedCandidates.length === 0) {
      return;
    }

    const currentTarget = remainingTargets[selectedIndex];
    const otherDagMask = buildOtherTargetDagMask(
      terrain,
      remainingTargets,
      selectedIndex,
      distanceMap,
      coreRoadMask,
    );

    if (!otherDagMask) {
      return;
    }

    const selection = chooseContainer(
      currentTarget,
      selectedCandidates,
      distanceMap,
      otherDagMask,
      coreRoadMask,
    );

    if (!selection) {
      return;
    }

    selectedTargets.push({
      ...currentTarget,
      ...selection,
    });

    blockedMap[toRoomIndex(selection.container.x, selection.container.y)] = 1;

    if (selection.link) {
      blockedMap[toRoomIndex(selection.link.x, selection.link.y)] = 1;
    }

    remainingTargets.splice(selectedIndex, 1);
  }

  return selectedTargets;
}

function buildOtherTargetDagMask(
  terrain: RoomTerrain,
  targets: ResourceTarget[],
  excludedTargetIndex: number,
  distanceMap: Int32Array,
  coreRoadMask: Uint8Array,
): Uint8Array | undefined {
  const combinedMask = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < targets.length; index++) {
    if (index === excludedTargetIndex) {
      continue;
    }

    const target = targets[index];
    const candidates = findReachableContainerCandidates(
      target,
      distanceMap,
      coreRoadMask,
    );
    const closestCandidates = findClosestCoordinates(candidates, distanceMap);

    if (closestCandidates.length === 0) {
      return;
    }

    const pathMask = buildShortestPathMask(
      closestCandidates,
      terrain,
      distanceMap,
      getRoadCost,
    );

    for (let tileIndex = 0; tileIndex < ROOM_AREA; tileIndex++) {
      if (pathMask[tileIndex]) {
        combinedMask[tileIndex] = 1;
      }
    }
  }

  return combinedMask;
}

function findReachableContainerCandidates(
  target: ResourceTarget,
  distanceMap: Int32Array,
  coreRoadMask: Uint8Array,
): RoomCoordinate[] {
  const candidates: RoomCoordinate[] = [];

  forEachCoordinateAtRange(target.coordinate, 1, (x, y) => {
    const index = toRoomIndex(x, y);

    if (distanceMap[index] < 0 || coreRoadMask[index]) {
      return;
    }

    const coordinate = { x, y };

    if (
      target.kind === "source" &&
      findSourceLinkCandidates(
        target.coordinate,
        coordinate,
        distanceMap,
        coreRoadMask,
      ).length === 0
    ) {
      return;
    }

    candidates.push(coordinate);
  });

  return candidates;
}

function findSourceLinkCandidates(
  source: RoomCoordinate,
  container: RoomCoordinate,
  distanceMap: Int32Array,
  coreRoadMask: Uint8Array,
): RoomCoordinate[] {
  const candidates: RoomCoordinate[] = [];

  forEachCoordinateAtRange(source, 1, (x, y) => {
    if (x === container.x && y === container.y) {
      return;
    }

    if (
      Math.max(Math.abs(x - container.x), Math.abs(y - container.y)) > 1
    ) {
      return;
    }

    const index = toRoomIndex(x, y);

    if (distanceMap[index] < 0 || coreRoadMask[index]) {
      return;
    }

    candidates.push({ x, y });
  });

  return candidates;
}

function findClosestReachableAdjacentCoordinates(
  center: RoomCoordinate,
  distanceMap: Int32Array,
): RoomCoordinate[] {
  const candidates: RoomCoordinate[] = [];

  forEachCoordinateAtRange(center, 1, (x, y) => {
    if (distanceMap[toRoomIndex(x, y)] >= 0) {
      candidates.push({ x, y });
    }
  });

  return findClosestCoordinates(candidates, distanceMap);
}

function findClosestCoordinates(
  candidates: readonly RoomCoordinate[],
  distanceMap: Int32Array,
): RoomCoordinate[] {
  const closest: RoomCoordinate[] = [];
  let minDistance = Infinity;

  for (const coordinate of candidates) {
    const distance = distanceMap[toRoomIndex(coordinate.x, coordinate.y)];

    if (distance < minDistance) {
      minDistance = distance;
      closest.length = 0;
      closest.push(coordinate);
    } else if (distance === minDistance) {
      closest.push(coordinate);
    }
  }

  return closest;
}

function getMinimumDistance(
  candidates: readonly RoomCoordinate[],
  distanceMap: Int32Array,
): number {
  let minDistance = Infinity;

  for (const coordinate of candidates) {
    minDistance = Math.min(
      minDistance,
      distanceMap[toRoomIndex(coordinate.x, coordinate.y)],
    );
  }

  return minDistance;
}

function chooseContainer(
  target: ResourceTarget,
  candidates: readonly RoomCoordinate[],
  distanceMap: Int32Array,
  otherDagMask: Uint8Array,
  coreRoadMask: Uint8Array,
): ContainerSelection | undefined {
  let bestSafe: ContainerSelection | undefined;
  let bestSafeDistance = Infinity;
  let bestFallback: ContainerSelection | undefined;
  let bestFallbackDistance = Infinity;

  for (const container of candidates) {
    const containerIndex = toRoomIndex(container.x, container.y);
    const distance = distanceMap[containerIndex];
    let link: RoomCoordinate | undefined;

    if (target.kind === "source") {
      const linkCandidates = findSourceLinkCandidates(
        target.coordinate,
        container,
        distanceMap,
        coreRoadMask,
      );

      link = chooseSourceLink(linkCandidates, otherDagMask);

      if (!link) {
        continue;
      }
    }

    const selection = { container, link };

    if (distance < bestFallbackDistance) {
      bestFallback = selection;
      bestFallbackDistance = distance;
    }

    const linkIndex = link ? toRoomIndex(link.x, link.y) : -1;
    const isSafe =
      !otherDagMask[containerIndex] &&
      (linkIndex < 0 || !otherDagMask[linkIndex]);

    if (isSafe && distance < bestSafeDistance) {
      bestSafe = selection;
      bestSafeDistance = distance;
    }
  }

  return bestSafe ?? bestFallback;
}

function chooseSourceLink(
  candidates: readonly RoomCoordinate[],
  otherDagMask: Uint8Array,
): RoomCoordinate | undefined {
  let bestSafe: RoomCoordinate | undefined;
  let bestFallback: RoomCoordinate | undefined;

  for (const coordinate of candidates) {
    const index = toRoomIndex(coordinate.x, coordinate.y);

    if (!bestFallback || index < toRoomIndex(bestFallback.x, bestFallback.y)) {
      bestFallback = coordinate;
    }

    if (
      !otherDagMask[index] &&
      (!bestSafe || index < toRoomIndex(bestSafe.x, bestSafe.y))
    ) {
      bestSafe = coordinate;
    }
  }

  return bestSafe ?? bestFallback;
}

function buildResourceDistanceMap(
  terrain: RoomTerrain,
  blockedMap: Uint8Array,
  coreRoads: readonly RoomCoordinate[],
): Int32Array {
  return dijkstraMap(
    terrain,
    coreRoads,
    getRoadCost,
    (x, y) => blockedMap[toRoomIndex(x, y)] === 0,
  );
}

function traceResourceTree(
  fullMask: number,
  maskCount: number,
  distanceMap: Int32Array,
  decisionType: Uint8Array,
  decisionValue: Int16Array,
  rootDecisionType: Uint8Array,
  rootDecisionValue: Int16Array,
): Uint8Array {
  const roadMask = new Uint8Array(ROOM_AREA);
  const traceStack: { index: number; mask: number }[] = [
    { index: -1, mask: fullMask },
  ];

  while (traceStack.length > 0) {
    const task = traceStack.pop();

    if (!task) {
      break;
    }

    const { index, mask } = task;

    if (index === -1) {
      const type = rootDecisionType[mask];
      const value = rootDecisionValue[mask];

      if (type === DECISION_CONTINUE) {
        traceStack.push({ index: value, mask });
      } else if (type === DECISION_SPLIT) {
        traceStack.push({ index: -1, mask: value });
        traceStack.push({ index: -1, mask: mask ^ value });
      }

      continue;
    }

    if (distanceMap[index] > 0) {
      roadMask[index] = 1;
    }

    const key = index * maskCount + mask;
    const type = decisionType[key];
    const value = decisionValue[key];

    if (type === DECISION_CONTINUE) {
      traceStack.push({ index: value, mask });
    } else if (type === DECISION_SPLIT) {
      traceStack.push({ index, mask: value });
      traceStack.push({ index, mask: mask ^ value });
    }
  }

  return roadMask;
}

function traceResourceBranch(
  targetBit: number,
  fullMask: number,
  maskCount: number,
  distanceMap: Int32Array,
  decisionType: Uint8Array,
  decisionValue: Int16Array,
  rootDecisionType: Uint8Array,
  rootDecisionValue: Int16Array,
): number[] {
  const roadIndices: number[] = [];
  let index = -1;
  let mask = fullMask;

  while (true) {
    if (index === -1) {
      const type = rootDecisionType[mask];
      const value = rootDecisionValue[mask];

      if (type === DECISION_CONTINUE) {
        index = value;
        continue;
      }

      if (type === DECISION_SPLIT) {
        mask = value & targetBit ? value : mask ^ value;
        continue;
      }

      break;
    }

    if (
      distanceMap[index] > 0 &&
      roadIndices[roadIndices.length - 1] !== index
    ) {
      roadIndices.push(index);
    }

    const key = index * maskCount + mask;
    const type = decisionType[key];
    const value = decisionValue[key];

    if (type === DECISION_TARGET) {
      break;
    }

    if (type === DECISION_CONTINUE) {
      index = value;
      continue;
    }

    if (type === DECISION_SPLIT) {
      mask = value & targetBit ? value : mask ^ value;
      continue;
    }

    break;
  }

  return roadIndices;
}

function buildShortestPathMask(
  targetCoordinates: RoomCoordinate[],
  terrain: RoomTerrain,
  distanceMap: Int32Array,
  getCost: (x: number, y: number, terrainType: number) => number,
): Uint8Array {
  const mask = new Uint8Array(ROOM_AREA);
  const queue: number[] = [];

  for (const target of targetCoordinates) {
    const index = toRoomIndex(target.x, target.y);

    mask[index] = 1;
    queue.push(index);
  }

  let queueHead = 0;

  while (queueHead < queue.length) {
    const index = queue[queueHead++];
    const current = fromRoomIndex(index);
    const currentDistance = distanceMap[index];

    if (currentDistance === 0) {
      continue;
    }

    const terrainType = terrain.get(current.x, current.y);
    const currentCost = getCost(current.x, current.y, terrainType);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborX = current.x + offset.x;
      const neighborY = current.y + offset.y;

      if (!isInsideRoom(neighborX, neighborY)) {
        continue;
      }

      const neighborIndex = toRoomIndex(neighborX, neighborY);

      if (distanceMap[neighborIndex] < 0) {
        continue;
      }

      if (mask[neighborIndex]) {
        continue;
      }

      if (distanceMap[neighborIndex] + currentCost !== currentDistance) {
        continue;
      }

      mask[neighborIndex] = 1;
      queue.push(neighborIndex);
    }
  }

  return mask;
}

function getRoadCost(_x: number, _y: number, terrainType: number): number {
  return terrainType === TERRAIN_MASK_SWAMP ? 6 : 5;
}
