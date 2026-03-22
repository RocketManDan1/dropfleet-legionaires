export const enum TerrainType {
  Open = 0,
  HighGrass = 1,
  Rough = 2,
  Sand = 3,
  Rock = 4,
  Forest = 5,
  Jungle = 6,
  Orchard = 7,
  Scrub = 8,
  Crops = 9,
  Fields = 10,
  RicePaddy = 11,
  Mud = 12,
  Swamp = 13,
  Marsh = 14,
  Snow = 15,
  Ice = 16,
  Beach = 17,
  Water = 18,
  ShallowWater = 19,
  Road = 20,
  Bridge = 21,
  Pavement = 22,
  Urban = 23,
  Industrial = 24,
}

export interface TerrainMoveCost {
  track: number;
  wheel: number;
  leg: number;
  hover: number;
}

export const TERRAIN_MOVE_COST: Record<TerrainType, TerrainMoveCost> = {
  [TerrainType.Open]: { track: 1.0, wheel: 1.5, leg: 1.0, hover: 1.0 },
  [TerrainType.HighGrass]: { track: 1.5, wheel: 2.0, leg: 1.0, hover: 1.0 },
  [TerrainType.Rough]: { track: 2.5, wheel: 5.5, leg: 1.5, hover: 1.5 },
  [TerrainType.Sand]: { track: 1.5, wheel: 3.0, leg: 1.5, hover: 1.0 },
  [TerrainType.Rock]: { track: 99, wheel: 99, leg: 2.0, hover: 99 },
  [TerrainType.Forest]: { track: 2.0, wheel: 4.5, leg: 1.5, hover: 2.0 },
  [TerrainType.Jungle]: { track: 3.0, wheel: 8.0, leg: 2.0, hover: 3.0 },
  [TerrainType.Orchard]: { track: 1.5, wheel: 2.5, leg: 1.0, hover: 1.5 },
  [TerrainType.Scrub]: { track: 1.5, wheel: 2.0, leg: 1.0, hover: 1.0 },
  [TerrainType.Crops]: { track: 1.0, wheel: 1.5, leg: 1.0, hover: 1.0 },
  [TerrainType.Fields]: { track: 1.0, wheel: 1.5, leg: 1.0, hover: 1.0 },
  [TerrainType.RicePaddy]: { track: 99, wheel: 99, leg: 2.5, hover: 2.0 },
  [TerrainType.Mud]: { track: 4.0, wheel: 99, leg: 2.0, hover: 2.0 },
  [TerrainType.Swamp]: { track: 99, wheel: 99, leg: 2.0, hover: 99 },
  [TerrainType.Marsh]: { track: 4.0, wheel: 99, leg: 2.0, hover: 3.0 },
  [TerrainType.Snow]: { track: 1.5, wheel: 2.0, leg: 1.5, hover: 1.0 },
  [TerrainType.Ice]: { track: 1.0, wheel: 1.5, leg: 1.5, hover: 1.0 },
  [TerrainType.Beach]: { track: 2.0, wheel: 3.0, leg: 1.0, hover: 1.0 },
  [TerrainType.Water]: { track: 99, wheel: 99, leg: 99, hover: 99 },
  [TerrainType.ShallowWater]: { track: 3.0, wheel: 99, leg: 2.0, hover: 2.0 },
  [TerrainType.Road]: { track: 0.5, wheel: 0.5, leg: 0.5, hover: 0.5 },
  [TerrainType.Bridge]: { track: 0.5, wheel: 0.5, leg: 0.5, hover: 0.5 },
  [TerrainType.Pavement]: { track: 0.5, wheel: 0.5, leg: 0.5, hover: 0.5 },
  [TerrainType.Urban]: { track: 2.0, wheel: 2.0, leg: 1.5, hover: 2.5 },
  [TerrainType.Industrial]: { track: 2.0, wheel: 2.0, leg: 1.5, hover: 2.5 },
};

export const TERRAIN_BLOCKS_LOS: Record<TerrainType, boolean> = {
  [TerrainType.Open]: false,
  [TerrainType.HighGrass]: true,
  [TerrainType.Rough]: false,
  [TerrainType.Sand]: false,
  [TerrainType.Rock]: false,
  [TerrainType.Forest]: true,
  [TerrainType.Jungle]: true,
  [TerrainType.Orchard]: true,
  [TerrainType.Scrub]: true,
  [TerrainType.Crops]: true,
  [TerrainType.Fields]: false,
  [TerrainType.RicePaddy]: false,
  [TerrainType.Mud]: false,
  [TerrainType.Swamp]: false,
  [TerrainType.Marsh]: false,
  [TerrainType.Snow]: false,
  [TerrainType.Ice]: false,
  [TerrainType.Beach]: false,
  [TerrainType.Water]: false,
  [TerrainType.ShallowWater]: false,
  [TerrainType.Road]: false,
  [TerrainType.Bridge]: false,
  [TerrainType.Pavement]: false,
  [TerrainType.Urban]: true,
  [TerrainType.Industrial]: true,
};

export function isValidTerrainType(value: number): value is TerrainType {
  return Number.isInteger(value) && value >= TerrainType.Open && value <= TerrainType.Industrial;
}
