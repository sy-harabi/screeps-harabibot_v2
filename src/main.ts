/** Screeps calls this exported function once per game tick. */
export function loop(): void {
  // Accessing Game here also verifies that the Screeps declarations are active.
  void Game.time;
}
