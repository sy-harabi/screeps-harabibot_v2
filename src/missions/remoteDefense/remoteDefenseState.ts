import { isRemoteThreat } from "../../capabilities/combat/combatPerception"
import { createForceProfile, type ForceProfile } from "../../capabilities/combat/forceProfile"
import { harvestRoomPlanStore } from "../../colony/harvest/harvestRoomPlanStore"
import { getRemoteRoomsByPathRoom } from "../../colony/harvest/remoteTopology"
import type { CreepCapabilities } from "../../creeps/creepCapabilities"
import { creepIntelStore } from "../../world/intel/creepIntelStore"

export interface RemoteThreat {
  readonly roomName: string
  readonly creepIds: readonly Id<Creep>[]
  readonly affectedRemoteRooms: ReadonlySet<string>
}

export interface RemoteDefenseTickState {
  readonly threatsByRoom: ReadonlyMap<string, RemoteThreat>
  readonly unsafeRemoteRooms: ReadonlySet<string>

  readonly hostileCreepIds: ReadonlySet<Id<Creep>>
  readonly hostileProfile: ForceProfile
}

interface CachedRemoteDefenseState {
  readonly remoteRoomsByPathRoom: ReadonlyMap<string, ReadonlySet<string>>
  readonly state: RemoteDefenseTickState
}

let stateTick = -1

const stateByColony = new Map<string, CachedRemoteDefenseState>()

export function getRemoteDefenseState(colonyName: string): RemoteDefenseTickState | undefined {
  if (!harvestRoomPlanStore.isReady()) {
    return
  }

  if (stateTick !== Game.time) {
    stateTick = Game.time
    stateByColony.clear()
  }

  const remoteRoomsByPathRoom = getRemoteRoomsByPathRoom(colonyName)
  const cached = stateByColony.get(colonyName)

  if (cached?.remoteRoomsByPathRoom === remoteRoomsByPathRoom) {
    return cached.state
  }

  const state = createRemoteDefenseState(remoteRoomsByPathRoom)

  stateByColony.set(colonyName, {
    remoteRoomsByPathRoom,
    state,
  })

  return state
}

function createRemoteDefenseState(
  remoteRoomsByPathRoom: ReadonlyMap<string, ReadonlySet<string>>,
): RemoteDefenseTickState {
  const threatsByRoom = new Map<string, RemoteThreat>()
  const unsafeRemoteRooms = new Set<string>()

  const hostileCreepIds = new Set<Id<Creep>>()
  const hostileCapabilities: CreepCapabilities[] = []

  for (const [roomName, affectedRemoteRooms] of remoteRoomsByPathRoom) {
    const creepIds: Id<Creep>[] = []

    for (const id of creepIntelStore.getForeignCreepIds(roomName)) {
      const intel = creepIntelStore.get(id)

      if (intel === undefined || !isRemoteThreat(intel.capabilities)) {
        continue
      }

      creepIds.push(id)

      if (!hostileCreepIds.has(id)) {
        hostileCreepIds.add(id)
        hostileCapabilities.push(intel.capabilities)
      }
    }

    if (creepIds.length === 0) {
      continue
    }

    threatsByRoom.set(roomName, {
      roomName,
      creepIds,
      affectedRemoteRooms,
    })

    for (const remoteRoomName of affectedRemoteRooms) {
      unsafeRemoteRooms.add(remoteRoomName)
    }
  }

  return {
    threatsByRoom,
    unsafeRemoteRooms,
    hostileCreepIds,
    hostileProfile: createForceProfile(hostileCapabilities),
  }
}
