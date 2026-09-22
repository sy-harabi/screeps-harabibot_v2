import { botOptionsConsoleApi, type BotOptionsConsoleApi } from "./optionsConsoleApi"

export interface BotConsoleApi {
  help(): void
  options: BotOptionsConsoleApi
}

export const botConsoleApi: BotConsoleApi = {
  help(): void {
    console.log(`
bot.help()

bot.options.show()
bot.options.show("W1N1")
bot.options.setBasePlanVisual(true | false)
bot.options.clearBasePlanVisual()
bot.options.setRampartBuildRcl(6)
bot.options.setRampartBuildRcl(6, "W1N1")
bot.options.clearRampartBuildRcl()
bot.options.clearRampartBuildRcl("W1N1")
`)
  },

  options: botOptionsConsoleApi,
}

globalThis.bot = botConsoleApi
