import { HARVEST_PLAN_SEGMENT_IDS } from "../../persistence/segmentIds"
import { segmentManager } from "../../persistence/segmentManager"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { invalidateHarvestRuntime } from "./harvestRuntime"
import {
  packHarvestRoomPlan,
  unpackHarvestRoomPlan,
  type HarvestRoomPlan,
  type PackedHarvestRoomPlan,
} from "./harvestRoomPlan"

interface HarvestPlanSegment {
  version: 1
  rooms: Record<string, PackedHarvestRoomPlan>
}

const EMPTY_ROOM_NAMES: ReadonlySet<string> = new Set()

export const harvestRoomPlanStore = {
  pretick,
  isReady,
  get,
  set,
  delete: deleteHarvestRoomPlan,
  getByColony,
}

const plansByRoom = runtimeRegistry.createCache<string, HarvestRoomPlan>("harvest.roomPlans")
const roomsByColony = new Map<string, Set<string>>()

let ready = false

function pretick(): boolean {
  if (ready) {
    return true
  }

  const segments: HarvestPlanSegment[] = []
  ready = true

  for (const segmentId of HARVEST_PLAN_SEGMENT_IDS) {
    const result = segmentManager.getSegment<HarvestPlanSegment>(segmentId)

    if (result.status === "loading") {
      ready = false
      continue
    }

    if (result.value.version === 1 && result.value.rooms) {
      segments.push(result.value)
    }
  }

  if (!ready) {
    return false
  }

  plansByRoom.clear()
  roomsByColony.clear()

  for (const segment of segments) {
    for (const [roomName, packed] of Object.entries(segment.rooms)) {
      const plan = unpackHarvestRoomPlan(packed)

      plansByRoom.set(roomName, plan)
      addToColonyIndex(roomName, plan.colonyName)
    }
  }

  return true
}

function isReady(): boolean {
  return ready
}

function deleteHarvestRoomPlan(roomName: string): void {
  const segmentId = getHarvestPlanSegmentId(roomName)
  const result = segmentManager.getSegment<HarvestPlanSegment>(segmentId)

  if (result.status === "loading") {
    throw new Error("Cannot delete harvest room plan before segment " + segmentId + " is loaded")
  }

  const segment =
    result.value.version === 1 && result.value.rooms
      ? result.value
      : {
          version: 1 as const,
          rooms: {},
        }

  delete segment.rooms[roomName]
  segmentManager.setSegment(segmentId, segment)

  const plan = plansByRoom.get(roomName)

  if (plan !== undefined) {
    removeFromColonyIndex(roomName, plan.colonyName)
    plansByRoom.delete(roomName)
    invalidateHarvestRuntime(plan.colonyName)
  }
}

function getByColony(colonyName: string): ReadonlySet<string> {
  if (!ready) {
    throw new Error("Cannot read harvest room plans before ready")
  }

  return roomsByColony.get(colonyName) ?? EMPTY_ROOM_NAMES
}

function get(roomName: string): HarvestRoomPlan | undefined {
  if (!ready) {
    throw new Error("Cannot read harvest room plan before ready")
  }

  return plansByRoom.get(roomName)
}

function set(roomName: string, plan: HarvestRoomPlan): void {
  const previous = plansByRoom.get(roomName)

  if (previous !== undefined && previous.colonyName !== plan.colonyName) {
    removeFromColonyIndex(roomName, previous.colonyName)
    invalidateHarvestRuntime(previous.colonyName)
  }

  const segmentId = getHarvestPlanSegmentId(roomName)
  const result = segmentManager.getSegment<HarvestPlanSegment>(segmentId)

  if (result.status === "loading") {
    throw new Error("Cannot save harvest room plan before segment " + segmentId + " is loaded")
  }

  const segment =
    result.value.version === 1 && result.value.rooms
      ? result.value
      : {
          version: 1 as const,
          rooms: {},
        }

  segment.rooms[roomName] = packHarvestRoomPlan(plan)
  segmentManager.setSegment(segmentId, segment)
  plansByRoom.set(roomName, plan)
  addToColonyIndex(roomName, plan.colonyName)
  invalidateHarvestRuntime(plan.colonyName)
}

function addToColonyIndex(roomName: string, colonyName: string): void {
  const rooms = roomsByColony.get(colonyName)

  if (rooms === undefined) {
    roomsByColony.set(colonyName, new Set([roomName]))
    return
  }

  rooms.add(roomName)
}

function removeFromColonyIndex(roomName: string, colonyName: string): void {
  const rooms = roomsByColony.get(colonyName)

  if (rooms === undefined) {
    return
  }

  rooms.delete(roomName)

  if (rooms.size === 0) {
    roomsByColony.delete(colonyName)
  }
}

function getHarvestPlanSegmentId(roomName: string): number {
  let hash = 0

  for (let i = 0; i < roomName.length; i++) {
    hash = (hash * 31 + roomName.charCodeAt(i)) >>> 0
  }

  return HARVEST_PLAN_SEGMENT_IDS[hash % HARVEST_PLAN_SEGMENT_IDS.length]
}
