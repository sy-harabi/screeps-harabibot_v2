import {
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_SIZE,
  toRoomIndex,
} from "../world/map/roomGrid";

export type Point = [number, number];

export interface RoomVisualOptions {
  color?: string;
  opacity?: number;
  textfont?: string;
  textsize?: number;
  textstyle?: string;
}

export interface ArrowVisualOptions {
  color?: string;
  opacity?: number;
}

declare global {
  interface RoomVisual {
    roads?: Point[];

    box(
      x: number,
      y: number,
      w: number,
      h: number,
      style?: LineStyle,
    ): RoomVisual;

    arrow(
      from: RoomPosition,
      to: RoomPosition,
      opts?: ArrowVisualOptions,
    ): RoomVisual;

    multitext(
      textLines: string[],
      x: number,
      y: number,
      opts?: RoomVisualOptions,
    ): RoomVisual;

    structure(
      x: number,
      y: number,
      type: StructureConstant,
      opts?: RoomVisualOptions,
    ): RoomVisual;

    connectRoads(opts?: RoomVisualOptions): RoomVisual;

    resource(
      type: ResourceConstant,
      x: number,
      y: number,
      size?: number,
      opacity?: number,
    ): RoomVisual;
  }
}

RoomVisual.prototype.multitext = function (
  this: RoomVisual,
  textLines: string[],
  x: number,
  y: number,
  opts: RoomVisualOptions = {},
): RoomVisual {
  opts = {
    color: opts.color ?? colors.infoBoxGood,
    textsize: opts.textsize ?? speechSize,
    textfont: opts.textfont ?? "verdana",
    opacity: opts.opacity ?? 0.7,
    textstyle: opts.textstyle,
  };

  let fontstring = "";
  if (opts.textstyle) {
    fontstring = opts.textstyle + " ";
  }
  fontstring += opts.textsize + " " + opts.textfont;

  let dy = 0;
  for (const line of textLines) {
    this.text(line, x, y + dy, {
      color: opts.color,
      backgroundPadding: 0.1,
      opacity: opts.opacity,
      font: fontstring,
      align: "left",
    });
    dy += opts.textsize!;
  }

  return this;
};

RoomVisual.prototype.box = function (
  this: RoomVisual,
  x: number,
  y: number,
  w: number,
  h: number,
  style?: LineStyle,
): RoomVisual {
  return this.line(x, y, x + w, y, style)
    .line(x + w, y, x + w, y + h, style)
    .line(x + w, y + h, x, y + h, style)
    .line(x, y + h, x, y, style);
};

RoomVisual.prototype.arrow = function (
  this: RoomVisual,
  from: RoomPosition,
  to: RoomPosition,
  opts: ArrowVisualOptions = {},
): RoomVisual {
  if (from.roomName !== to.roomName) {
    return this;
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) {
    return this;
  }

  const length = Math.hypot(dx, dy);
  const unitX = dx / length;
  const unitY = dy / length;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;

  const startX = from.x + dx * 0.2;
  const startY = from.y + dy * 0.2;
  const neckX = from.x + dx * 0.58;
  const neckY = from.y + dy * 0.58;
  const tipX = from.x + dx * 0.82;
  const tipY = from.y + dy * 0.82;

  const tailHalfWidth = 0.025;
  const shaftHalfWidth = 0.05;
  const headHalfWidth = 0.16;

  const points: Point[] = [
    [
      startX - perpendicularX * tailHalfWidth,
      startY - perpendicularY * tailHalfWidth,
    ],
    [
      neckX - perpendicularX * shaftHalfWidth,
      neckY - perpendicularY * shaftHalfWidth,
    ],
    [
      neckX - perpendicularX * headHalfWidth,
      neckY - perpendicularY * headHalfWidth,
    ],
    [tipX, tipY],
    [
      neckX + perpendicularX * headHalfWidth,
      neckY + perpendicularY * headHalfWidth,
    ],
    [
      neckX + perpendicularX * shaftHalfWidth,
      neckY + perpendicularY * shaftHalfWidth,
    ],
    [
      startX + perpendicularX * tailHalfWidth,
      startY + perpendicularY * tailHalfWidth,
    ],
  ];

  const color = opts.color ?? "#ff5c5c";

  return this.poly(points, {
    fill: color,
    stroke: color,
    strokeWidth: 0.02,
    opacity: opts.opacity ?? 0.9,
  });
};

// Taken from https://github.com/screepers/RoomVisual with slight modification.

const colors = {
  gray: "#555555",
  light: "#AAAAAA",
  road: "#666",
  energy: "#FFE87B",
  power: "#F53547",
  dark: "#181818",
  outline: "#8FBB93",
  infoBoxGood: "#09ff00",
};

const speechSize = 0.5;

function calculateFactoryLevelGaps(): Point[] {
  let x = -0.08;
  let y = -0.52;
  const result: Point[] = [];

  const gapAngle = 16 * (Math.PI / 180);
  const gapCos = Math.cos(gapAngle);
  const gapSin = Math.sin(gapAngle);

  const rotationAngle = 72 * (Math.PI / 180);
  const rotationCos = Math.cos(rotationAngle);
  const rotationSin = Math.sin(rotationAngle);

  for (let i = 0; i < 5; i++) {
    result.push([0, 0]);
    result.push([x, y]);
    result.push([x * gapCos - y * gapSin, x * gapSin + y * gapCos]);

    const nextX = x * rotationCos - y * rotationSin;
    y = x * rotationSin + y * rotationCos;
    x = nextX;
  }

  return result;
}

const FACTORY_LEVEL_GAPS = calculateFactoryLevelGaps();

RoomVisual.prototype.structure = function (
  this: RoomVisual,
  x: number,
  y: number,
  type: StructureConstant,
  opts: RoomVisualOptions = {},
): RoomVisual {
  opts = {
    ...opts,
    opacity: opts.opacity ?? 0.5,
  };

  switch (type) {
    case STRUCTURE_FACTORY: {
      const outline = relPoly(x, y, [
        [-0.68, -0.11],
        [-0.84, -0.18],
        [-0.84, -0.32],
        [-0.44, -0.44],
        [-0.32, -0.84],
        [-0.18, -0.84],
        [-0.11, -0.68],
        [0.11, -0.68],
        [0.18, -0.84],
        [0.32, -0.84],
        [0.44, -0.44],
        [0.84, -0.32],
        [0.84, -0.18],
        [0.68, -0.11],
        [0.68, 0.11],
        [0.84, 0.18],
        [0.84, 0.32],
        [0.44, 0.44],
        [0.32, 0.84],
        [0.18, 0.84],
        [0.11, 0.68],
        [-0.11, 0.68],
        [-0.18, 0.84],
        [-0.32, 0.84],
        [-0.44, 0.44],
        [-0.84, 0.32],
        [-0.84, 0.18],
        [-0.68, 0.11],
      ]);
      this.poly(outline, {
        fill: undefined,
        stroke: colors.outline,
        strokeWidth: 0.05,
        opacity: opts.opacity,
      });

      this.circle(x, y, {
        radius: 0.65,
        fill: "#232323",
        strokeWidth: 0.035,
        stroke: "#140a0a",
        opacity: opts.opacity,
      });

      const spikes = relPoly(x, y, [
        [-0.4, -0.1],
        [-0.8, -0.2],
        [-0.8, -0.3],
        [-0.4, -0.4],
        [-0.3, -0.8],
        [-0.2, -0.8],
        [-0.1, -0.4],
        [0.1, -0.4],
        [0.2, -0.8],
        [0.3, -0.8],
        [0.4, -0.4],
        [0.8, -0.3],
        [0.8, -0.2],
        [0.4, -0.1],
        [0.4, 0.1],
        [0.8, 0.2],
        [0.8, 0.3],
        [0.4, 0.4],
        [0.3, 0.8],
        [0.2, 0.8],
        [0.1, 0.4],
        [-0.1, 0.4],
        [-0.2, 0.8],
        [-0.3, 0.8],
        [-0.4, 0.4],
        [-0.8, 0.3],
        [-0.8, 0.2],
        [-0.4, 0.1],
      ]);
      this.poly(spikes, {
        fill: colors.gray,
        stroke: "#140a0a",
        strokeWidth: 0.04,
        opacity: opts.opacity,
      });

      this.circle(x, y, {
        radius: 0.54,
        fill: "#302a2a",
        strokeWidth: 0.04,
        stroke: "#140a0a",
        opacity: opts.opacity,
      });
      this.poly(relPoly(x, y, FACTORY_LEVEL_GAPS), {
        fill: "#140a0a",
        stroke: undefined,
        opacity: opts.opacity,
      });
      this.circle(x, y, {
        radius: 0.42,
        fill: "#140a0a",
        opacity: opts.opacity,
      });
      this.rect(x - 0.24, y - 0.24, 0.48, 0.48, {
        fill: "#3f3f3f",
        opacity: opts.opacity,
      });
      break;
    }
    case STRUCTURE_EXTENSION:
      this.circle(x, y, {
        radius: 0.5,
        fill: colors.dark,
        stroke: colors.outline,
        strokeWidth: 0.05,
        opacity: opts.opacity,
      });
      this.circle(x, y, {
        radius: 0.35,
        fill: colors.gray,
        opacity: opts.opacity,
      });
      break;
    case STRUCTURE_SPAWN:
      this.circle(x, y, {
        radius: 0.65,
        fill: colors.dark,
        stroke: "#CCCCCC",
        strokeWidth: 0.1,
        opacity: opts.opacity,
      });
      this.circle(x, y, {
        radius: 0.4,
        fill: colors.energy,
        opacity: opts.opacity,
      });
      break;
    case STRUCTURE_POWER_SPAWN:
      this.circle(x, y, {
        radius: 0.65,
        fill: colors.dark,
        stroke: colors.power,
        strokeWidth: 0.1,
        opacity: opts.opacity,
      });
      this.circle(x, y, {
        radius: 0.4,
        fill: colors.energy,
        opacity: opts.opacity,
      });
      break;
    case STRUCTURE_LINK: {
      let outer: Point[] = [
        [0, -0.5],
        [0.4, 0],
        [0, 0.5],
        [-0.4, 0],
      ];
      let inner: Point[] = [
        [0, -0.3],
        [0.25, 0],
        [0, 0.3],
        [-0.25, 0],
      ];
      outer = relPoly(x, y, outer);
      inner = relPoly(x, y, inner);
      outer.push(outer[0]);
      inner.push(inner[0]);
      this.poly(outer, {
        fill: colors.dark,
        stroke: colors.outline,
        strokeWidth: 0.05,
        opacity: opts.opacity,
      });
      this.poly(inner, {
        fill: colors.gray,
        opacity: opts.opacity,
      });
      break;
    }
    case STRUCTURE_TERMINAL: {
      let outer: Point[] = [
        [0, -0.8],
        [0.55, -0.55],
        [0.8, 0],
        [0.55, 0.55],
        [0, 0.8],
        [-0.55, 0.55],
        [-0.8, 0],
        [-0.55, -0.55],
      ];
      let inner: Point[] = [
        [0, -0.65],
        [0.45, -0.45],
        [0.65, 0],
        [0.45, 0.45],
        [0, 0.65],
        [-0.45, 0.45],
        [-0.65, 0],
        [-0.45, -0.45],
      ];
      outer = relPoly(x, y, outer);
      inner = relPoly(x, y, inner);
      outer.push(outer[0]);
      inner.push(inner[0]);
      this.poly(outer, {
        fill: colors.dark,
        stroke: colors.outline,
        strokeWidth: 0.05,
        opacity: opts.opacity,
      });
      this.poly(inner, {
        fill: colors.light,
        opacity: opts.opacity,
      });
      this.rect(x - 0.45, y - 0.45, 0.9, 0.9, {
        fill: colors.gray,
        stroke: colors.dark,
        strokeWidth: 0.1,
        opacity: opts.opacity,
      });
      break;
    }
    case STRUCTURE_LAB:
      this.circle(x, y - 0.025, {
        radius: 0.55,
        fill: colors.dark,
        stroke: colors.outline,
        strokeWidth: 0.05,
        opacity: opts.opacity,
      });
      this.circle(x, y - 0.025, {
        radius: 0.4,
        fill: colors.gray,
        opacity: opts.opacity,
      });
      this.rect(x - 0.45, y + 0.3, 0.9, 0.25, {
        fill: colors.dark,
        opacity: opts.opacity,
      });
      {
        const box = relPoly(x, y, [
          [-0.45, 0.3],
          [-0.45, 0.55],
          [0.45, 0.55],
          [0.45, 0.3],
        ]);
        this.poly(box, {
          stroke: colors.outline,
          strokeWidth: 0.05,
          opacity: opts.opacity,
        });
      }
      break;
    case STRUCTURE_TOWER:
      this.circle(x, y, {
        radius: 0.6,
        fill: colors.dark,
        stroke: colors.outline,
        strokeWidth: 0.05,
        opacity: opts.opacity,
      });
      this.rect(x - 0.4, y - 0.3, 0.8, 0.6, {
        fill: colors.gray,
        opacity: opts.opacity,
      });
      this.rect(x - 0.2, y - 0.9, 0.4, 0.5, {
        fill: colors.light,
        stroke: colors.dark,
        strokeWidth: 0.07,
        opacity: opts.opacity,
      });
      break;
    case STRUCTURE_ROAD:
      this.circle(x, y, {
        radius: 0.175,
        fill: opts.color ?? colors.road,
        opacity: opts.opacity,
      });
      this.roads ??= [];
      this.roads.push([x, y]);
      break;
    case STRUCTURE_RAMPART:
      this.circle(x, y, {
        radius: 0.65,
        fill: "#434C43",
        stroke: "#5D735F",
        strokeWidth: 0.1,
        opacity: opts.opacity,
      });
      break;
    case STRUCTURE_WALL:
      this.circle(x, y, {
        radius: 0.4,
        fill: colors.dark,
        stroke: colors.light,
        strokeWidth: 0.05,
        opacity: opts.opacity,
      });
      break;
    case STRUCTURE_STORAGE: {
      const storageOutline = relPoly(x, y, [
        [-0.45, -0.55],
        [0, -0.65],
        [0.45, -0.55],
        [0.55, 0],
        [0.45, 0.55],
        [0, 0.65],
        [-0.45, 0.55],
        [-0.55, 0],
        [-0.45, -0.55],
      ]);
      this.poly(storageOutline, {
        stroke: colors.outline,
        strokeWidth: 0.05,
        fill: colors.dark,
        opacity: opts.opacity,
      });
      this.rect(x - 0.35, y - 0.45, 0.7, 0.9, {
        fill: colors.energy,
        opacity: opts.opacity,
      });
      break;
    }
    case STRUCTURE_OBSERVER:
      this.circle(x, y, {
        fill: colors.dark,
        radius: 0.45,
        stroke: colors.outline,
        strokeWidth: 0.05,
        opacity: opts.opacity,
      });
      this.circle(x + 0.225, y, {
        fill: colors.outline,
        radius: 0.2,
        opacity: opts.opacity,
      });
      break;
    case STRUCTURE_NUKER: {
      const outline = relPoly(x, y, [
        [0, -1],
        [-0.47, 0.2],
        [-0.5, 0.5],
        [0.5, 0.5],
        [0.47, 0.2],
        [0, -1],
      ]);
      this.poly(outline, {
        stroke: colors.outline,
        strokeWidth: 0.05,
        fill: colors.dark,
        opacity: opts.opacity,
      });
      const inline = relPoly(x, y, [
        [0, -0.8],
        [-0.4, 0.2],
        [0.4, 0.2],
        [0, -0.8],
      ]);
      this.poly(inline, {
        stroke: colors.outline,
        strokeWidth: 0.01,
        fill: colors.gray,
        opacity: opts.opacity,
      });
      break;
    }
    case STRUCTURE_CONTAINER:
      this.rect(x - 0.225, y - 0.3, 0.45, 0.6, {
        fill: colors.gray,
        opacity: opts.opacity,
        stroke: colors.dark,
        strokeWidth: 0.09,
      });
      this.rect(x - 0.17, y + 0.07, 0.34, 0.2, {
        fill: colors.energy,
        opacity: opts.opacity,
      });
      break;
    default:
      this.circle(x, y, {
        fill: colors.light,
        radius: 0.35,
        stroke: colors.dark,
        strokeWidth: 0.2,
        opacity: opts.opacity,
      });
      break;
  }

  return this;
};

RoomVisual.prototype.connectRoads = function (
  this: RoomVisual,
  opts: RoomVisualOptions = {},
): RoomVisual {
  opts = {
    ...opts,
    opacity: opts.opacity ?? 0.5,
  };
  const color = opts.color ?? colors.road;

  if (!this.roads) {
    return this;
  }

  const roadIndices = new Set(this.roads.map(([x, y]) => toRoomIndex(x, y)));

  for (const [x, y] of this.roads) {
    for (let direction = 0; direction <= 3; direction++) {
      const offset = NEIGHBOR_OFFSETS[direction];
      const neighborX = x + offset.x;
      const neighborY = y + offset.y;

      if (!isInsideRoom(neighborX, neighborY)) {
        continue;
      }

      const hasNeighborRoad = roadIndices.has(
        toRoomIndex(neighborX, neighborY),
      );

      if (hasNeighborRoad) {
        this.line(x, y, neighborX, neighborY, {
          color,
          width: 0.35,
          opacity: opts.opacity,
        });
      }
    }
  }

  return this;
};

function relPoly(x: number, y: number, poly: Point[]): Point[] {
  return poly.map(([pointX, pointY]): Point => [pointX + x, pointY + y]);
}

const ColorSets: { [color: string]: [string, string] } = {
  white: ["#ffffff", "#4c4c4c"],
  grey: ["#b4b4b4", "#4c4c4c"],
  red: ["#ff7b7b", "#592121"],
  yellow: ["#fdd388", "#5d4c2e"],
  green: ["#00f4a2", "#236144"],
  blue: ["#50d7f9", "#006181"],
  purple: ["#a071ff", "#371383"],
};

const ResourceColors: { [color: string]: [string, string] } = {
  [RESOURCE_ENERGY]: ColorSets.yellow,
  [RESOURCE_POWER]: ColorSets.red,

  [RESOURCE_HYDROGEN]: ColorSets.grey,
  [RESOURCE_OXYGEN]: ColorSets.grey,
  [RESOURCE_UTRIUM]: ColorSets.blue,
  [RESOURCE_LEMERGIUM]: ColorSets.green,
  [RESOURCE_KEANIUM]: ColorSets.purple,
  [RESOURCE_ZYNTHIUM]: ColorSets.yellow,
  [RESOURCE_CATALYST]: ColorSets.red,
  [RESOURCE_GHODIUM]: ColorSets.white,

  [RESOURCE_HYDROXIDE]: ColorSets.grey,
  [RESOURCE_ZYNTHIUM_KEANITE]: ColorSets.grey,
  [RESOURCE_UTRIUM_LEMERGITE]: ColorSets.grey,

  [RESOURCE_UTRIUM_HYDRIDE]: ColorSets.blue,
  [RESOURCE_UTRIUM_OXIDE]: ColorSets.blue,
  [RESOURCE_KEANIUM_HYDRIDE]: ColorSets.purple,
  [RESOURCE_KEANIUM_OXIDE]: ColorSets.purple,
  [RESOURCE_LEMERGIUM_HYDRIDE]: ColorSets.green,
  [RESOURCE_LEMERGIUM_OXIDE]: ColorSets.green,
  [RESOURCE_ZYNTHIUM_HYDRIDE]: ColorSets.yellow,
  [RESOURCE_ZYNTHIUM_OXIDE]: ColorSets.yellow,
  [RESOURCE_GHODIUM_HYDRIDE]: ColorSets.white,
  [RESOURCE_GHODIUM_OXIDE]: ColorSets.white,

  [RESOURCE_UTRIUM_ACID]: ColorSets.blue,
  [RESOURCE_UTRIUM_ALKALIDE]: ColorSets.blue,
  [RESOURCE_KEANIUM_ACID]: ColorSets.purple,
  [RESOURCE_KEANIUM_ALKALIDE]: ColorSets.purple,
  [RESOURCE_LEMERGIUM_ACID]: ColorSets.green,
  [RESOURCE_LEMERGIUM_ALKALIDE]: ColorSets.green,
  [RESOURCE_ZYNTHIUM_ACID]: ColorSets.yellow,
  [RESOURCE_ZYNTHIUM_ALKALIDE]: ColorSets.yellow,
  [RESOURCE_GHODIUM_ACID]: ColorSets.white,
  [RESOURCE_GHODIUM_ALKALIDE]: ColorSets.white,

  [RESOURCE_CATALYZED_UTRIUM_ACID]: ColorSets.blue,
  [RESOURCE_CATALYZED_UTRIUM_ALKALIDE]: ColorSets.blue,
  [RESOURCE_CATALYZED_KEANIUM_ACID]: ColorSets.purple,
  [RESOURCE_CATALYZED_KEANIUM_ALKALIDE]: ColorSets.purple,
  [RESOURCE_CATALYZED_LEMERGIUM_ACID]: ColorSets.green,
  [RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE]: ColorSets.green,
  [RESOURCE_CATALYZED_ZYNTHIUM_ACID]: ColorSets.yellow,
  [RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE]: ColorSets.yellow,
  [RESOURCE_CATALYZED_GHODIUM_ACID]: ColorSets.white,
  [RESOURCE_CATALYZED_GHODIUM_ALKALIDE]: ColorSets.white,
};

RoomVisual.prototype.resource = function (
  this: RoomVisual,
  type,
  x,
  y,
  size = 0.25,
  opacity = 1,
) {
  if (type === RESOURCE_ENERGY || type === RESOURCE_POWER) {
    drawResourceFluid(this, type, x, y, size, opacity);
  } else if (
    (
      [
        RESOURCE_CATALYST,
        RESOURCE_HYDROGEN,
        RESOURCE_OXYGEN,
        RESOURCE_LEMERGIUM,
        RESOURCE_UTRIUM,
        RESOURCE_ZYNTHIUM,
        RESOURCE_KEANIUM,
      ] as string[]
    ).includes(type)
  ) {
    drawResourceMineral(this, type, x, y, size, opacity);
  } else if (ResourceColors[type] !== undefined) {
    drawResourceCompound(this, type, x, y, size, opacity);
  }

  return this;
};

function drawResourceFluid(
  vis: RoomVisual,
  type: ResourceConstant,
  x: number,
  y: number,
  size = 0.25,
  opacity = 1,
) {
  vis.circle(x, y, {
    radius: size,
    fill: ResourceColors[type][0],
    opacity,
  });
  vis.text(type[0], x, y - size * 0.1, {
    font: size * 1.5,
    color: ResourceColors[type][1],
    backgroundColor: ResourceColors[type][0],
    backgroundPadding: 0,
    opacity,
  });
}

function drawResourceMineral(
  vis: RoomVisual,
  type: ResourceConstant,
  x: number,
  y: number,
  size = 0.25,
  opacity = 1,
) {
  vis.circle(x, y, {
    radius: size,
    fill: ResourceColors[type][0],
    opacity,
  });
  vis.circle(x, y, {
    radius: size * 0.8,
    fill: ResourceColors[type][1],
    opacity,
  });
  vis.text(type, x, y + size * 0.03, {
    font: "bold " + size * 1.25 + " arial",
    color: ResourceColors[type][0],
    backgroundColor: ResourceColors[type][1],
    backgroundPadding: 0,
    opacity,
  });
}

function drawResourceCompound(
  vis: RoomVisual,
  type: ResourceConstant,
  x: number,
  y: number,
  size = 0.25,
  opacity = 1,
) {
  const label = type.replace("2", "₂");

  vis.text(label, x, y, {
    font: "bold " + size + " arial",
    color: ResourceColors[type][1],
    backgroundColor: ResourceColors[type][0],
    backgroundPadding: 0.3 * size,
    opacity,
  });
}
