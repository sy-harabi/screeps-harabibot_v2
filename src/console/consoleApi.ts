import {
  BotOptionsConsoleApi,
  botOptionsConsoleApi,
} from "./optionsConsoleApi";

export interface BotConsoleApi {
  help(): void;
  options: BotOptionsConsoleApi;
}

export const botConsoleApi: BotConsoleApi = {
  help(): void {
    console.log(`
bot.help()

bot.options.show()
bot.options.setBasePlanVisual(true | false)
bot.options.clearBasePlanVisual()
`);
  },

  options: botOptionsConsoleApi,
};

globalThis.bot = botConsoleApi;
