export interface RoomCoordinate {
  readonly x: number;
  readonly y: number;
}

export interface BasePlan {
  readonly start: RoomCoordinate;
  readonly storage: RoomCoordinate;
  readonly sourceContainers: Readonly<Record<string, RoomCoordinate>>;
}
