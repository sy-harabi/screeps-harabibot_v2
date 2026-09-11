export interface ResourceTreePlan {
  paths: RoomCoordinate[][];
  roads: RoomCoordinate[];
}

export function planResourceTree(
  access: RoomCoordinate,
  corePlan: CorePlan,
  upgradeChains: RoomCoordinate[][],
  sources: Source[],
  mineral: Mineral,
  terrain: RoomTerrain,
): ResourceTreePlan | undefined;
