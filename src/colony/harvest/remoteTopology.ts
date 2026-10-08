import { getHarvestRuntime } from "./harvestRuntime"
import { harvestRoomPlanStore } from "./harvestRoomPlanStore"

export function getRemoteRoomsByPathRoom(colonyName: string): ReadonlyMap<string, ReadonlySet<string>> {
  const runtime = getHarvestRuntime(colonyName)

  if (runtime.remoteRoomsByPathRoom !== undefined) {
    return runtime.remoteRoomsByPathRoom
  }

  const remoteRoomsByPathRoom = createRemoteRoomsByPathRoom(colonyName)

  runtime.remoteRoomsByPathRoom = remoteRoomsByPathRoom

  return remoteRoomsByPathRoom
}

function createRemoteRoomsByPathRoom(colonyName: string): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, Set<string>>()

  for (const remoteRoomName of harvestRoomPlanStore.getByColony(colonyName)) {
    if (remoteRoomName === colonyName) {
      continue
    }

    const plan = harvestRoomPlanStore.get(remoteRoomName)

    if (plan === undefined) {
      continue
    }

    addRemote(result, remoteRoomName, remoteRoomName)

    for (const source of plan.sources.values()) {
      for (const pos of source.path) {
        if (pos.roomName === colonyName) {
          continue
        }

        addRemote(result, pos.roomName, remoteRoomName)
      }
    }
  }

  return result
}

function addRemote(
  remoteRoomsByPathRoom: Map<string, Set<string>>,
  pathRoomName: string,
  remoteRoomName: string,
): void {
  let remoteRooms = remoteRoomsByPathRoom.get(pathRoomName)

  if (remoteRooms === undefined) {
    remoteRooms = new Set()
    remoteRoomsByPathRoom.set(pathRoomName, remoteRooms)
  }

  remoteRooms.add(remoteRoomName)
}
