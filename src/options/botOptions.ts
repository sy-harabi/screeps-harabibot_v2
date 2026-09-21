// src/options/botOptions.ts

export interface BotOptions {
  visuals: {
    basePlan: boolean
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
  visuals?: {
    basePlan?: boolean
  }
  construction?: {
    rampartBuildRcl?: number
  }
  rooms?: Record<string, RoomOptionsOverride>
}

export const DEFAULT_BOT_OPTIONS: BotOptions = {
  visuals: {
    basePlan: false,
  },
  construction: {
    rampartBuildRcl: 6,
  },
}

export function getBotOptions(): BotOptions {
  const rampartBuildRcl =
    getValidRcl(Memory.options?.construction?.rampartBuildRcl) ?? DEFAULT_BOT_OPTIONS.construction.rampartBuildRcl

  return {
    visuals: {
      basePlan: Memory.options?.visuals?.basePlan ?? DEFAULT_BOT_OPTIONS.visuals.basePlan,
    },
    construction: {
      rampartBuildRcl,
    },
  }
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
