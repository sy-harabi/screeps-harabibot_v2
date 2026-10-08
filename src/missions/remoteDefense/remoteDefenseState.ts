import { isRemoteThreat } from "../../capabilities/combat/combatPerception"
import { createForceProfile, type ForceProfile } from "../../capabilities/combat/forceProfile"
import { harvestRoomPlanStore } from "../../colony/harvest/harvestRoomPlanStore"
import { type CreepCapabilities } from "../../creeps/creepCapabilities"
import { creepIntelStore } from "../../world/intel/creepIntelStore"

type RemotesByProtectedRoom = Map<string, Set<string>>

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

let stateTick = -1

const stateByColony = new Map<string, RemoteDefenseTickState>()

export function getRemoteDefenseState(colonyName: string): RemoteDefenseTickState | undefined {
  if (!harvestRoomPlanStore.isReady()) {
    return
  }

  if (stateTick !== Game.time) {
    stateTick = Game.time
    stateByColony.clear()
  }

  const cached = stateByColony.get(colonyName)

  if (cached !== undefined) {
    return cached
  }

  const state = createRemoteDefenseState(colonyName)

  stateByColony.set(colonyName, state)

  return state
}

function createRemoteDefenseState(colonyName: string): RemoteDefenseTickState {
  const remotesByProtectedRoom = createRemotesByProtectedRoom(colonyName)

  const threatsByRoom = new Map<string, RemoteThreat>()
  const unsafeRemoteRooms = new Set<string>()

  const hostileCreepIds = new Set<Id<Creep>>()
  const hostileCapabilities: CreepCapabilities[] = []

  for (const [roomName, affectedRemoteRooms] of remotesByProtectedRoom) {
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

function createRemotesByProtectedRoom(colonyName: string): RemotesByProtectedRoom {
  const result = new Map<string, Set<string>>()

  for (const remoteRoomName of harvestRoomPlanStore.getByColony(colonyName)) {
    if (remoteRoomName === colonyName) {
      continue
    }

    const plan = harvestRoomPlanStore.get(remoteRoomName)

    if (plan === undefined) {
      continue
    }

    const protectedRooms = new Set<string>([remoteRoomName])

    for (const source of plan.sources.values()) {
      for (const pos of source.path) {
        if (pos.roomName === colonyName) {
          continue
        }

        protectedRooms.add(pos.roomName)
      }
    }

    for (const protectedRoomName of protectedRooms) {
      let remoteRooms = result.get(protectedRoomName)

      if (remoteRooms === undefined) {
        remoteRooms = new Set()
        result.set(protectedRoomName, remoteRooms)
      }

      remoteRooms.add(remoteRoomName)
    }
  }

  return result
}
