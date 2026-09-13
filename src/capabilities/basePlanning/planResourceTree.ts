import { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";
import { ControllerAreaCandidate } from "./findControllerAreaCandidates";
import { CorePlan } from "./findCorePlans";
import {
  buildResourceDistanceMap,
  getResourceRoadCost,
  planResourceEndpoints,
} from "./planResourceEndpoints";

const INF = 30000;

const DECISION_NONE = 0;
const DECISION_TARGET = 1;
const DECISION_CONTINUE = 2;
const DECISION_SPLIT = 3;

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
  const endpointPlanningResult = planResourceEndpoints(
    terrain,
    sources,
    minerals,
    controllerArea,
    corePlan,
  );

  if (!endpointPlanningResult) {
    return;
  }

  const targets = [...endpointPlanningResult.endpoints].sort(
    (left, right) => left.bit - right.bit,
  );
  const distanceMap = buildResourceDistanceMap(
    terrain,
    endpointPlanningResult.blockedMap,
    corePlan.roads,
  );

  if (targets.length === 0) {
    return {
      roads: [],
      branches: [],
      coreDistanceMap: distanceMap,
    };
  }

  const resourcePathMask = new Uint8Array(ROOM_AREA);
  const targetMask = new Uint8Array(ROOM_AREA);

  for (const target of targets) {
    const roadEndpoints = findClosestReachableAdjacentCoordinates(
      target.container,
      distanceMap,
    );

    if (roadEndpoints.length === 0) {
      return;
    }

    for (const coordinate of roadEndpoints) {
      targetMask[toRoomIndex(coordinate.x, coordinate.y)] |= target.bit;
    }

    const pathMask = buildShortestPathMask(
      roadEndpoints,
      terrain,
      distanceMap,
      getResourceRoadCost,
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
        const nextCost = getResourceRoadCost(nextX, nextY, terrainType);

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

  const branches: ResourceBranchPlan[] = [];

  for (const target of targets) {
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

    branches.push({
      targetId: target.targetId,
      container: target.container,
      link: target.link,
      roads: branchRoadIndices.map(fromRoomIndex),
    });

    visual.structure(
      target.container.x,
      target.container.y,
      STRUCTURE_CONTAINER,
    );

    if (target.link) {
      visual.structure(target.link.x, target.link.y, STRUCTURE_LINK);
    }
  }

  return { roads, branches, coreDistanceMap: distanceMap };
}

function findClosestReachableAdjacentCoordinates(
  center: RoomCoordinate,
  distanceMap: Int32Array,
): RoomCoordinate[] {
  const candidates: RoomCoordinate[] = [];

  for (const offset of NEIGHBOR_OFFSETS) {
    const x = center.x + offset.x;
    const y = center.y + offset.y;

    if (!isInsideRoom(x, y)) {
      continue;
    }

    if (distanceMap[toRoomIndex(x, y)] >= 0) {
      candidates.push({ x, y });
    }
  }

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
  targetCoordinates: readonly RoomCoordinate[],
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

      if (distanceMap[neighborIndex] < 0 || mask[neighborIndex]) {
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
