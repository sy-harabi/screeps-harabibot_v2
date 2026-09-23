import { Codec } from "../../vendor/utf15"
import type { RoomCoordinate } from "../map/roomCoordinate"
import { fromRoomIndex, toRoomIndex } from "../map/roomGrid"
import type { ControllerStaticIntel, MineralIntel, RoomStaticIntel, SourceIntel } from "./roomIntel"

const MAX_ROOM_OBJECT_COUNT = 4

const ID_PART_COUNT = 6
const ID_PART_DEPTH = 16

const headerCodec = new Codec({
  array: true,
  depth: [3, 3, 3, 1],
})

export type PackedRoomStaticIntel = string

export function packRoomStaticIntel(
  intel: RoomStaticIntel,
  getMineralTypeIndex: (type: MineralConstant) => number,
): PackedRoomStaticIntel {
  const sourceCount = intel.sources.length
  const mineralCount = intel.minerals.length
  const keeperLairCount = intel.keeperLairs.length

  assertCount("source", sourceCount)
  assertCount("mineral", mineralCount)
  assertCount("keeper lair", keeperLairCount)

  const header = headerCodec.encode([
    sourceCount,
    mineralCount,
    keeperLairCount,
    intel.controller === undefined ? 0 : 1,
  ])

  const values: number[] = []
  const depths: number[] = []

  for (const source of intel.sources) {
    pushId(values, depths, source.id)
    pushCoordinate(values, depths, source.coordinate)
  }

  for (const mineral of intel.minerals) {
    pushId(values, depths, mineral.id)
    pushCoordinate(values, depths, mineral.coordinate)

    const mineralTypeIndex = getMineralTypeIndex(mineral.mineralType)

    if (mineralTypeIndex < 0 || mineralTypeIndex >= 64) {
      throw new Error(`Mineral type index ${mineralTypeIndex} exceeds 6-bit range`)
    }

    values.push(mineralTypeIndex)
    depths.push(6)
  }

  if (intel.controller !== undefined) {
    pushId(values, depths, intel.controller.id)
    pushCoordinate(values, depths, intel.controller.coordinate)
  }

  for (const coordinate of intel.keeperLairs) {
    pushCoordinate(values, depths, coordinate)
  }

  if (values.length === 0) {
    return header
  }

  const bodyCodec = new Codec({
    array: true,
    depth: depths,
  })

  return header + bodyCodec.encode(values)
}

export function unpackRoomStaticIntel(
  packed: PackedRoomStaticIntel,
  mineralTypes: readonly MineralConstant[],
): RoomStaticIntel {
  if (packed.length === 0) {
    throw new Error("Cannot unpack empty room static intel")
  }

  const header = headerCodec.decode(packed[0]) as number[]

  const sourceCount = header[0]
  const mineralCount = header[1]
  const keeperLairCount = header[2]
  const hasController = header[3] === 1

  assertCount("source", sourceCount)
  assertCount("mineral", mineralCount)
  assertCount("keeper lair", keeperLairCount)

  function pushIdDepths(depths: number[]): void {
    for (let i = 0; i < ID_PART_COUNT; i++) {
      depths.push(ID_PART_DEPTH)
    }
  }

  const depths: number[] = []

  for (let i = 0; i < sourceCount; i++) {
    pushIdDepths(depths)
    depths.push(12)
  }

  for (let i = 0; i < mineralCount; i++) {
    pushIdDepths(depths)
    depths.push(12, 6)
  }

  if (hasController) {
    pushIdDepths(depths)
    depths.push(12)
  }

  for (let i = 0; i < keeperLairCount; i++) {
    depths.push(12)
  }

  const values =
    depths.length === 0
      ? []
      : (new Codec({
          array: true,
          depth: depths,
        }).decode(packed.slice(1)) as number[])

  let cursor = 0

  function readId<T extends _HasId>(): Id<T> {
    let id = ""

    for (let i = 0; i < ID_PART_COUNT; i++) {
      id += values[cursor++].toString(16).padStart(4, "0")
    }

    return id as Id<T>
  }

  function readCoordinate(): RoomCoordinate {
    return fromRoomIndex(values[cursor++])
  }
  const sources: SourceIntel[] = []

  for (let i = 0; i < sourceCount; i++) {
    sources.push({
      id: readId<Source>(),
      coordinate: readCoordinate(),
    })
  }

  const minerals: MineralIntel[] = []

  for (let i = 0; i < mineralCount; i++) {
    const id = readId<Mineral>()
    const coordinate = readCoordinate()

    const mineralTypeIndex = values[cursor++]
    const mineralType = mineralTypes[mineralTypeIndex]

    if (mineralType === undefined) {
      throw new Error(`Unknown mineral type index ${mineralTypeIndex}`)
    }

    minerals.push({
      id,
      coordinate,
      mineralType,
    })
  }

  let controller: ControllerStaticIntel | undefined

  if (hasController) {
    controller = {
      id: readId<StructureController>(),
      coordinate: readCoordinate(),
    }
  }

  const keeperLairs: RoomCoordinate[] = []

  for (let i = 0; i < keeperLairCount; i++) {
    keeperLairs.push(readCoordinate())
  }

  if (cursor !== values.length) {
    throw new Error(`Room static intel contains ${values.length - cursor} unread values`)
  }

  return {
    sources,
    minerals,
    controller,
    keeperLairs,
  }
}

function pushId(values: number[], depths: number[], id: string): void {
  values.push(...packId(id))

  for (let i = 0; i < ID_PART_COUNT; i++) {
    depths.push(ID_PART_DEPTH)
  }
}

function pushCoordinate(values: number[], depths: number[], coordinate: RoomCoordinate): void {
  values.push(toRoomIndex(coordinate.x, coordinate.y))
  depths.push(12)
}

function assertCount(name: string, count: number): void {
  if (count > MAX_ROOM_OBJECT_COUNT) {
    throw new Error(`${name} count ${count} exceeds supported maximum ${MAX_ROOM_OBJECT_COUNT}`)
  }
}

function packId(id: string): number[] {
  if (!/^[0-9a-f]{24}$/.test(id)) {
    throw new Error(`Invalid Screeps object id: ${id}`)
  }

  const result: number[] = []

  for (let i = 0; i < 24; i += 4) {
    result.push(parseInt(id.slice(i, i + 4), 16))
  }

  return result
}

