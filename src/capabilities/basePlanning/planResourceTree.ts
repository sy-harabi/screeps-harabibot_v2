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

export interface ResourceTreePlan {
  roads: RoomCoordinate[];
}

export function planResourceTree(
  terrain: RoomTerrain,
  sources: Source[],
  minerals: Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  visual: RoomVisual,
): ResourceTreePlan | undefined {
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

  const distanceMap = dijkstraMap(
    terrain,
    corePlan.roads,
    getRoadCost,
    (x, y) => blockedMap[toRoomIndex(x, y)] === 0,
  );

  const resourcePathMask = new Uint8Array(ROOM_AREA);
  const targetMask = new Uint8Array(ROOM_AREA);

  let resourceBit = 1;

  for (const coordinate of [...sources, ...minerals].map((object) => object.pos)) {
    let targetCoordinates: RoomCoordinate[] = [];
    let minDistance = Infinity;

    forEachCoordinateAtRange(coordinate, 1, (x, y) => {
      const distance = distanceMap[toRoomIndex(x, y)];

      if (distance < 0) {
        return;
      }

      if (distance < minDistance) {
        minDistance = distance;
        targetCoordinates = [{ x, y }];
      } else if (distance === minDistance) {
        targetCoordinates.push({ x, y });
      }
    });

    for (const target of targetCoordinates) {
      targetMask[toRoomIndex(target.x, target.y)] |= resourceBit;
    }

    const pathMask = buildShortestPathMask(
      targetCoordinates,
      terrain,
      distanceMap,
      getRoadCost,
    );

    for (let index = 0; index < ROOM_AREA; index++) {
      if (pathMask[index]) {
        resourcePathMask[index] |= resourceBit;
      }
    }

    resourceBit <<= 1;
  }

  const maskCount = resourceBit;
  const fullMask = maskCount - 1;

  if (fullMask === 0) {
    return { roads: [] };
  }

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

  pathIndices.sort((a, b) => distanceMap[b] - distanceMap[a]);

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

  const roads: RoomCoordinate[] = [];

  for (let index = 0; index < ROOM_AREA; index++) {
    if (!roadMask[index]) {
      continue;
    }

    const coordinate = fromRoomIndex(index);
    roads.push(coordinate);
    visual.structure(coordinate.x, coordinate.y, STRUCTURE_ROAD);
  }

  return { roads };
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
