import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getColonyCreeps, type TickContext } from "../../kernel/tickContext"
import { type LogisticsState } from "../logistics/logistics"
import { UPGRADER_ROLE } from "../upgrade/upgrader"
import { BUILDER_ROLE, createBuilderBody, runBuilder } from "./builder"
import { type ConstructionState } from "./construction"

const EFFECTIVE_BUILD_POWER = 4

export function runBuild(
  room: Room,
  context: TickContext,
  logistics: LogisticsState,
  income: number,
  construction: ConstructionState,
): void {
  const builders = getColonyCreeps(context, room.name, BUILDER_ROLE)

  if (!construction.active) {
    for (const builder of builders) {
      builder.memory.role = UPGRADER_ROLE
    }

    return
  }

  let effectiveBuildPower = 0

  for (const builder of builders) {
    if (builder.spawning) {
      continue
    }

    runBuilder(room, builder, logistics, construction.sites)

    const replacementLeadTime = builder.body.length * CREEP_SPAWN_TIME + 20

    if ((builder.ticksToLive ?? CREEP_LIFE_TIME) <= replacementLeadTime) {
      continue
    }

    effectiveBuildPower += builder.getActiveBodyparts(WORK) * EFFECTIVE_BUILD_POWER
  }

  const targetBuildPower = Math.floor(income)

  if (effectiveBuildPower >= targetBuildPower) {
    return
  }

  const workNeeded = Math.ceil((targetBuildPower - effectiveBuildPower) / EFFECTIVE_BUILD_POWER)

  requestSpawn(
    {
      requesterId: `build:${room.name}`,
      spawnRoomName: room.name,
      assignment: {
        type: "colony",
        colonyName: room.name,
      },
      priorityType: "build",
      order: 0,
      rolesByPriority: [BUILDER_ROLE],
    },
    () => createBuilderBody(room, workNeeded),
    BUILDER_ROLE,
  )
}
