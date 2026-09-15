import type { BotConsoleApi } from "./console/consoleApi";

declare global {
  interface Console {
    log(...data: unknown[]): void;
    logUnsafe(...data: unknown[]): void;
  }

  var console: Console;
  var bot: BotConsoleApi;
}
