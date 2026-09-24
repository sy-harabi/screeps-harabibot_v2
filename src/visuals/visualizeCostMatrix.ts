export function visualizeCostMatrix(roomName: string, costs: CostMatrix): void {
  const visual = new RoomVisual(roomName)

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const cost = costs.get(x, y)

      if (cost === 0) {
        continue
      }

      visual.text(String(cost), x, y, {
        font: 0.3,
        strokeWidth: 0.15,
        stroke: "#000000",
      })
    }
  }
}
