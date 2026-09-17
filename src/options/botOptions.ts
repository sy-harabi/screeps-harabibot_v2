// src/options/botOptions.ts

export interface BotOptions {
  visuals: {
    basePlan: boolean
  }
}

export interface BotOptionsOverride {
  visuals?: {
    basePlan?: boolean
  }
}

export const DEFAULT_BOT_OPTIONS: BotOptions = {
  visuals: {
    basePlan: false,
  },
}

export function getBotOptions(): BotOptions {
  return {
    visuals: {
      basePlan: Memory.options?.visuals?.basePlan ?? DEFAULT_BOT_OPTIONS.visuals.basePlan,
    },
  }
}
