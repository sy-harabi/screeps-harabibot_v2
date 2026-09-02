import { beforeEach, describe, expect, it, vi } from "vitest";

import { loop } from "../src/main";

describe("Screeps entry point", () => {
  beforeEach(() => {
    vi.stubGlobal("Game", { time: 1 } as Game);
  });

  it("runs one tick with the Screeps global available", () => {
    expect(loop).not.toThrow();
  });
});
