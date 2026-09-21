import type { PlannedStructure } from "./basePlan"

export function visualizeBasePlanStructures(structures: readonly PlannedStructure[], visual: RoomVisual): void {
  visual.clear()
  visual.roads = []

  for (const structure of structures) {
    const { x, y } = structure.coordinate
    visual.structure(x, y, structure.structureType)
  }

  visual.connectRoads()

  for (const structure of structures) {
    const { x, y } = structure.coordinate
    const label = structure.tag?.kind === "rampartBuild" ? "R" : String(structure.rcl)

    visual.text(label, x + 0.26, y + 0.36, {
      align: "left",
      font: 0.35,
      opacity: 0.9,
    })
  }
}
