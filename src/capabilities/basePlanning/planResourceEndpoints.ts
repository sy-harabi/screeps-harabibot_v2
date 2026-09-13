import { dijkstraMap } from "../../world/map/dijkstraMap";
import { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  forEachCoordinateAtRange,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";
import { ControllerAreaCandidate } from "./findControllerAreaCandidates";
import { CorePlan } from "./findCorePlans";

interface ResourceTarget {
  readonly targetId: Id<Source> | Id<Mineral>;
  readonly coordinate: RoomCoordinate;
  readonly bit: number;
  readonly kind: "source" | "mineral";
}

interface ResourceEndpointCandidate {
  readonly container: RoomCoordinate;
  readonly link?: RoomCoordinate;
  readonly distance: number;
}

export interface ResourceEndpointPlan extends ResourceTarget {
  readonly container: RoomCoordinate;
  readonly link?: RoomCoordinate;
}

export interface ResourceEndpointPlanningResult {
  readonly endpoints: ResourceEndpointPlan[];
  readonly blockedMap: Uint8Array;
}

export function planResourceEndpoints(
  terrain: RoomTerrain,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
): ResourceEndpointPlanningResult | undefined {
  const targets = buildResourceTargets(sources, minerals);
  const blockedMap = buildResourceBlockedMap(
    sources,
    minerals,
    controllerArea,
    corePlan,
  );
  const coreRoadMask = buildCoordinateMask(corePlan.roads);
  const endpoints = searchResourceEndpoints(
    terrain,
    targets,
    blockedMap,
    coreRoadMask,
    corePlan.roads,
  );

  if (!endpoints) {
    return;
  }

  return { endpoints, blockedMap };
}

function buildResourceTargets(
  sources: readonly Source[],
  minerals: readonly Mineral[],
): ResourceTarget[] {
  return [
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
}

function buildResourceBlockedMap(
  sources: readonly Source[],
  minerals: readonly Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
): Uint8Array {
  const blockedMap = new Uint8Array(ROOM_AREA);
  const block = ({ x, y }: RoomCoordinate): void => {
    blockedMap[toRoomIndex(x, y)] = 1;
  };

  block(controllerArea.storage);

  for (const chain of Object.values(controllerArea.upgradeChains)) {
    chain.forEach(block);
  }

  block(corePlan.firstSpawn);
  block(corePlan.terminal);
  block(corePlan.link);
  block(corePlan.manager);

  for (const resource of [...sources, ...minerals]) {
    block(resource.pos);
  }

  return blockedMap;
}

function buildCoordinateMask(
  coordinates: readonly RoomCoordinate[],
): Uint8Array {
  const mask = new Uint8Array(ROOM_AREA);

  for (const { x, y } of coordinates) {
    mask[toRoomIndex(x, y)] = 1;
  }

  return mask;
}

function searchResourceEndpoints(
  terrain: RoomTerrain,
  remainingTargets: readonly ResourceTarget[],
  blockedMap: Uint8Array,
  coreRoadMask: Uint8Array,
  coreRoads: readonly RoomCoordinate[],
): ResourceEndpointPlan[] | undefined {
  if (remainingTargets.length === 0) {
    return [];
  }

  const distanceMap = buildResourceDistanceMap(
    terrain,
    blockedMap,
    coreRoads,
  );

  let selectedIndex = -1;
  let selectedCandidates: ResourceEndpointCandidate[] = [];
  let selectedDistance = Infinity;

  for (let index = 0; index < remainingTargets.length; index++) {
    const target = remainingTargets[index];
    const candidates = collectResourceEndpointCandidates(
      target,
      distanceMap,
      coreRoadMask,
    );

    if (candidates.length === 0) {
      return;
    }

    const distance = candidates[0].distance;

    if (distance < selectedDistance) {
      selectedIndex = index;
      selectedCandidates = candidates;
      selectedDistance = distance;
    }
  }

  if (selectedIndex < 0) {
    return;
  }

  const target = remainingTargets[selectedIndex];
  const nextTargets = remainingTargets.filter(
    (_, index) => index !== selectedIndex,
  );

  for (const candidate of selectedCandidates) {
    reserveEndpoint(candidate, blockedMap);

    const rest = searchResourceEndpoints(
      terrain,
      nextTargets,
      blockedMap,
      coreRoadMask,
      coreRoads,
    );

    if (rest) {
      return [
        {
          ...target,
          container: candidate.container,
          link: candidate.link,
        },
        ...rest,
      ];
    }

    releaseEndpoint(candidate, blockedMap);
  }

  return;
}

function collectResourceEndpointCandidates(
  target: ResourceTarget,
  distanceMap: Int32Array,
  coreRoadMask: Uint8Array,
): ResourceEndpointCandidate[] {
  const candidates: ResourceEndpointCandidate[] = [];

  forEachCoordinateAtRange(target.coordinate, 1, (x, y) => {
    const containerIndex = toRoomIndex(x, y);
    const distance = distanceMap[containerIndex];

    if (distance < 0 || coreRoadMask[containerIndex]) {
      return;
    }

    const container = { x, y };

    if (target.kind === "mineral") {
      candidates.push({ container, distance });
      return;
    }

    const linkCandidates = collectSourceLinkCandidates(
      target.coordinate,
      container,
      distanceMap,
      coreRoadMask,
    );

    for (const link of linkCandidates) {
      candidates.push({ container, link, distance });
    }
  });

  candidates.sort(compareEndpointCandidates);
  return candidates;
}

function collectSourceLinkCandidates(
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

  candidates.sort(
    (left, right) =>
      toRoomIndex(left.x, left.y) - toRoomIndex(right.x, right.y),
  );

  return candidates;
}

function compareEndpointCandidates(
  left: ResourceEndpointCandidate,
  right: ResourceEndpointCandidate,
): number {
  const containerDifference =
    toRoomIndex(left.container.x, left.container.y) -
    toRoomIndex(right.container.x, right.container.y);
  const leftLinkIndex = left.link
    ? toRoomIndex(left.link.x, left.link.y)
    : -1;
  const rightLinkIndex = right.link
    ? toRoomIndex(right.link.x, right.link.y)
    : -1;

  return (
    left.distance - right.distance ||
    containerDifference ||
    leftLinkIndex - rightLinkIndex
  );
}

function reserveEndpoint(
  endpoint: ResourceEndpointCandidate,
  blockedMap: Uint8Array,
): void {
  blockedMap[toRoomIndex(endpoint.container.x, endpoint.container.y)] = 1;

  if (endpoint.link) {
    blockedMap[toRoomIndex(endpoint.link.x, endpoint.link.y)] = 1;
  }
}

function releaseEndpoint(
  endpoint: ResourceEndpointCandidate,
  blockedMap: Uint8Array,
): void {
  blockedMap[toRoomIndex(endpoint.container.x, endpoint.container.y)] = 0;

  if (endpoint.link) {
    blockedMap[toRoomIndex(endpoint.link.x, endpoint.link.y)] = 0;
  }
}

export function buildResourceDistanceMap(
  terrain: RoomTerrain,
  blockedMap: Uint8Array,
  coreRoads: readonly RoomCoordinate[],
): Int32Array {
  return dijkstraMap(
    terrain,
    coreRoads,
    getResourceRoadCost,
    (x, y) => blockedMap[toRoomIndex(x, y)] === 0,
  );
}

export function getResourceRoadCost(
  _x: number,
  _y: number,
  terrainType: number,
): number {
  return terrainType === TERRAIN_MASK_SWAMP ? 6 : 5;
}
