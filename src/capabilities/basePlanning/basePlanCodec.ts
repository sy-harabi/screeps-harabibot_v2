import type { RoomCoordinate } from "../../world/map/roomCoordinate"
import { fromRoomIndex, toRoomIndex } from "../../world/map/roomGrid"
import type { BasePlan, PlannedStructure, PlannedStructureTag } from "./basePlan"

type PackedPlannedStructure = [StructureConstant, number, number, PackedStructureTag?]
type PackedCore = [manager: number, parking: number[]]
type PackedUpgradeChains = [left: number[], middle: number[], right: number[]]

type PackedStructureTag =
  | ["storage"]
  | ["controller"]
  | ["labInput"]
  | ["labOutput"]
  | ["source", Id<Source>]
  | ["mineral", Id<Mineral>]

export interface PackedBasePlan {
  formatVersion: 1
  roomName: string
  anchor: number
  structures: PackedPlannedStructure[]
  core: PackedCore
  upgradeChains: PackedUpgradeChains
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
    core: {
      manager: fromRoomIndex(packed.core[0]),
      parking: packed.core[1].map(fromRoomIndex),
    },
    controller: {
      upgradeChains: {
        left: packed.upgradeChains[0].map(fromRoomIndex),
        middle: packed.upgradeChains[1].map(fromRoomIndex),
        right: packed.upgradeChains[2].map(fromRoomIndex),
      },
    },
  }
}

export function packBasePlan(plan: BasePlan): PackedBasePlan {
  return {
    formatVersion: 1,
    roomName: plan.roomName,
    anchor: packCoordinate(plan.anchor),
    structures: plan.structures.map(packStructure),
    core: [packCoordinate(plan.core.manager), plan.core.parking.map(packCoordinate)],
    upgradeChains: [
      plan.controller.upgradeChains.left.map(packCoordinate),
      plan.controller.upgradeChains.middle.map(packCoordinate),
      plan.controller.upgradeChains.right.map(packCoordinate),
    ],
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
    return [structure.structureType, packCoordinate(structure.coordinate), structure.rcl]
  }

  return [structure.structureType, packCoordinate(structure.coordinate), structure.rcl, tag]
}

function packCoordinate(coordinate: RoomCoordinate): number {
  return toRoomIndex(coordinate.x, coordinate.y)
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

    case "labInput":
      return { kind: "labInput" }

    case "labOutput":
      return { kind: "labOutput" }

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

    case "labInput":
      return ["labInput"]

    case "labOutput":
      return ["labOutput"]

    case "source":
      return ["source", tag.id]

    case "mineral":
      return ["mineral", tag.id]
  }
}
