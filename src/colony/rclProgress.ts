import { getBotOptions } from "../options/botOptions"
import type { TickContext } from "../kernel/tickContext"

export type Rcl = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface RclProgressMemory {
  startTick: number
  highestRcl: Rcl
  reachedAt: Partial<Record<Rcl, number>>
}

export function updateRclProgress(context: TickContext): void {
  const visualize = getBotOptions().visuals.rclProgress

  for (const room of context.ownedRooms.values()) {
    const controller = room.controller

    if (controller === undefined) {
      continue
    }

    const currentRcl = controller.level as Rcl
    const progress = (room.memory.rclProgress ??= {
      startTick: Game.time,
      highestRcl: currentRcl,
      reachedAt: {},
    })

    if (currentRcl > progress.highestRcl) {
      progress.reachedAt[currentRcl] = Game.time
      progress.highestRcl = currentRcl
    }

    if (visualize) {
      visualizeRclProgress(room, progress)
    }
  }
}

function visualizeRclProgress(room: Room, progress: RclProgressMemory): void {
  const visual = new RoomVisual(room.name)
  const records: Array<readonly [Rcl, number]> = []

  for (let rcl = 1 as Rcl; rcl <= 8; rcl = (rcl + 1) as Rcl) {
    const reachedAt = progress.reachedAt[rcl]

    if (reachedAt !== undefined) {
      records.push([rcl, reachedAt])
    }
  }

  const x = 42
  const startY = 42
  const rowHeight = 0.7
  const height = (records.length + 1) * rowHeight + 0.4

  visual.rect(x - 0.4, startY - 0.65, 7.5, height, {
    fill: "#111111",
    opacity: 0.75,
    stroke: "#666666",
    strokeWidth: 0.05,
  })

  const style = {
    align: "left" as const,
    color: "#ffffff",
    font: 0.5,
    opacity: 0.9,
    stroke: "#000000",
    strokeWidth: 0.08,
  }

  let y = startY
  visual.text(`Tick: ${Game.time - progress.startTick + 1}`, x, y, style)
  y += rowHeight

  for (const [rcl, reachedAt] of records) {
    visual.text(`RCL${rcl}: ${reachedAt - progress.startTick + 1}`, x, y, style)
    y += rowHeight
  }
}
