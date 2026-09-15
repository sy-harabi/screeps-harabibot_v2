export interface BotConsoleApi {
  help(): void;
}

export const botConsoleApi: BotConsoleApi = {
  help(): void {
    console.log(`
bot.help()

Available namespaces:
  bot.options
  bot.basePlan
  bot.operations
`);
  },
};

globalThis.bot = botConsoleApi;
