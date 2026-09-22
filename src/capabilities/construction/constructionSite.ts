let budgetTick = -1
let remainingBudget = 0

export function tryCreateConstructionSite(
  room: Room,
  x: number,
  y: number,
  structureType: BuildableStructureConstant,
): ScreepsReturnCode {
  prepareBudget()

  if (remainingBudget <= 0) {
    return ERR_FULL
  }

  const result = room.createConstructionSite(x, y, structureType)

  if (result === OK) {
    remainingBudget--
  }

  return result
}

function prepareBudget(): void {
  if (budgetTick === Game.time) {
    return
  }

  budgetTick = Game.time
  remainingBudget = MAX_CONSTRUCTION_SITES - Object.keys(Game.constructionSites).length
}

export function hasConstructionSiteBudget(): boolean {
  prepareBudget()
  return remainingBudget > 0
}
