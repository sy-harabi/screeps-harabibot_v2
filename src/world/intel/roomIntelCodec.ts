type PackedSourceIntel = readonly [id: Id<Source>, coordinate: number]

type PackedMineralIntel = readonly [id: Id<Mineral>, coordinate: number, mineralType: MineralConstant]

type PackedControllerIntel = readonly [
  id: Id<StructureController>,
  coordinate: number,
  owner: readonly [username: string, level: number] | null,
  reservation: readonly [username: string, endTick: number] | null,
]

export type PackedRoomIntel = readonly [
  lastSeen: number,
  sources: readonly PackedSourceIntel[],
  minerals: readonly PackedMineralIntel[],
  controller: PackedControllerIntel | null,
  keeperLairs: readonly number[],
]
