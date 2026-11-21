/** Positions and radii are fractions of the world side. Heights are in meters. */
export type LayoutPoint = readonly [number, number];
export type LandRegion = 'main' | 'remote' | 'island';
export type PlateauStyle = 'flat' | 'rock' | 'dissected' | 'volcanic' | 'terraced';

export interface Landmass {
  readonly id: string;
  readonly region: LandRegion;
  readonly outline: readonly LayoutPoint[];
}

export interface RidgeSystem {
  readonly id: string;
  readonly paths: readonly (readonly LayoutPoint[])[];
  readonly width: number;
  readonly height: number;
  readonly roughness: number;
}

export interface RegionalField {
  readonly id: string;
  readonly center: LayoutPoint;
  readonly radii: LayoutPoint;
  readonly rotation: number;
  readonly height: number;
}

export interface PlateauField extends RegionalField {
  readonly style: PlateauStyle;
}

export interface AetherConfig {
  readonly landmasses: readonly Landmass[];
  readonly mountainSystems: readonly RidgeSystem[];
  readonly plateaus: readonly PlateauField[];
  readonly majorPlains: readonly RegionalField[];
  readonly basins: readonly RegionalField[];
  readonly volcanoes: readonly RegionalField[];
  readonly magicalSeas: readonly RegionalField[];
  readonly trenches: readonly RegionalField[];
  readonly noise: {
    readonly coastWarp: number;
    readonly coastGrain: number;
    readonly localRelief: number;
  };
}

const MAIN_SILHOUETTE: readonly LayoutPoint[] = [
  [0.206, 0.334], [0.221, 0.307], [0.254, 0.290], [0.259, 0.271],
  [0.284, 0.265], [0.307, 0.282], [0.312, 0.310], [0.336, 0.333],
  [0.359, 0.320], [0.376, 0.285], [0.399, 0.261], [0.419, 0.255],
  [0.414, 0.282], [0.398, 0.314], [0.394, 0.350], [0.420, 0.362],
  [0.442, 0.389], [0.433, 0.414], [0.408, 0.413], [0.384, 0.392],
  [0.365, 0.418], [0.373, 0.448], [0.401, 0.471], [0.430, 0.470],
  [0.456, 0.488], [0.454, 0.519], [0.435, 0.539], [0.415, 0.553],
  [0.401, 0.580], [0.408, 0.602], [0.438, 0.623], [0.444, 0.653],
  [0.431, 0.678], [0.413, 0.663], [0.405, 0.636], [0.382, 0.617],
  [0.359, 0.617], [0.342, 0.642], [0.348, 0.673], [0.335, 0.703],
  [0.315, 0.699], [0.314, 0.667], [0.297, 0.650], [0.275, 0.658],
  [0.262, 0.684], [0.240, 0.718], [0.218, 0.709], [0.237, 0.675],
  [0.240, 0.649], [0.222, 0.626], [0.194, 0.634], [0.168, 0.651],
  [0.141, 0.653], [0.128, 0.640], [0.149, 0.624], [0.174, 0.614],
  [0.189, 0.590], [0.176, 0.572], [0.154, 0.578], [0.131, 0.566],
  [0.119, 0.540], [0.127, 0.512], [0.147, 0.494], [0.150, 0.469],
  [0.135, 0.447], [0.107, 0.439], [0.103, 0.405], [0.118, 0.381],
  [0.146, 0.374], [0.166, 0.352], [0.177, 0.335], [0.186, 0.355],
  [0.198, 0.365], [0.209, 0.356],
];

function mass(id: string, region: LandRegion, outline: readonly LayoutPoint[]): Landmass {
  return { id, region, outline };
}

function island(id: string, x: number, y: number, rx: number, ry: number): Landmass {
  const corners: readonly LayoutPoint[] = [
    [-0.82, -0.35], [-0.3, -0.9], [0.3, -1], [0.72, -0.55], [0.5, -0.12],
    [1, 0.23], [0.49, 0.75], [-0.13, 0.97], [-0.55, 0.53], [-1, 0.24],
  ];
  return mass(id, 'island', corners.map(([a, b]) => [x + a * rx, y + b * ry]));
}

function field(id: string, x: number, y: number, rx: number, ry: number, height: number, rotation = 0): RegionalField {
  return { id, center: [x, y], radii: [rx, ry], height, rotation };
}

export const DEFAULT_AETHER_CONFIG: AetherConfig = validateAetherConfig({
  landmasses: [
    mass('aetheria', 'main', MAIN_SILHOUETTE.map(([x, y]) => [0.277 + (x - 0.277) * 0.69, 0.485 + (y - 0.485) * 0.69])),
    mass('mythic-shore', 'remote', [
      [0.710, 0.287], [0.732, 0.260], [0.758, 0.258], [0.777, 0.280], [0.793, 0.274],
      [0.806, 0.250], [0.825, 0.265], [0.823, 0.297], [0.848, 0.316], [0.858, 0.351],
      [0.844, 0.375], [0.820, 0.374], [0.801, 0.356], [0.789, 0.384], [0.800, 0.417],
      [0.775, 0.447], [0.748, 0.450], [0.732, 0.426], [0.706, 0.416], [0.686, 0.395],
      [0.688, 0.362], [0.712, 0.348], [0.722, 0.320], [0.699, 0.305],
    ]),
    island('northwestern-skerries', 0.147, 0.390, 0.010, 0.009),
    island('northern-sound', 0.271, 0.310, 0.012, 0.007),
    island('northeastern-shelf', 0.374, 0.335, 0.012, 0.009),
    island('eastern-skerries', 0.423, 0.440, 0.014, 0.009),
    island('western-bay-isle', 0.153, 0.569, 0.012, 0.007),
    island('southern-arc-1', 0.303, 0.671, 0.015, 0.013),
    island('southern-arc-2', 0.343, 0.699, 0.014, 0.010),
    island('southern-arc-3', 0.378, 0.721, 0.019, 0.012),
    island('southern-arc-4', 0.419, 0.726, 0.012, 0.010),
    island('southern-arc-5', 0.448, 0.703, 0.017, 0.012),
    island('southern-arc-6', 0.477, 0.682, 0.010, 0.008),
    island('southern-arc-7', 0.505, 0.653, 0.009, 0.007),
    island('outer-arc', 0.529, 0.629, 0.006, 0.005),
    island('remote-skerries', 0.864, 0.395, 0.010, 0.013),
  ],
  mountainSystems: [
    { id: 'central-cordillera', paths: [
      [[0.225, 0.418], [0.244, 0.389], [0.269, 0.382], [0.286, 0.405], [0.280, 0.435], [0.300, 0.469], [0.308, 0.485]],
      [[0.269, 0.382], [0.274, 0.367], [0.296, 0.347]],
      [[0.285, 0.419], [0.313, 0.422], [0.344, 0.410]],
      [[0.288, 0.450], [0.273, 0.459], [0.252, 0.484]],
    ], width: 0.024, height: 4_450, roughness: 0.95 },
    { id: 'southern-cordillera', paths: [
      [[0.309, 0.521], [0.327, 0.538], [0.322, 0.560], [0.301, 0.585]],
      [[0.327, 0.538], [0.352, 0.531], [0.377, 0.542]],
    ], width: 0.019, height: 3_760, roughness: 0.9 },
    { id: 'northern-massifs', paths: [[
      [0.348, 0.379], [0.355, 0.370], [0.365, 0.357],
    ]], width: 0.018, height: 3_410, roughness: 0.82 },
    { id: 'northwest-uplands', paths: [[
      [0.186, 0.434], [0.200, 0.408], [0.221, 0.394],
    ]], width: 0.019, height: 1_820, roughness: 0.66 },
    { id: 'southwestern-hills', paths: [[
      [0.197, 0.587], [0.225, 0.568], [0.247, 0.557],
    ]], width: 0.014, height: 1_210, roughness: 0.53 },
    { id: 'eastern-escarpment', paths: [[
      [0.372, 0.479], [0.394, 0.488], [0.388, 0.510],
    ]], width: 0.015, height: 1_980, roughness: 0.78 },
  ],
  plateaus: [
    { ...field('cold-tableland', 0.337, 0.393, 0.033, 0.020, 2_000, -0.52), style: 'flat' },
    { ...field('northeast-upland', 0.345, 0.417, 0.045, 0.023, 1_490, 0.41), style: 'terraced' },
    { ...field('eastern-rock-tableland', 0.377, 0.513, 0.038, 0.043, 1_970, 0.24), style: 'rock' },
    { ...field('dissected-tableland', 0.369, 0.581, 0.027, 0.022, 1_810, -0.63), style: 'dissected' },
    { ...field('volcanic-plateau', 0.349, 0.570, 0.030, 0.020, 1_540, 0.43), style: 'volcanic' },
  ],
  majorPlains: [
    field('western-lowplain', 0.206, 0.490, 0.062, 0.071, 180, 0.34),
    field('southern-lowplain', 0.273, 0.591, 0.057, 0.030, 145, -0.43),
    field('northern-lowplain', 0.250, 0.366, 0.020, 0.014, 220, 0.31),
    field('midland-passage', 0.281, 0.509, 0.049, 0.019, 330, -0.37),
    field('northwest-valleys', 0.205, 0.420, 0.036, 0.028, 325, 0.4),
  ],
  basins: [
    field('northwest-lake-basin', 0.212, 0.437, 0.023, 0.014, 370, 0.4),
    field('north-lake-basin', 0.264, 0.349, 0.019, 0.010, 430, 0.16),
    field('central-basin', 0.276, 0.506, 0.021, 0.017, 530, -0.2),
    field('dry-eastern-basin', 0.369, 0.544, 0.020, 0.014, 660, 0.6),
    field('southern-basin', 0.272, 0.581, 0.029, 0.019, 260, -0.4),
  ],
  volcanoes: [
    field('southeastern-caldera', 0.355, 0.576, 0.017, 0.014, 2_360, -0.38),
    field('eastern-volcanic-cone', 0.375, 0.523, 0.009, 0.011, 1_820, 0.39),
    field('arc-island-volcano', 0.377, 0.721, 0.015, 0.011, 2_250, 0.19),
  ],
  magicalSeas: [
    field('auroral-sea', 0.552, 0.298, 0.098, 0.047, 0, -0.41),
    field('glimmering-gyre', 0.616, 0.588, 0.083, 0.051, 0, 0.48),
  ],
  trenches: [
    field('central-trench', 0.548, 0.480, 0.034, 0.222, 2_500, -0.25),
    field('southern-trench', 0.419, 0.790, 0.146, 0.028, 1_650, -0.17),
    field('far-ocean-trench', 0.917, 0.584, 0.041, 0.222, 1_850, 0.32),
  ],
  noise: { coastWarp: 0.0085, coastGrain: 0.0029, localRelief: 1 },
});

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid layout ${name}`);
  return value as Record<string, unknown>;
}

function real(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid layout ${name}`);
  }
  return value;
}

function point(value: unknown, name: string, min = 0, max = 1): LayoutPoint {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`Invalid layout ${name}`);
  return Object.freeze([real(value[0], name, min, max), real(value[1], name, min, max)]);
}

function items<T>(value: unknown, name: string, parse: (value: unknown) => T, min = 0, max = 128): readonly T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`Invalid layout ${name}`);
  return Object.freeze(value.map(parse));
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error('Invalid layout id');
  return value;
}

function regional(value: unknown): RegionalField {
  const input = record(value, 'region');
  return Object.freeze({
    id: identifier(input.id),
    center: point(input.center, 'region center'),
    radii: point(input.radii, 'region radii', 0.0001, 1),
    rotation: real(input.rotation, 'region rotation', -Math.PI, Math.PI),
    height: real(input.height, 'region height', 0, 8_000),
  });
}

export function validateAetherConfig(value: unknown): AetherConfig {
  const input = record(value, 'configuration');
  const noise = record(input.noise, 'noise');
  const landmasses = items(input.landmasses, 'landmasses', (raw): Landmass => {
    const land = record(raw, 'landmass');
    const region = land.region;
    if (region !== 'main' && region !== 'remote' && region !== 'island') throw new Error('Invalid layout landmass region');
    return Object.freeze({
      id: identifier(land.id), region,
      outline: items(land.outline, 'outline', (position) => point(position, 'shoreline point'), 3),
    });
  }, 1);
  if (landmasses.filter((land) => land.region === 'main').length !== 1) throw new Error('Aetheria requires one main continent');
  const mountainSystems = items(input.mountainSystems, 'mountain systems', (raw): RidgeSystem => {
    const ridge = record(raw, 'mountain system');
    return Object.freeze({
      id: identifier(ridge.id),
      paths: items(ridge.paths, 'mountain paths', (path) =>
        items(path, 'mountain path', (position) => point(position, 'ridge point'), 2), 1, 32),
      width: real(ridge.width, 'ridge width', 0.0001, 0.3),
      height: real(ridge.height, 'ridge height', 0, 8_000),
      roughness: real(ridge.roughness, 'ridge roughness', 0, 1.5),
    });
  });
  const plateaus = items(input.plateaus, 'plateaus', (raw): PlateauField => {
    const { style } = record(raw, 'plateau');
    if (style !== 'flat' && style !== 'rock' && style !== 'dissected' && style !== 'volcanic' && style !== 'terraced') {
      throw new Error('Invalid layout plateau style');
    }
    return Object.freeze({ ...regional(raw), style });
  });
  const majorPlains = items(input.majorPlains, 'major plains', regional);
  const basins = items(input.basins, 'basins', regional);
  const volcanoes = items(input.volcanoes, 'volcanoes', regional);
  const magicalSeas = items(input.magicalSeas, 'magical seas', regional);
  const trenches = items(input.trenches, 'trenches', regional);
  const features = [...landmasses, ...mountainSystems, ...plateaus, ...majorPlains, ...basins, ...volcanoes, ...magicalSeas, ...trenches];
  if (new Set(features.map(({ id }) => id)).size !== features.length) throw new Error('Duplicate layout feature ID');
  return Object.freeze({
    landmasses, mountainSystems, plateaus, majorPlains, basins, volcanoes, magicalSeas, trenches,
    noise: Object.freeze({
      coastWarp: real(noise.coastWarp, 'coast warp', 0, 0.05),
      coastGrain: real(noise.coastGrain, 'coast grain', 0, 0.02),
      localRelief: real(noise.localRelief, 'local relief', 0, 2),
    }),
  });
}
