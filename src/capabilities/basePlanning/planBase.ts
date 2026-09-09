import { distanceTransform } from "../../world/map/distanceTransform";
import { RoomCoordinate } from "../../world/map/roomCoordinate";
import { fromRoomIndex, toRoomIndex } from "../../world/map/roomGrid";
import { findTerrainRegions } from "../../world/map/terrainRegions";
import type { BasePlan, PlannedStructure } from "./basePlan";
import {
  findTerminalCandidates,
  findUpgradeRoots,
  findUpgradeTiles,
  followUpgradeWall,
} from "./planControllerArea";
import { selectBaseRegions } from "./selectBaseRegions";

/**
 * Base planner entry point for the Screeps runtime.
 */
export function planBase(
  roomName: string,
  terrain: RoomTerrain,
  controller: StructureController,
  sources: Source[],
  mineral: Mineral[],
): BasePlan {
  const distances = distanceTransform(terrain);

  const { regionByTile, regions } = findTerrainRegions(terrain, distances);

  const visual = new RoomVisual(roomName);

  const selectedRegionIds = selectBaseRegions(
    controller,
    regionByTile,
    regions,
  );

  for (const region of regions) {
    if (selectedRegionIds.has(region.id)) {
      region.tileIndices.forEach((index) => {
        const { x, y } = fromRoomIndex(index);
        const color = getRegionColor(region.id, regions.length);
        visual.rect(x - 0.5, y - 0.5, 1, 1, {
          fill: color,
          opacity: 0.3,
          stroke: "transparent",
        });
      });
    }
  }

  const terminalCandidates = findTerminalCandidates(
    controller,
    selectedRegionIds,
    regionByTile,
  );

  terminalCandidates.forEach(({ x, y }) => visual.text("T", x, y));

  const terminalCoordinate = terminalCandidates[0];
  if (terminalCoordinate) {
    const upgradeTiles = findUpgradeTiles(
      controller,
      selectedRegionIds,
      regionByTile,
    );
    const upgradeTileIndices = new Set(
      upgradeTiles.map(({ x, y }) => toRoomIndex(x, y)),
    );

    upgradeTiles.forEach(({ x, y }) => {
      visual.circle(x, y, {
        radius: 0.12,
        fill: "white",
        opacity: 0.5,
        stroke: "transparent",
      });
    });

    visual.circle(terminalCoordinate.x, terminalCoordinate.y, {
      radius: 0.4,
      fill: "transparent",
      stroke: "white",
    });

    const roots = findUpgradeRoots(
      terminalCoordinate,
      controller,
      upgradeTileIndices,
    );

    if (roots?.left) {
      const leftPath = followUpgradeWall(
        roots.left,
        terminalCoordinate,
        upgradeTileIndices,
        "left",
      );
      visualizeUpgradePath(visual, leftPath, "L", "#ffd166");
    }

    if (roots?.middle) {
      visual.text("M", roots.middle.x, roots.middle.y, {
        color: "#ffffff",
        font: 0.5,
      });
    }

    if (roots?.right) {
      const rightPath = followUpgradeWall(
        roots.right,
        terminalCoordinate,
        upgradeTileIndices,
        "right",
      );
      visualizeUpgradePath(visual, rightPath, "R", "#4cc9f0");
    }
  }

  const structures: PlannedStructure[] = [];
  const anchor = { x: 25, y: 25 };

  return { version: 1, roomName, anchor, structures };
}

function visualizeUpgradePath(
  visual: RoomVisual,
  path: RoomCoordinate[],
  label: string,
  color: string,
): void {
  path.forEach((coordinate, index) => {
    if (index > 0) {
      const previous = path[index - 1];
      visual.arrow(
        new RoomPosition(previous.x, previous.y, visual.roomName),
        new RoomPosition(coordinate.x, coordinate.y, visual.roomName),
        {
          color,
          opacity: 0.8,
        },
      );
    }

    visual.text(`${label}${index + 1}`, coordinate.x, coordinate.y, {
      color,
      font: 0.45,
    });
  });
}

function getRegionColor(regionId: number, regionCount: number): string {
  const hue = (regionId * 360) / regionCount;
  return `hsl(${hue}, 70%, 50%)`;
}
