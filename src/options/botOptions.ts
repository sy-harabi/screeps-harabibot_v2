// src/options/botOptions.ts
export const DEFAULT_BOT_OPTIONS: BotOptions = {
  speedrun: false,

  visuals: {
    basePlan: false,
    harvest: true,
    harvestPath: false,
    rclProgress: true,
  },
  construction: {
    rampartBuildRcl: 6,
  },
}

export type BotMode = "normal" | "speedrun"

export interface BotOptions {
  speedrun: boolean

  visuals: {
    basePlan: boolean
    harvest: boolean
    harvestPath: boolean
    rclProgress: boolean
  }
  construction: {
    rampartBuildRcl: number
  }
}

export interface RoomOptionsOverride {
  construction?: {
    rampartBuildRcl?: number
  }
}

export interface BotOptionsOverride {
  speedrun?: boolean

  visuals?: {
    basePlan?: boolean
    harvest?: boolean
    harvestPath?: boolean
    rclProgress?: boolean
  }
  construction?: {
    rampartBuildRcl?: number
  }
  rooms?: Record<string, RoomOptionsOverride>
}

let cachedTick = -1
let cachedOptions: BotOptions | undefined

export function getBotOptions(): BotOptions {
  if (cachedTick === Game.time && cachedOptions !== undefined) {
    return cachedOptions
  }

  const rampartBuildRcl =
    getValidRcl(Memory.options?.construction?.rampartBuildRcl) ?? DEFAULT_BOT_OPTIONS.construction.rampartBuildRcl

  cachedOptions = {
    speedrun: Memory.options?.speedrun ?? DEFAULT_BOT_OPTIONS.speedrun,

    visuals: {
      basePlan: Memory.options?.visuals?.basePlan ?? DEFAULT_BOT_OPTIONS.visuals.basePlan,
      harvest: Memory.options?.visuals?.harvest ?? DEFAULT_BOT_OPTIONS.visuals.harvest,
      harvestPath: Memory.options?.visuals?.harvestPath ?? DEFAULT_BOT_OPTIONS.visuals.harvestPath,
      rclProgress: Memory.options?.visuals?.rclProgress ?? DEFAULT_BOT_OPTIONS.visuals.rclProgress,
    },
    construction: {
      rampartBuildRcl,
    },
  }
  cachedTick = Game.time

  return cachedOptions
}

export function getRampartBuildRcl(roomName: string): number {
  return (
    getValidRcl(Memory.options?.rooms?.[roomName]?.construction?.rampartBuildRcl) ??
    getBotOptions().construction.rampartBuildRcl
  )
}

export function isValidRcl(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 8
}

function getValidRcl(value: number | undefined): number | undefined {
  return value !== undefined && isValidRcl(value) ? value : undefined
}
