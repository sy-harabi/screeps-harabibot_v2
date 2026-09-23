import { PackedRoomStaticIntel } from "./roomStaticIntelCodec"

interface RoomStaticIntelSegment {
  version: 1
  mineralTypes: MineralConstant[]
  rooms: Record<string, PackedRoomStaticIntel>
}

function getMineralTypeIndex(segment: RoomStaticIntelSegment, type: MineralConstant): number {
  let index = segment.mineralTypes.indexOf(type)

  if (index !== -1) {
    return index
  }

  index = segment.mineralTypes.length
  segment.mineralTypes.push(type)

  return index
}
