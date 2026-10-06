import type { HarvestSourceState } from "./harvestState"

const PATH_COLORS = ["#00ffff", "#ffcc00", "#ff66cc", "#66ff66", "#6699ff", "#ff9966"]

export function visualizeHarvestPaths(sourceStates: readonly HarvestSourceState[]): void {
  const visuals = new Map<string, RoomVisual>()

  for (let sourceIndex = 0; sourceIndex < sourceStates.length; sourceIndex++) {
    const path = sourceStates[sourceIndex].path

    if (path.length === 0) {
      continue
    }

    const color = PATH_COLORS[sourceIndex % PATH_COLORS.length]

    for (let i = 1; i < path.length; i++) {
      const previous = path[i - 1]
      const current = path[i]

      if (previous.roomName !== current.roomName) {
        continue
      }

      getVisual(visuals, current.roomName).line(previous.x, previous.y, current.x, current.y, {
        color,
        opacity: 0.7,
        width: 0.15,
      })
    }

    const end = path[path.length - 1]

    getVisual(visuals, end.roomName).text(String(sourceIndex + 1), end.x + 0.3, end.y + 0.3, {
      align: "left",
      color,
      font: 0.4,
      opacity: 0.9,
      stroke: "#000000",
      strokeWidth: 0.08,
    })
  }
}

function getVisual(visuals: Map<string, RoomVisual>, roomName: string): RoomVisual {
  let visual = visuals.get(roomName)

  if (visual === undefined) {
    visual = new RoomVisual(roomName)
    visuals.set(roomName, visual)
  }

  return visual
}
