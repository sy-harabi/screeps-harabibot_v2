import { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  forEachCoordinateAtRange,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";
import { ControllerAreaCandidate } from "./findControllerAreaCandidates";
import { CorePlan } from "./findCorePlans";
import { buildResourceDistanceMap } from "./resourcePlanningUtils";

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

export interface ResourceEndpointPlanResult {
  readonly endpoints: ResourceEndpointPlan[];
  readonly blockedMap: Uint8Array;
}

export function planResourceEndpoints(
  terrain: RoomTerrain,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
): ResourceEndpointPlanResult | undefined {
  const targets = buildResourceTargets(sources, minerals);
  const blockedMap = buildInitialBlockedMap(
    sources,
    minerals,
    controllerArea,
    corePlan,
  );
  const coreRoadMask = buildCoordinateMask(corePlan.roads);
  const endpoints = findResourceEndpointPlan(
    terrain,
    targets,
    [],
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

function buildInitialBlockedMap(
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

function findResourceEndpointPlan(
  terrain: RoomTerrain,
  remainingTargets: readonly ResourceTarget[],
  plannedEndpoints: readonly ResourceEndpointPlan[],
  blockedMap: Uint8Array,
  coreRoadMask: Uint8Array,
  coreRoads: readonly RoomCoordinate[],
): ResourceEndpointPlan[] | undefined {
  const distanceMap = buildResourceDistanceMap(
    terrain,
    blockedMap,
    coreRoads,
  );

  if (!areEndpointsReachable(plannedEndpoints, distanceMap)) {
    return;
  }

  if (remainingTargets.length === 0) {
    return [...plannedEndpoints];
  }

  let selectedIndex = -1;
  let selectedCandidates: ResourceEndpointCandidate[] = [];
  let selectedDistance = Infinity;

  for (let index = 0; index < remainingTargets.length; index++) {
    const target = remainingTargets[index];
    const candidates = collectEndpointCandidates(
      terrain,
      target,
      blockedMap,
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
    const endpoint: ResourceEndpointPlan = {
      ...target,
      container: candidate.container,
      link: candidate.link,
    };

    reserveEndpoint(candidate, blockedMap);

    const result = findResourceEndpointPlan(
      terrain,
      nextTargets,
      [...plannedEndpoints, endpoint],
      blockedMap,
      coreRoadMask,
      coreRoads,
    );

    if (result) {
      return result;
    }

    releaseEndpoint(candidate, blockedMap);
  }

  return;
}

function collectEndpointCandidates(
  terrain: RoomTerrain,
  target: ResourceTarget,
  blockedMap: Uint8Array,
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
      terrain,
      target.coordinate,
      container,
      blockedMap,
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
  terrain: RoomTerrain,
  source: RoomCoordinate,
  container: RoomCoordinate,
  blockedMap: Uint8Array,
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

    if (
      terrain.get(x, y) === TERRAIN_MASK_WALL ||
      blockedMap[index] ||
      coreRoadMask[index]
    ) {
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

function areEndpointsReachable(
  endpoints: readonly ResourceEndpointPlan[],
  distanceMap: Int32Array,
): boolean {
  return endpoints.every((endpoint) =>
    hasReachableAdjacentTile(endpoint.container, distanceMap),
  );
}

function hasReachableAdjacentTile(
  coordinate: RoomCoordinate,
  distanceMap: Int32Array,
): boolean {
  let reachable = false;

  forEachCoordinateAtRange(coordinate, 1, (x, y) => {
    if (distanceMap[toRoomIndex(x, y)] >= 0) {
      reachable = true;
    }
  });

  return reachable;
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
