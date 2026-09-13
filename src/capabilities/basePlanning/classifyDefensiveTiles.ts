import {
  forEachCoordinateInRange,
  fromRoomIndex,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";
import type { OuterRampartPlan } from "./planOuterRamparts";

const RANGED_ATTACK_RANGE = 3;
const REPAIR_RANGE = 3;

export interface DefensiveTileClassification {
  /** Interior tiles that can be hit by a ranged attacker standing outside. */
  readonly dangerousMask: Uint8Array;

  /** Safe interior tiles that can repair at least one outer rampart. */
  readonly safeRepairCandidateMask: Uint8Array;

  /**
   * Interior tiles that can repair at least one outer rampart but are exposed
   * to outside ranged attacks. Using one as a repair position requires adding
   * a rampart on that tile.
   */
  readonly rampartRequiredRepairCandidateMask: Uint8Array;
}

/**
 * Classifies defensive tiles after the outer rampart line is fixed.
 *
 * The three categories deliberately exclude the outer rampart tiles
 * themselves. Repairers are expected to stand behind the outer line, while
 * defenders may occupy the outer ramparts separately.
 */
export function classifyDefensiveTiles(
  outerRampartPlan: OuterRampartPlan,
  visual?: RoomVisual,
): DefensiveTileClassification {
  const dangerousMask = buildDangerousMask(outerRampartPlan);
  const repairRangeMask = buildRepairRangeMask(outerRampartPlan);
  const safeRepairCandidateMask = new Uint8Array(ROOM_AREA);
  const rampartRequiredRepairCandidateMask = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    if (!repairRangeMask[index]) {
      continue;
    }

    if (dangerousMask[index]) {
      rampartRequiredRepairCandidateMask[index] = 1;
    } else {
      safeRepairCandidateMask[index] = 1;
    }
  }

  if (visual) {
    visualizeDefensiveTiles(
      dangerousMask,
      safeRepairCandidateMask,
      rampartRequiredRepairCandidateMask,
      visual,
    );
  }

  return {
    dangerousMask,
    safeRepairCandidateMask,
    rampartRequiredRepairCandidateMask,
  };
}

function buildDangerousMask(
  outerRampartPlan: OuterRampartPlan,
): Uint8Array {
  const dangerousMask = new Uint8Array(ROOM_AREA);

  for (let outsideIndex = 0; outsideIndex < ROOM_AREA; outsideIndex++) {
    if (!outerRampartPlan.outsideMask[outsideIndex]) {
      continue;
    }

    const outside = fromRoomIndex(outsideIndex);

    forEachCoordinateInRange(outside, RANGED_ATTACK_RANGE, (x, y) => {
      const index = toRoomIndex(x, y);

      if (outerRampartPlan.insideMask[index]) {
        dangerousMask[index] = 1;
      }
    });
  }

  return dangerousMask;
}

function buildRepairRangeMask(
  outerRampartPlan: OuterRampartPlan,
): Uint8Array {
  const repairRangeMask = new Uint8Array(ROOM_AREA);

  for (const rampart of outerRampartPlan.ramparts) {
    forEachCoordinateInRange(rampart, REPAIR_RANGE, (x, y) => {
      const index = toRoomIndex(x, y);

      if (outerRampartPlan.insideMask[index]) {
        repairRangeMask[index] = 1;
      }
    });
  }

  return repairRangeMask;
}

function visualizeDefensiveTiles(
  dangerousMask: Uint8Array,
  safeRepairCandidateMask: Uint8Array,
  rampartRequiredRepairCandidateMask: Uint8Array,
  visual: RoomVisual,
): void {
  for (let index = 0; index < ROOM_AREA; index++) {
    const { x, y } = fromRoomIndex(index);

    if (dangerousMask[index]) {
      visual.rect(x - 0.5, y - 0.5, 1, 1, {
        fill: "#ff4d4d",
        opacity: 0.18,
        stroke: "transparent",
      });
    }

    if (safeRepairCandidateMask[index]) {
      visual.circle(x, y, {
        radius: 0.12,
        fill: "#62d26f",
        opacity: 0.9,
        stroke: "transparent",
      });
      continue;
    }

    if (rampartRequiredRepairCandidateMask[index]) {
      visual.circle(x, y, {
        radius: 0.12,
        fill: "#ffb347",
        opacity: 0.9,
        stroke: "transparent",
      });
    }
  }
}
