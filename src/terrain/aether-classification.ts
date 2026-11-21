import type { LayoutSample } from './aether-layout.ts';
import type { Biome } from './generator.ts';

export const TERRAIN_LABELS = {
  'low-plain': 'Đồng bằng thấp',
  'middle-plain': 'Đồng bằng trung bình',
  'high-plain': 'Đồng bằng cao',
  'alluvial-plain': 'Đồng bằng phù sa',
  'coastal-plain': 'Đồng bằng ven biển',
  'low-hill': 'Đồi thấp',
  'middle-hill': 'Đồi trung bình',
  'high-hill': 'Đồi cao',
  'rolling-hill': 'Đồi nhấp nhô',
  foothills: 'Đồi chân núi',
  'low-mountain': 'Núi thấp',
  'middle-mountain': 'Núi trung bình',
  'high-mountain': 'Núi cao',
  'extreme-mountain': 'Núi cực cao',
  volcano: 'Núi lửa',
  plateau: 'Cao nguyên bằng',
  'rock-plateau': 'Cao nguyên đá',
  'dissected-plateau': 'Cao nguyên chia cắt',
  'stepped-plateau': 'Cao nguyên bậc thang',
  'volcanic-plateau': 'Cao nguyên núi lửa',
  valley: 'Thung lũng',
  basin: 'Bồn địa',
  depression: 'Vùng trũng thấp',
  'intermontane-basin': 'Trũng giữa núi',
  'coastal-depression': 'Trũng ven biển',
  sinkhole: 'Hố sụt',
  canyon: 'Hẻm vực',
  'shallow-sea': 'Biển nông',
  'continental-shelf': 'Thềm lục địa',
  'deep-sea': 'Biển sâu',
  trench: 'Vực biển',
} as const;

export const SURFACE_LABELS = {
  grassland: 'Đồng cỏ',
  forest: 'Rừng',
  bedrock: 'Đá gốc',
  snow: 'Tuyết phủ',
  'sand-desert': 'Sa mạc cát',
  'rock-desert': 'Sa mạc đá',
  'dry-gravel': 'Bãi sỏi khô',
  badlands: 'Đất xói mòn',
  'salt-flat': 'Đồng muối',
  lava: 'Dung nham nguội',
  crater: 'Miệng núi lửa',
  beach: 'Bãi cát',
  'rocky-shore': 'Bờ biển đá',
  'sea-cliff': 'Vách biển',
  dunes: 'Cồn cát',
  'tidal-flat': 'Bãi triều',
  freshwater: 'Nước nội địa',
  seawater: 'Nước biển',
  'magical-water': 'Biển ma thuật',
} as const;

export const WATER_LABELS = {
  none: 'Không',
  ocean: 'Biển',
  river: 'Sông',
  lake: 'Hồ',
} as const;

export type TerrainClass = keyof typeof TERRAIN_LABELS;
export type SurfaceMaterial = keyof typeof SURFACE_LABELS;
export type WaterType = keyof typeof WATER_LABELS;

export interface Morphology {
  /** Angle of the ground surface, in degrees. */
  readonly slope: number;
  /** Normalized local roughness from 0 to 1. */
  readonly ruggedness: number;
  readonly localRelief: number;
  /** Signed normalized curvature. Positive values are concave. */
  readonly curvature: number;
}

export interface TerrainAttributes extends Morphology {
  readonly landform: TerrainClass;
  readonly surface: SurfaceMaterial;
  readonly water: WaterType;
  readonly snowCover: number;
  readonly material: number;
  readonly dryMaterial: number;
}

// Each row in the renderer's shared palette texture has one stable material ID.
const MATERIAL_COLORS = {
  lowPlain: 0xdce8b5,
  middlePlain: 0xd3e1ac,
  highPlain: 0xb4cb8a,
  alluvialPlain: 0xc8da9c,
  coastalPlain: 0xe7e3ba,
  lowHill: 0xafc68a,
  middleHill: 0x94ad78,
  highHill: 0x7e9868,
  lowMountain: 0x92967d,
  middleMountain: 0x777c70,
  highMountain: 0x5c625f,
  extremeMountain: 0x454f57,
  snow: 0xf1f3f0,
  plateau: 0xc6ad82,
  rockPlateau: 0xab9276,
  dissectedPlateau: 0x957c68,
  valley: 0xc5d19e,
  basin: 0xb9b48c,
  sinkhole: 0xa7a07d,
  depression: 0xb3c7b6,
  sandDesert: 0xe8cc8c,
  rockDesert: 0xc8ac83,
  dryGravel: 0xbea68c,
  badlands: 0xba9678,
  saltFlat: 0xe5e4ce,
  volcano: 0x725e5c,
  lava: 0x514b4b,
  crater: 0xa47869,
  beach: 0xf0ddaa,
  seaCliff: 0x969c97,
  dunes: 0xe6ce98,
  tidalFlat: 0xb7c7bd,
  shallowSea: 0xa9d3df,
  shelf: 0x75afc6,
  deepSea: 0x3d789f,
  trench: 0x284e70,
  magicalSea: 0x707fae,
  river: 0x579cae,
  lake: 0x77b7c9,
  forest: 0x78985e,
  neutralLand: 0xb0afa3,
  neutralSea: 0x7d8c98,
} as const;

type MaterialName = keyof typeof MATERIAL_COLORS;
export const MATERIALS = Object.values(MATERIAL_COLORS);
const MATERIAL_IDS = Object.fromEntries(
  Object.keys(MATERIAL_COLORS).map((name, index) => [name, index]),
) as Record<MaterialName, number>;

export const FOREST_MATERIAL = MATERIAL_IDS.forest;
export const RIVER_MATERIAL = MATERIAL_IDS.river;
export const NEUTRAL_LAND_MATERIAL = MATERIAL_IDS.neutralLand;
export const NEUTRAL_SEA_MATERIAL = MATERIAL_IDS.neutralSea;
export const BATHYMETRY_MATERIALS = {
  shallow: MATERIAL_IDS.shallowSea,
  shelf: MATERIAL_IDS.shelf,
  deep: MATERIAL_IDS.deepSea,
  trench: MATERIAL_IDS.trench,
};

export function isWaterMaterial(material: number): boolean {
  return (material >= MATERIAL_IDS.shallowSea && material <= MATERIAL_IDS.lake) || material === NEUTRAL_SEA_MATERIAL;
}

export function isBathymetryMaterial(material: number): boolean {
  return material >= BATHYMETRY_MATERIALS.shallow && material <= BATHYMETRY_MATERIALS.trench;
}

const BASE_MATERIALS: Record<TerrainClass, MaterialName> = {
  'low-plain': 'lowPlain', 'middle-plain': 'middlePlain', 'high-plain': 'highPlain',
  'alluvial-plain': 'alluvialPlain', 'coastal-plain': 'coastalPlain',
  'low-hill': 'lowHill', 'middle-hill': 'middleHill', 'high-hill': 'highHill',
  'rolling-hill': 'middleHill', foothills: 'highHill',
  'low-mountain': 'lowMountain', 'middle-mountain': 'middleMountain',
  'high-mountain': 'highMountain', 'extreme-mountain': 'extremeMountain', volcano: 'volcano',
  plateau: 'plateau', 'rock-plateau': 'rockPlateau', 'dissected-plateau': 'dissectedPlateau',
  'stepped-plateau': 'plateau', 'volcanic-plateau': 'volcano',
  valley: 'valley', basin: 'basin', depression: 'depression',
  'intermontane-basin': 'basin', 'coastal-depression': 'depression', sinkhole: 'sinkhole', canyon: 'dissectedPlateau',
  'shallow-sea': 'shallowSea', 'continental-shelf': 'shelf', 'deep-sea': 'deepSea', trench: 'trench',
};

const SURFACE_OVERRIDES: Partial<Record<SurfaceMaterial, MaterialName>> = {
  forest: 'forest', snow: 'snow', 'sand-desert': 'sandDesert', 'rock-desert': 'rockDesert',
  'dry-gravel': 'dryGravel', badlands: 'badlands', 'salt-flat': 'saltFlat', lava: 'lava',
  crater: 'crater', beach: 'beach', 'sea-cliff': 'seaCliff', dunes: 'dunes',
  'tidal-flat': 'tidalFlat', 'magical-water': 'magicalSea', 'rocky-shore': 'seaCliff',
};

const BIOME_MATERIALS: Record<Biome, MaterialName> = {
  ocean: 'deepSea', plains: 'lowPlain', hills: 'middleHill',
  mountains: 'middleMountain', forest: 'forest', river: 'river',
};

export function materialForBiome(biome: Biome): number {
  return MATERIAL_IDS[BIOME_MATERIALS[biome]];
}

export function materialForTerrain(landform: TerrainClass, surface: SurfaceMaterial, water: WaterType): number {
  if (water === 'river' || water === 'lake') return MATERIAL_IDS[water];
  return MATERIAL_IDS[SURFACE_OVERRIDES[surface] ?? BASE_MATERIALS[landform]];
}

const THRESHOLDS = {
  sea: { trench: -5_500, deep: -1_350, shelf: -220, magical: 0.53 },
  coast: { belt: 85_000, beach: 10_000, lowland: 180, cliffSlope: 16 },
  hills: { low: 270, middle: 520, high: 810, rollingRoughness: 0.069, regionalRelief: 26 },
  mountains: {
    ridge: 0.25, minElevation: 670, minRelief: 200, slope: 12, ruggedness: 0.235,
    middle: 1_950, high: 2_950, extreme: 3_900,
  },
  plateau: { influence: 0.52, minElevation: 760, dissectedSlope: 9, dissectedRelief: 460, steps: 0.66 },
  basin: { influence: 0.47, lowElevation: 175, flatSlope: 9 },
  concavity: { valley: 0.004, steepValley: 0.011, sink: 0.023 },
  volcano: { influence: 0.56, lava: 0.27, crater: 0.46 },
  arid: { dry: 0.35, veryDry: 0.27, saltFlat: 0.21 },
  snow: { lowerLine: 1_540, warmOffset: 2_750, dryOffset: 520, band: 440 },
  forest: { moisture: 0.67, maxElevation: 2_150, minTemperature: 0.28 },
} as const;

function marineClass(elevation: number): TerrainClass {
  const sea = THRESHOLDS.sea;
  if (elevation < sea.trench) return 'trench';
  if (elevation < sea.deep) return 'deep-sea';
  if (elevation < sea.shelf) return 'continental-shelf';
  return 'shallow-sea';
}

function terrestrialClass(
  elevation: number, morphology: Morphology, layout: LayoutSample, water: WaterType,
): TerrainClass {
  const { slope, localRelief, ruggedness, curvature } = morphology;
  const { coast, hills, mountains, plateau, basin, volcano, concavity } = THRESHOLDS;
  if (layout.volcano >= volcano.influence) return 'volcano';
  if (layout.coast < coast.belt && elevation < coast.lowland) {
    if (layout.basin > basin.influence && elevation < 55) return 'coastal-depression';
    return 'coastal-plain';
  }
  if (
    layout.plateau >= plateau.influence && elevation >= plateau.minElevation &&
    layout.ridge < mountains.ridge + 0.14
  ) {
    if (slope > plateau.dissectedSlope || localRelief > plateau.dissectedRelief) {
      return curvature > concavity.steepValley ? 'canyon' : 'dissected-plateau';
    }
    if (layout.plateauStyle === 'dissected') return 'dissected-plateau';
    if (layout.plateauStyle === 'volcanic') return 'volcanic-plateau';
    if (layout.plateauStyle === 'rock') return 'rock-plateau';
    if (layout.plateauStyle === 'terraced') return 'stepped-plateau';
    if (layout.plateau > plateau.steps && slope > 5) return 'stepped-plateau';
    return 'plateau';
  }
  if (layout.basin >= basin.influence && slope < basin.flatSlope) {
    if (layout.basin > 0.86 && curvature > concavity.sink) return 'sinkhole';
    if (layout.ridge > 0.11) return 'intermontane-basin';
    if (elevation < basin.lowElevation) return 'depression';
    return 'basin';
  }
  if (water === 'river' && curvature > concavity.steepValley && slope >= 8) {
    return localRelief > 200 ? 'canyon' : 'valley';
  }
  if (
    elevation > mountains.minElevation &&
    (layout.ridge >= mountains.ridge ||
      (slope >= mountains.slope && (ruggedness >= mountains.ruggedness || localRelief >= mountains.minRelief)))
  ) {
    if (elevation >= mountains.extreme) return 'extreme-mountain';
    if (elevation >= mountains.high) return 'high-mountain';
    if (elevation >= mountains.middle) return 'middle-mountain';
    return 'low-mountain';
  }
  if (curvature > concavity.valley && layout.ridge > 0.1) return 'valley';
  if (water === 'river' && slope < 8) return 'alluvial-plain';
  if (layout.ridge > 0.15 && elevation > hills.low) return 'foothills';
  if (
    layout.plain < 0.59 &&
    (slope >= 3 || ruggedness >= hills.rollingRoughness || localRelief >= hills.regionalRelief)
  ) {
    if (elevation >= hills.high) return 'high-hill';
    if (elevation >= hills.middle) return 'middle-hill';
    return elevation >= hills.low ? 'low-hill' : 'rolling-hill';
  }
  if (elevation >= hills.middle) return 'high-plain';
  if (elevation >= hills.low) return 'middle-plain';
  return 'low-plain';
}

function terrestrialSurface(
  landform: TerrainClass, elevation: number, slope: number, localRelief: number, layout: LayoutSample, snowCover: number,
): SurfaceMaterial {
  const { coast, arid, volcano, forest } = THRESHOLDS;
  if (snowCover >= 0.49) return 'snow';
  if (landform === 'volcano') {
    if (layout.crater >= volcano.crater) return 'crater';
    return layout.volcano > 0.75 ? 'lava' : 'bedrock';
  }
  if (landform === 'volcanic-plateau' && layout.volcano > volcano.lava) return 'lava';
  if (layout.coast < coast.beach && elevation < coast.lowland) {
    if (slope > coast.cliffSlope) return 'sea-cliff';
    if (localRelief > 75) return 'rocky-shore';
    if (elevation < 15 && slope < 2) return 'tidal-flat';
    return layout.moisture < arid.dry ? 'dunes' : 'beach';
  }
  if (layout.moisture < arid.dry && layout.temperature > 0.38) {
    if (layout.moisture < arid.saltFlat && layout.basin > 0.72 && slope < 3.5) return 'salt-flat';
    if (landform === 'canyon' || landform === 'dissected-plateau') return 'badlands';
    if (layout.plateau > 0.36 || slope > 10) return 'rock-desert';
    return layout.moisture < arid.veryDry ? 'sand-desert' : 'dry-gravel';
  }
  if (landform.includes('mountain') || landform === 'rock-plateau' || landform === 'canyon') return 'bedrock';
  if (layout.moisture > forest.moisture && elevation < forest.maxElevation && layout.temperature > forest.minTemperature) {
    return 'forest';
  }
  return 'grassland';
}

export function classifyTerrain(
  elevation: number, morphology: Morphology, layout: LayoutSample, inlandWater: 'none' | 'river' | 'lake',
): TerrainAttributes {
  if (elevation <= 0 && inlandWater === 'none') {
    const landform = marineClass(elevation);
    const surface = layout.magical >= THRESHOLDS.sea.magical ? 'magical-water' : 'seawater';
    const material = materialForTerrain(landform, surface, 'ocean');
    return { ...morphology, landform, surface, water: 'ocean', snowCover: 0, material, dryMaterial: material };
  }

  const landform = terrestrialClass(elevation, morphology, layout, inlandWater);
  const snow = THRESHOLDS.snow;
  const snowLine = snow.lowerLine + layout.temperature * snow.warmOffset + (1 - layout.moisture) * snow.dryOffset;
  const snowCover = Math.max(0, Math.min(1, (elevation - snowLine) / snow.band));
  const drySurface = terrestrialSurface(landform, elevation, morphology.slope, morphology.localRelief, layout, snowCover);
  const dryMaterial = materialForTerrain(landform, drySurface, 'none');
  const material = inlandWater === 'none' ? dryMaterial : MATERIAL_IDS[inlandWater];
  return {
    ...morphology,
    landform,
    surface: inlandWater === 'none' ? drySurface : 'freshwater',
    water: inlandWater,
    snowCover,
    material,
    dryMaterial,
  };
}
