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

export interface EscarpmentField {
  readonly id: string;
  readonly center: LayoutPoint;
  /** Angle of the downhill normal in world XY. */
  readonly direction: number;
  readonly halfLengthMeters: number;
  readonly shoulderMeters: number;
  readonly wallMeters: number;
  readonly height: number;
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
  readonly escarpments?: readonly EscarpmentField[];
  readonly noise: {
    readonly coastWarp: number;
    readonly coastGrain: number;
    readonly localRelief: number;
  };
}

// A broad continental core, an open eastern gulf and one wide southwestern cape.
const MAIN_SILHOUETTE: readonly LayoutPoint[] = [
  [0.226, 0.350], [0.250, 0.328], [0.270, 0.309], [0.297, 0.305],
  [0.326, 0.311], [0.347, 0.320], [0.375, 0.313], [0.397, 0.323],
  [0.413, 0.348], [0.416, 0.375], [0.403, 0.401], [0.383, 0.412],
  [0.378, 0.431], [0.392, 0.450], [0.419, 0.464], [0.430, 0.488],
  [0.420, 0.516], [0.409, 0.542], [0.401, 0.570], [0.408, 0.594],
  [0.395, 0.619], [0.365, 0.638], [0.335, 0.645], [0.303, 0.635],
  [0.277, 0.639], [0.251, 0.655], [0.227, 0.660], [0.206, 0.647],
  [0.204, 0.625], [0.221, 0.601], [0.213, 0.583], [0.184, 0.579],
  [0.156, 0.562], [0.141, 0.538], [0.144, 0.511], [0.159, 0.488],
  [0.175, 0.472], [0.177, 0.451], [0.165, 0.431], [0.164, 0.405],
  [0.184, 0.383], [0.210, 0.376],
];

// The remote land is oriented northwest–southeast, with a hooked eastern coast.
const REMOTE_SILHOUETTE: readonly LayoutPoint[] = [
  [0.626, 0.287], [0.642, 0.265], [0.674, 0.253], [0.699, 0.259],
  [0.723, 0.278], [0.754, 0.280], [0.781, 0.301], [0.798, 0.306],
  [0.825, 0.296], [0.858, 0.307], [0.873, 0.329], [0.862, 0.353],
  [0.837, 0.373], [0.809, 0.366], [0.789, 0.383], [0.797, 0.410],
  [0.818, 0.433], [0.811, 0.452], [0.784, 0.461], [0.757, 0.451],
  [0.727, 0.435], [0.706, 0.411], [0.689, 0.388], [0.665, 0.379],
  [0.642, 0.355], [0.635, 0.329],
];

function mass(id: string, region: LandRegion, outline: readonly LayoutPoint[]): Landmass {
  return { id, region, outline };
}

function island(id: string, x: number, y: number, rx: number, ry: number, angle = 0): Landmass {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners: readonly LayoutPoint[] = [
    [-0.82, -0.35], [-0.3, -0.9], [0.3, -1], [0.72, -0.55], [0.5, -0.12],
    [1, 0.23], [0.49, 0.75], [-0.13, 0.97], [-0.55, 0.53], [-1, 0.24],
  ];
  return mass(id, 'island', corners.map(([a, b]) => [
    x + a * rx * cos - b * ry * sin, y + a * rx * sin + b * ry * cos,
  ]));
}

function field(id: string, x: number, y: number, rx: number, ry: number, height: number, rotation = 0): RegionalField {
  return { id, center: [x, y], radii: [rx, ry], height, rotation };
}

export const DEFAULT_AETHER_CONFIG: AetherConfig = validateAetherConfig({
  landmasses: [
    mass('aetheria', 'main', MAIN_SILHOUETTE),
    mass('mythic-shore', 'remote', REMOTE_SILHOUETTE),
    island('northwestern-skerries', 0.155, 0.373, 0.011, 0.008, -0.6),
    island('northern-sound', 0.318, 0.277, 0.014, 0.008, 0.35),
    island('eastern-skerries', 0.451, 0.453, 0.011, 0.007, -0.8),
    island('western-bay-isle', 0.160, 0.605, 0.013, 0.008, 0.3),
    island('southern-arc-1', 0.296, 0.682, 0.018, 0.011, 0.25),
    island('southern-arc-2', 0.337, 0.718, 0.010, 0.008, -0.5),
    island('southern-arc-3', 0.377, 0.738, 0.021, 0.012, 0.3),
    island('southern-arc-4', 0.429, 0.731, 0.016, 0.009, -0.2),
    island('southern-arc-5', 0.466, 0.705, 0.012, 0.009, -0.7),
    island('outer-arc', 0.509, 0.673, 0.009, 0.006, 0.6),
    island('remote-skerries', 0.879, 0.385, 0.013, 0.009, 0.5),
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
      [0.348, 0.379], [0.356, 0.369], [0.368, 0.358], [0.367, 0.345],
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
    field('northern-lowplain', 0.261, 0.353, 0.030, 0.018, 220, 0.31),
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
    field('arc-island-volcano', 0.377, 0.738, 0.015, 0.011, 2_250, 0.19),
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
  escarpments: [
    {
      id: 'eastern-tableland-shelf', center: [0.3975, 0.520], direction: 0.55,
      halfLengthMeters: 1_450, shoulderMeters: 1_200, wallMeters: 20, height: 125,
    },
  ],
  noise: { coastWarp: 0.0048, coastGrain: 0.00145, localRelief: 1 },
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
  const escarpments = input.escarpments === undefined ? undefined : items(input.escarpments, 'escarpments', (raw): EscarpmentField => {
    const shelf = record(raw, 'escarpment');
    const shoulderMeters = real(shelf.shoulderMeters, 'escarpment shoulder', 20, 20_000);
    return Object.freeze({
      id: identifier(shelf.id),
      center: point(shelf.center, 'escarpment center'),
      direction: real(shelf.direction, 'escarpment direction', -Math.PI, Math.PI),
      halfLengthMeters: real(shelf.halfLengthMeters, 'escarpment half length', 40, 20_000),
      shoulderMeters,
      wallMeters: real(shelf.wallMeters, 'escarpment wall', 1, Math.min(150, shoulderMeters / 2)),
      height: real(shelf.height, 'escarpment height', 1, 500),
    });
  });
  const features = [...landmasses, ...mountainSystems, ...plateaus, ...majorPlains, ...basins, ...volcanoes,
    ...magicalSeas, ...trenches, ...(escarpments ?? [])];
  if (new Set(features.map(({ id }) => id)).size !== features.length) throw new Error('Duplicate layout feature ID');
  return Object.freeze({
    landmasses, mountainSystems, plateaus, majorPlains, basins, volcanoes, magicalSeas, trenches,
    ...(escarpments === undefined ? {} : { escarpments }),
    noise: Object.freeze({
      coastWarp: real(noise.coastWarp, 'coast warp', 0, 0.05),
      coastGrain: real(noise.coastGrain, 'coast grain', 0, 0.02),
      localRelief: real(noise.localRelief, 'local relief', 0, 2),
    }),
  });
}
