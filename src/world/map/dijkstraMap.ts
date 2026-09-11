export function buildDijkstraMap(
  origins: RoomCoordinate[],
  getCost: (coordinate: RoomCoordinate) => number,
): Uint16Array;
