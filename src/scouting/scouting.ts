import { requestSpawn } from "../capabilities/spawning/spawnQueue"
import { getColonyCreeps, type TickContext } from "../kernel/tickContext"
import { intelStore } from "../world/intel/intelStore"
import { getExploreCandidates } from "./explore"
import { runScouter, SCOUT_ROLE } from "./scouter"

const SCOUT_ROLES = [SCOUT_ROLE]

export function runScouting(context: TickContext): void {
  if (!intelStore.isReady()) {
    return
  }

  for (const room of context.ownedRooms.values()) {
    runColonyScouting(room, context)
  }
}

function runColonyScouting(room: Room, context: TickContext): void {
  const colonyName = room.name
  const scouts = getColonyCreeps(context, colonyName, SCOUT_ROLE)

  for (const scout of scouts) {
    if (scout.spawning) {
      continue
    }

    runScouter(scout, colonyName)
  }

  if (scouts.length > 0) {
    return
  }

  if (getExploreCandidates(colonyName).length === 0) {
    return
  }

  requestSpawn(
    {
      requesterId: `scouting:${colonyName}`,
      spawnRoomName: colonyName,
      assignment: {
        type: "colony",
        colonyName,
      },
      priorityType: "scout",
      order: 0,
      rolesByPriority: SCOUT_ROLES,
    },
    [MOVE],
    SCOUT_ROLE,
  )
}
