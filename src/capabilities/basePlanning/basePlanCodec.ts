import { fromRoomIndex, toRoomIndex } from "../../world/map/roomGrid"
import type { BasePlan, PlannedStructure, PlannedStructureTag } from "./basePlan"

type PackedPlannedStructure = [StructureConstant, number, number, PackedStructureTag?]

type PackedStructureTag = ["storage"] | ["controller"] | ["source", Id<Source>] | ["mineral", Id<Mineral>]

export interface PackedBasePlan {
  formatVersion: 1
  roomName: string
  anchor: number
  structures: PackedPlannedStructure[]
}

export function unpackBasePlan(packed: PackedBasePlan): BasePlan {
  if (packed.formatVersion !== 1) {
    throw new Error(`Unsupported base plan format version: ${packed.formatVersion}`)
  }

  return {
    version: 1,
    roomName: packed.roomName,
    anchor: fromRoomIndex(packed.anchor),
    structures: packed.structures.map(unpackStructure),
  }
}

export function packBasePlan(plan: BasePlan): PackedBasePlan {
  return {
    formatVersion: 1,
    roomName: plan.roomName,
    anchor: toRoomIndex(plan.anchor.x, plan.anchor.y),
    structures: plan.structures.map(packStructure),
  }
}

function unpackStructure(packed: PackedPlannedStructure): PlannedStructure {
  return {
    structureType: packed[0],
    coordinate: fromRoomIndex(packed[1]),
    rcl: packed[2],
    tag: unpackTag(packed[3]),
  }
}

function packStructure(structure: PlannedStructure): PackedPlannedStructure {
  const tag = packTag(structure.tag)

  if (tag === undefined) {
    return [structure.structureType, toRoomIndex(structure.coordinate.x, structure.coordinate.y), structure.rcl]
  }

  return [structure.structureType, toRoomIndex(structure.coordinate.x, structure.coordinate.y), structure.rcl, tag]
}

function unpackTag(tag: PackedStructureTag | undefined): PlannedStructureTag | undefined {
  if (tag === undefined) {
    return undefined
  }

  switch (tag[0]) {
    case "storage":
      return { kind: "storage" }

    case "controller":
      return { kind: "controller" }

    case "source":
      return {
        kind: "source",
        id: tag[1],
      }

    case "mineral":
      return {
        kind: "mineral",
        id: tag[1],
      }
  }
}

function packTag(tag: PlannedStructureTag | undefined): PackedStructureTag | undefined {
  if (tag === undefined) {
    return undefined
  }

  switch (tag.kind) {
    case "storage":
      return ["storage"]

    case "controller":
      return ["controller"]

    case "source":
      return ["source", tag.id]

    case "mineral":
      return ["mineral", tag.id]
  }
}
