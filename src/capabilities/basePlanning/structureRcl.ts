export function getStructureRcl(structureType: BuildableStructureConstant, ordinal: number): number {
  const limits = CONTROLLER_STRUCTURES[structureType] as Record<number, number>

  for (let rcl = 1; rcl <= 8; rcl++) {
    if ((limits[rcl] ?? 0) > ordinal) {
      return rcl
    }
  }

  throw new Error(`No RCL available for ${structureType} structure ordinal ${ordinal}`)
}
