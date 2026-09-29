export interface HarvestVisualSourceRow {
  readonly roomName: string
  readonly sourceIndex: number
  readonly distance: number
  readonly minerRatio: number
  readonly haulerRatio: number
  readonly grossIncome: number
  readonly minerUpkeep?: number
  readonly haulerUpkeep?: number
  readonly infrastructureUpkeep?: number
  readonly income?: number
  readonly maxIncome?: number
  readonly spawnUsage?: number
  containerEnergy?: number
  droppedEnergy?: number
}

export interface HarvestVisualReservationRow {
  readonly roomName: string
  readonly upkeep: number
  readonly spawnUsage: number
}

interface HarvestVisualTotals {
  readonly income: number
  readonly maxIncome: number
  readonly spawnUsage: number
}

const FONT = 0.4
const ROW_HEIGHT = 0.58
const START_X = 0.7
const START_Y = 1

const COLUMNS = {
  room: 1,
  source: 8.2,
  distance: 10.8,
  mine: 14.2,
  haul: 17.7,
  gross: 21.4,
  miner: 24.6,
  hauler: 27.8,
  infra: 31,
  net: 36.5,
  spawn: 40.5,
  container: 45,
  dropped: 49,
} as const

export function visualizeHarvest(
  room: Room,
  sourceRows: readonly HarvestVisualSourceRow[],
  reservationRows: readonly HarvestVisualReservationRow[],
  totals: HarvestVisualTotals,
): void {
  const visual = new RoomVisual(room.name)
  const reservations = new Map(reservationRows.map((row) => [row.roomName, row]))
  const rowCount = sourceRows.length + reservationRows.length + 4
  const height = rowCount * ROW_HEIGHT + 0.5

  visual.rect(START_X - 0.4, START_Y - 0.65, 49.2, height, {
    fill: "#111111",
    opacity: 0.75,
    stroke: "#666666",
    strokeWidth: 0.05,
  })

  let y = START_Y

  visual.text("HARVEST ECONOMY", START_X, y, textStyle("left", 0.52))
  y += ROW_HEIGHT
  drawHeader(visual, y)
  y += ROW_HEIGHT

  let currentRoomName: string | undefined

  for (const row of sourceRows) {
    if (currentRoomName !== undefined && row.roomName !== currentRoomName) {
      y = drawReservation(visual, y, reservations.get(currentRoomName))
    }

    const sameRoom = row.roomName === currentRoomName
    drawSourceRow(visual, y, row, sameRoom)
    currentRoomName = row.roomName
    y += ROW_HEIGHT
  }

  if (currentRoomName !== undefined) {
    y = drawReservation(visual, y, reservations.get(currentRoomName))
  }

  y += 0.1
  visual.line(START_X, y - 0.35, 49.5, y - 0.35, { color: "#888888", opacity: 0.7, width: 0.03 })
  visual.text("TOTAL", COLUMNS.room, y, textStyle("left"))
  visual.text(`${format(totals.income)}/${format(totals.maxIncome)}`, COLUMNS.net, y, textStyle("right"))
  visual.text(format(totals.spawnUsage), COLUMNS.spawn, y, textStyle("right"))
}

function drawReservation(visual: RoomVisual, y: number, row: HarvestVisualReservationRow | undefined): number {
  if (row === undefined) {
    return y
  }

  visual.text("reserve", COLUMNS.source, y, textStyle("right"))
  visual.text(`-${format(row.upkeep)}`, COLUMNS.net, y, textStyle("right"))
  visual.text(format(row.spawnUsage), COLUMNS.spawn, y, textStyle("right"))

  return y + ROW_HEIGHT
}

function drawHeader(visual: RoomVisual, y: number): void {
  visual.text("Room", COLUMNS.room, y, textStyle("left"))
  visual.text("#", COLUMNS.source, y, textStyle("right"))
  visual.text("Dist", COLUMNS.distance, y, textStyle("right"))
  visual.text("Mine", COLUMNS.mine, y, textStyle("right"))
  visual.text("Haul", COLUMNS.haul, y, textStyle("right"))
  visual.text("Gross", COLUMNS.gross, y, textStyle("right"))
  visual.text("M", COLUMNS.miner, y, textStyle("right"))
  visual.text("H", COLUMNS.hauler, y, textStyle("right"))
  visual.text("I", COLUMNS.infra, y, textStyle("right"))
  visual.text("Net/Max", COLUMNS.net, y, textStyle("right"))
  visual.text("Spawn", COLUMNS.spawn, y, textStyle("right"))
  visual.text("Cont", COLUMNS.container, y, textStyle("right"))
  visual.text("Drop", COLUMNS.dropped, y, textStyle("right"))
}

function drawSourceRow(visual: RoomVisual, y: number, row: HarvestVisualSourceRow, sameRoomAsPrevious: boolean): void {
  visual.text(sameRoomAsPrevious ? "" : row.roomName, COLUMNS.room, y, textStyle("left"))
  visual.text(String(row.sourceIndex), COLUMNS.source, y, textStyle("right"))
  visual.text(String(row.distance), COLUMNS.distance, y, textStyle("right"))
  visual.text(percent(row.minerRatio), COLUMNS.mine, y, textStyle("right"))
  visual.text(percent(row.haulerRatio), COLUMNS.haul, y, textStyle("right"))
  visual.text(format(row.grossIncome), COLUMNS.gross, y, textStyle("right"))
  visual.text(integer(row.containerEnergy ?? 0), COLUMNS.container, y, textStyle("right"))
  visual.text(integer(row.droppedEnergy ?? 0), COLUMNS.dropped, y, textStyle("right"))

  if (row.income === undefined) {
    visual.text("-", COLUMNS.miner, y, textStyle("right"))
    visual.text("-", COLUMNS.hauler, y, textStyle("right"))
    visual.text("-", COLUMNS.infra, y, textStyle("right"))
    visual.text("-", COLUMNS.net, y, textStyle("right"))
    visual.text("-", COLUMNS.spawn, y, textStyle("right"))
    return
  }

  visual.text(format(row.minerUpkeep ?? 0), COLUMNS.miner, y, textStyle("right"))
  visual.text(format(row.haulerUpkeep ?? 0), COLUMNS.hauler, y, textStyle("right"))
  visual.text(format(row.infrastructureUpkeep ?? 0), COLUMNS.infra, y, textStyle("right"))
  visual.text(`${format(row.income)}/${format(row.maxIncome ?? 0)}`, COLUMNS.net, y, textStyle("right"))
  visual.text(format(row.spawnUsage ?? 0), COLUMNS.spawn, y, textStyle("right"))
}

function textStyle(align: "left" | "right" | "center", font = FONT) {
  return {
    align,
    color: "#ffffff",
    font,
    opacity: 0.9,
    stroke: "#000000",
    strokeWidth: 0.08,
  }
}

function percent(value: number): string {
  return `${Math.round(Math.min(1, value) * 100)}%`
}

function format(value: number): string {
  return value.toFixed(2)
}

function integer(value: number): string {
  return Math.round(value).toString()
}
