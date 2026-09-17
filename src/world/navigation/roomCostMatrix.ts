import { runtimeRegistry } from "../../runtime/runtimeRegistry";

interface RoomCostMatrixSignature {
  structureCount: number;
  lastStructureId?: string;
  constructionSiteCount: number;
  lastConstructionSiteId?: string;
}

interface RoomCostMatrixCacheEntry {
  matrix: CostMatrix;
  signature: RoomCostMatrixSignature;
}

const cache = runtimeRegistry.createCache<string, RoomCostMatrixCacheEntry>(
  "roomCostMatrix",
);

let tempTick = -1;

const temp = new Map<string, CostMatrix>();

export function getRoomCostMatrix(roomName: string): CostMatrix {
  prepareTemp();

  const tempMatrix = temp.get(roomName);

  if (tempMatrix !== undefined) {
    return tempMatrix;
  }

  const cached = cache.get(roomName);
  const room = Game.rooms[roomName];

  if (room === undefined) {
    const matrix = cached?.matrix ?? new PathFinder.CostMatrix();

    temp.set(roomName, matrix);
    return matrix;
  }

  // visible room이면 현재 상태 확인
  const structures = room.find(FIND_STRUCTURES);
  const constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES);

  const signature = createSignature(structures, constructionSites);

  if (cached !== undefined && signaturesEqual(cached.signature, signature)) {
    temp.set(roomName, cached.matrix);
    return cached.matrix;
  }

  const matrix = buildRoomCostMatrix(structures, constructionSites);

  cache.set(roomName, {
    matrix,
    signature,
  });

  temp.set(roomName, matrix);

  return matrix;
}

function buildRoomCostMatrix(
  structures: Structure[],
  constructionSites: ConstructionSite[],
): CostMatrix {
  const matrix = new PathFinder.CostMatrix();

  for (const structure of structures) {
    if (isBlockingStructure(structure)) {
      matrix.set(structure.pos.x, structure.pos.y, 255);
    }
  }

  for (const site of constructionSites) {
    if (OBSTACLE_OBJECT_TYPES.includes(site.structureType)) {
      matrix.set(site.pos.x, site.pos.y, 255);
    }
  }

  for (const structure of structures) {
    if (
      structure.structureType === STRUCTURE_ROAD &&
      matrix.get(structure.pos.x, structure.pos.y) !== 255
    ) {
      matrix.set(structure.pos.x, structure.pos.y, 1);
    }
  }

  return matrix;
}

function isBlockingStructure(structure: Structure): boolean {
  if (structure.structureType === STRUCTURE_RAMPART) {
    return !structure.my && !structure.isPublic;
  }

  return OBSTACLE_OBJECT_TYPES.includes(structure.structureType);
}

function signaturesEqual(
  a: RoomCostMatrixSignature,
  b: RoomCostMatrixSignature,
): boolean {
  return (
    a.structureCount === b.structureCount &&
    a.lastStructureId === b.lastStructureId &&
    a.constructionSiteCount === b.constructionSiteCount &&
    a.lastConstructionSiteId === b.lastConstructionSiteId
  );
}

function createSignature(
  structures: Structure[],
  constructionSites: ConstructionSite[],
): RoomCostMatrixSignature {
  return {
    structureCount: structures.length,
    lastStructureId: structures.at(-1)?.id,
    constructionSiteCount: constructionSites.length,
    lastConstructionSiteId: constructionSites.at(-1)?.id,
  };
}

export function invalidateRoomCostMatrix(roomName: string): void {
  cache.delete(roomName);
  temp.delete(roomName);
}

function prepareTemp(): void {
  if (tempTick === Game.time) {
    return;
  }

  tempTick = Game.time;
  temp.clear();
}
