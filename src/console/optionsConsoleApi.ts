import { DEFAULT_BOT_OPTIONS, getBotOptions } from "../options/botOptions"

export interface BotOptionsConsoleApi {
  show(): void
  setBasePlanVisual(value: boolean): void
  clearBasePlanVisual(): void
}

export const botOptionsConsoleApi: BotOptionsConsoleApi = {
  show(): void {
    console.log(JSON.stringify(getBotOptions(), null, 2))
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
}
