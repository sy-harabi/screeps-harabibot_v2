import { DEFAULT_BOT_OPTIONS, getBotOptions, getRampartBuildRcl, isValidRcl } from "../options/botOptions"

export interface BotOptionsConsoleApi {
  show(roomName?: string): void
  setBasePlanVisual(value: boolean): void
  clearBasePlanVisual(): void
  setRampartBuildRcl(value: number, roomName?: string): void
  clearRampartBuildRcl(roomName?: string): void
}

export const botOptionsConsoleApi: BotOptionsConsoleApi = {
  show(roomName?: string): void {
    const options = getBotOptions()

    if (roomName === undefined) {
      console.log(JSON.stringify(options, null, 2))
      return
    }

    console.log(
      JSON.stringify(
        {
          ...options,
          room: {
            name: roomName,
            rampartBuildRcl: getRampartBuildRcl(roomName),
          },
        },
        null,
        2,
      ),
    )
  },

  setBasePlanVisual(value: boolean): void {
    Memory.options ??= {}
    Memory.options.visuals ??= {}
    Memory.options.visuals.basePlan = value

    console.log(`basePlan visual = ${value}`)
  },

  clearBasePlanVisual(): void {
    delete Memory.options?.visuals?.basePlan

    console.log(`basePlan visual reset to default = ${DEFAULT_BOT_OPTIONS.visuals.basePlan}`)
  },

  setRampartBuildRcl(value: number, roomName?: string): void {
    assertRcl(value)
    Memory.options ??= {}

    if (roomName === undefined) {
      Memory.options.construction ??= {}
      Memory.options.construction.rampartBuildRcl = value

      console.log(`rampartBuildRcl = ${value}`)
      return
    }

    Memory.options.rooms ??= {}
    Memory.options.rooms[roomName] ??= {}
    Memory.options.rooms[roomName].construction ??= {}
    Memory.options.rooms[roomName].construction.rampartBuildRcl = value

    console.log(`${roomName} rampartBuildRcl = ${value}`)
  },

  clearRampartBuildRcl(roomName?: string): void {
    if (roomName === undefined) {
      delete Memory.options?.construction?.rampartBuildRcl

      console.log(`rampartBuildRcl reset to default = ${DEFAULT_BOT_OPTIONS.construction.rampartBuildRcl}`)
      return
    }

    delete Memory.options?.rooms?.[roomName]?.construction?.rampartBuildRcl

    console.log(`${roomName} rampartBuildRcl reset to effective = ${getRampartBuildRcl(roomName)}`)
  },
}

function assertRcl(value: number): void {
  if (!isValidRcl(value)) {
    throw new Error(`RCL must be an integer from 1 to 8, got ${value}`)
  }
}
