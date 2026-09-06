export interface RoomCoordinate {
  readonly x: number;
  readonly y: number;
}

export function getRange(coord1: RoomCoordinate, coord2: RoomCoordinate) {
  return Math.max(Math.abs(coord1.x - coord2.x), Math.abs(coord1.y - coord2.y));
}
