interface Console {
  log(...data: unknown[]): void;
  logUnsafe(...data: unknown[]): void;
}

declare var console: Console;
