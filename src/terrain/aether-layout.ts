import {
  DEFAULT_AETHER_CONFIG, type AetherConfig, type Landmass, type LandRegion, type LayoutPoint,
  type PlateauStyle, type RegionalField, type RidgeSystem,
} from './aether-config.ts';
import { MAX_ELEVATION, MIN_ELEVATION, type WorldMetadata } from './metadata.ts';

export interface LayoutSample {
  readonly elevation: number;
  /** Signed distance in meters to the warped coastline, positive on land. */
  readonly coast: number;
  readonly region: LandRegion | 'ocean';
  readonly ridge: number;
  readonly plateau: number;
  readonly plateauStyle: PlateauStyle | null;
  readonly plain: number;
  readonly basin: number;
  readonly volcano: number;
  readonly crater: number;
  readonly magical: number;
  readonly temperature: number;
  readonly moisture: number;
}

interface Segment {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly inverseLengthSquared: number;
}

interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

type SegmentTree = { readonly bounds: BoundingBox } & (
  { readonly segments: readonly Segment[] } |
  { readonly left: SegmentTree; readonly right: SegmentTree }
);

interface Shoreline {
  readonly region: LandRegion;
  readonly segmentTree: SegmentTree;
  readonly crossings: readonly (readonly Segment[])[];
  readonly bounds: BoundingBox;
}

interface PreparedRidge {
  readonly width: number;
  readonly height: number;
  readonly roughness: number;
  readonly segments: readonly Segment[];
  readonly bounds: BoundingBox;
}

interface PreparedField<T extends RegionalField> {
  readonly field: T;
  readonly cos: number;
  readonly sin: number;
  readonly boundRadius: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const blend = (a: number, b: number, t: number) => a + (b - a) * t;

function smooth(min: number, max: number, value: number): number {
  const t = clamp01((value - min) / (max - min));
  return t * t * (3 - 2 * t);
}

function seedHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193);
  return hash;
}

function noiseCorner(x: number, y: number, seed: number): number {
  let hash = seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4_294_967_295;
}

function segments(points: readonly LayoutPoint[], closed: boolean): Segment[] {
  const result: Segment[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const [x, y] = points[i];
    const [nextX, nextY] = points[(i + 1) % points.length];
    const dx = nextX - x;
    const dy = nextY - y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared > 0) result.push({ x, y, dx, dy, inverseLengthSquared: 1 / lengthSquared });
  }
  return result;
}

function box(points: readonly LayoutPoint[]): BoundingBox {
  return {
    minX: Math.min(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxX: Math.max(...points.map(([x]) => x)),
    maxY: Math.max(...points.map(([, y]) => y)),
  };
}

function squaredDistanceToBox(x: number, y: number, bounds: BoundingBox): number {
  const dx = Math.max(0, bounds.minX - x, x - bounds.maxX);
  const dy = Math.max(0, bounds.minY - y, y - bounds.maxY);
  return dx * dx + dy * dy;
}

function squaredDistanceToSegment(x: number, y: number, edge: Segment): number {
  const ox = x - edge.x;
  const oy = y - edge.y;
  const t = clamp01((ox * edge.dx + oy * edge.dy) * edge.inverseLengthSquared);
  const dx = ox - t * edge.dx;
  const dy = oy - t * edge.dy;
  return dx * dx + dy * dy;
}

function segmentTree(edges: Segment[]): SegmentTree {
  const bounds: BoundingBox = {
    minX: Math.min(...edges.map(({ x, dx }) => Math.min(x, x + dx))),
    minY: Math.min(...edges.map(({ y, dy }) => Math.min(y, y + dy))),
    maxX: Math.max(...edges.map(({ x, dx }) => Math.max(x, x + dx))),
    maxY: Math.max(...edges.map(({ y, dy }) => Math.max(y, y + dy))),
  };
  if (edges.length <= 8) return { bounds, segments: edges };
  const horizontal = bounds.maxX - bounds.minX > bounds.maxY - bounds.minY;
  edges.sort((a, b) => horizontal ? a.x + a.dx / 2 - b.x - b.dx / 2 : a.y + a.dy / 2 - b.y - b.dy / 2);
  const midpoint = Math.floor(edges.length / 2);
  return { bounds, left: segmentTree(edges.slice(0, midpoint)), right: segmentTree(edges.slice(midpoint)) };
}

function nearestEdge(x: number, y: number, tree: SegmentTree, best: number): number {
  if (squaredDistanceToBox(x, y, tree.bounds) > best) return best;
  if ('segments' in tree) {
    for (const edge of tree.segments) best = Math.min(best, squaredDistanceToSegment(x, y, edge));
    return best;
  }
  const { left, right } = tree;
  const leftDistance = squaredDistanceToBox(x, y, left.bounds);
  const rightDistance = squaredDistanceToBox(x, y, right.bounds);
  if (leftDistance < rightDistance) return nearestEdge(x, y, right, nearestEdge(x, y, left, best));
  return nearestEdge(x, y, left, nearestEdge(x, y, right, best));
}

const CROSSING_BUCKETS = 32;

function crossingBucket(y: number, bounds: BoundingBox): number {
  return Math.max(0, Math.min(CROSSING_BUCKETS - 1,
    Math.floor((y - bounds.minY) / (bounds.maxY - bounds.minY) * CROSSING_BUCKETS)));
}

function prepareShoreline(land: Landmass): Shoreline {
  // Soften polygon corners while retaining authored straight sections and sharp capes.
  const outline = land.outline.flatMap(([x, y], index): LayoutPoint[] => {
    const [nextX, nextY] = land.outline[(index + 1) % land.outline.length];
    return [
      [blend(x, nextX, 0.16), blend(y, nextY, 0.16)],
      [blend(x, nextX, 0.84), blend(y, nextY, 0.84)],
    ];
  });
  const bounds = box(outline);
  const edges = segments(outline, true);
  const crossings = Array.from({ length: CROSSING_BUCKETS }, (): Segment[] => []);
  for (const edge of edges) {
    const first = crossingBucket(Math.min(edge.y, edge.y + edge.dy), bounds);
    const last = crossingBucket(Math.max(edge.y, edge.y + edge.dy), bounds);
    for (let i = first; i <= last; i++) crossings[i].push(edge);
  }
  return { region: land.region, bounds, segmentTree: segmentTree(edges), crossings };
}

function signedShoreDistance(x: number, y: number, outlines: readonly Shoreline[]): [number, LandRegion] {
  let nearest = -Infinity;
  let region: LandRegion = 'main';
  for (const outline of outlines) {
    const lowerBound = squaredDistanceToBox(x, y, outline.bounds);
    if (lowerBound > 0 && (nearest > 0 || lowerBound > nearest * nearest)) continue;
    let contained = false;
    if (lowerBound === 0) {
      for (const edge of outline.crossings[crossingBucket(y, outline.bounds)]) {
        if ((edge.y > y) !== (edge.y + edge.dy > y) && x < edge.x + (y - edge.y) * edge.dx / edge.dy) {
          contained = !contained;
        }
      }
    }
    const cutoff = contained ? Infinity : nearest * nearest;
    const distance = nearestEdge(x, y, outline.segmentTree, cutoff);
    const signed = Math.sqrt(distance) * (contained ? 1 : -1);
    if (signed > nearest) {
      nearest = signed;
      region = outline.region;
    }
  }
  return [nearest, region];
}

function prepareRidge({ paths, width, height, roughness }: RidgeSystem): PreparedRidge {
  const bounds = box(paths.flat());
  return { width, height, roughness, bounds, segments: paths.flatMap((path) => segments(path, false)) };
}

function prepareField<T extends RegionalField>(field: T): PreparedField<T> {
  return { field, cos: Math.cos(field.rotation), sin: Math.sin(field.rotation), boundRadius: Math.max(...field.radii) };
}

function fieldDistance(x: number, y: number, { field, cos, sin, boundRadius }: PreparedField<RegionalField>): number {
  const dx = x - field.center[0];
  const dy = y - field.center[1];
  if (Math.abs(dx) > boundRadius || Math.abs(dy) > boundRadius) return 2;
  const localX = (dx * cos + dy * sin) / field.radii[0];
  const localY = (dy * cos - dx * sin) / field.radii[1];
  return Math.sqrt(localX * localX + localY * localY);
}

const NO_LAND_SIGNALS = {
  ridge: 0, plateau: 0, plateauStyle: null, plain: 0, basin: 0, volcano: 0, crater: 0,
} as const;

export class AetherLayout {
  private readonly side: number;
  private readonly seed: number;
  private readonly seaOffset: number;
  private readonly reliefMultiplier: number;
  private readonly noiseParameters: AetherConfig['noise'];
  private readonly shorelines: readonly Shoreline[];
  private readonly ridges: readonly PreparedRidge[];
  private readonly plateaus: readonly PreparedField<AetherConfig['plateaus'][number]>[];
  private readonly plains: readonly PreparedField<RegionalField>[];
  private readonly basins: readonly PreparedField<RegionalField>[];
  private readonly volcanoes: readonly PreparedField<RegionalField>[];
  private readonly magicalSeas: readonly PreparedField<RegionalField>[];
  private readonly trenches: readonly PreparedField<RegionalField>[];

  constructor(metadata: WorldMetadata) {
    const config = metadata.layout ?? DEFAULT_AETHER_CONFIG;
    this.side = metadata.worldSizeMeters;
    this.seed = seedHash(metadata.seed);
    this.seaOffset = (metadata.terrain.seaLevel - 0.49) * 0.033;
    this.reliefMultiplier = metadata.terrain.reliefMultiplier;
    this.noiseParameters = config.noise;
    this.shorelines = config.landmasses.map(prepareShoreline);
    this.ridges = config.mountainSystems.map(prepareRidge);
    this.plateaus = config.plateaus.map(prepareField);
    this.plains = config.majorPlains.map(prepareField);
    this.basins = config.basins.map(prepareField);
    this.volcanoes = config.volcanoes.map(prepareField);
    this.magicalSeas = config.magicalSeas.map(prepareField);
    this.trenches = config.trenches.map(prepareField);
  }

  sample(x: number, y: number): LayoutSample {
    return this.evaluate(x, y, true);
  }

  elevationAt(x: number, y: number): number {
    return this.evaluate(x, y, false).elevation;
  }

  private noise(x: number, y: number, channel: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const dx = x - x0;
    const dy = y - y0;
    const sx = dx * dx * (3 - 2 * dx);
    const sy = dy * dy * (3 - 2 * dy);
    const seed = this.seed ^ Math.imul(channel, 0x27d4eb2d);
    return blend(
      blend(noiseCorner(x0, y0, seed), noiseCorner(x0 + 1, y0, seed), sx),
      blend(noiseCorner(x0, y0 + 1, seed), noiseCorner(x0 + 1, y0 + 1, seed), sx), sy,
    );
  }

  private evaluate(x: number, y: number, climate: boolean): LayoutSample {
    const u = x / this.side;
    const v = y / this.side;
    const { coastWarp, coastGrain } = this.noiseParameters;
    // Interior relief can never affect an ocean sample beyond the saturated depth profile.
    const deepDistance = 0.085 + coastWarp * Math.SQRT1_2 + coastGrain * 0.5 + Math.abs(this.seaOffset);
    if (!climate && this.shorelines.every(({ bounds }) => squaredDistanceToBox(u, v, bounds) > deepDistance ** 2)) {
      return this.ocean(u, v, -deepDistance * this.side, deepDistance, false);
    }
    const shoreX = u + coastWarp * (this.noise(u * 33, v * 33, 1) - 0.5);
    const shoreY = v + coastWarp * (this.noise(u * 33, v * 33, 2) - 0.5);
    const [rawDistance, region] = signedShoreDistance(shoreX, shoreY, this.shorelines);
    const shoreDetail = coastGrain * (
      0.6 * (this.noise(u * 155, v * 155, 3) - 0.5) +
      0.28 * (this.noise(u * 504, v * 504, 4) - 0.5) +
      0.12 * (this.noise(u * 1700, v * 1700, 5) - 0.5)
    );
    const inland = rawDistance + shoreDetail - this.seaOffset;
    const coast = inland * this.side;
    if (inland <= 0) return this.ocean(u, v, coast, -inland, climate);

    const shoreExposure = this.noise(u * 58, v * 58, 6);
    const emergence = 1 - Math.exp(-inland / blend(0.00043, 0.0037, shoreExposure));
    if (region === 'remote') {
      const shelf = 95 + 660 * smooth(0, 0.058, inland);
      return {
        ...NO_LAND_SIGNALS, region, coast, magical: 0,
        elevation: shelf * emergence * this.reliefMultiplier,
        temperature: climate ? this.temperature(u, v, shelf) : 0,
        moisture: climate ? 0.45 : 0,
      };
    }

    const fieldX = u + 0.0064 * (this.noise(u * 40, v * 40, 7) - 0.5);
    const fieldY = v + 0.0064 * (this.noise(u * 40, v * 40, 8) - 0.5);
    const hills = this.noise(u * 68, v * 68, 9);
    const rolling = 120 + 170 * this.noise(u * 23, v * 23, 10) + 540 * hills ** 2.1;
    const { signal: plain, height: plainHeight } = this.plainHeight(fieldX, fieldY);
    const plainsElevation = plainHeight + 68 * (hills - 0.5);
    const regionalBase = blend(rolling, plainsElevation, plain);
    const ridge = this.mountainHeight(fieldX, fieldY, u, v);
    const plateau = this.plateauHeight(fieldX, fieldY, u, v);
    const volcano = this.volcanicHeight(fieldX, fieldY);
    const basin = this.basinDepth(fieldX, fieldY);

    const ridgeTerrain = regionalBase + ridge.height;
    const upland = blend(ridgeTerrain, Math.max(plateau.height, ridgeTerrain * 0.8), plateau.signal);
    const eroded = upland + volcano.height;
    // An enclosed floor remains above sea level for the drainage model to fill.
    const floor = Math.max(13, eroded - Math.min(basin.height, eroded * 0.84));
    const land = blend(eroded, floor, basin.signal);
    const terrainTexture = this.localRelief(x, y, u, v, ridge.signal, plateau.rockiness, plain);
    const elevation = Math.max(0, (land + terrainTexture) * this.reliefMultiplier * emergence);
    const moisture = climate ? this.moisture(u, v, inland, ridge.signal, basin.signal) : 0;
    return {
      elevation: Math.min(MAX_ELEVATION, elevation), coast, region, plain,
      ridge: ridge.signal, plateau: plateau.signal, plateauStyle: plateau.style, basin: basin.signal,
      volcano: volcano.signal, crater: volcano.crater, magical: 0, moisture,
      temperature: climate ? this.temperature(u, v, elevation) : 0,
    };
  }

  private ocean(u: number, v: number, coast: number, distance: number, climate: boolean): LayoutSample {
    const shelf = 270 * smooth(0, 0.006, distance);
    const descent = 4_600 * smooth(0.004, 0.085, distance);
    let trench = 0;
    for (const field of this.trenches) {
      const relative = fieldDistance(u, v, field);
      trench = Math.max(trench, field.field.height * (1 - smooth(0.05, 1, relative)));
    }
    const bathymetry = 780 * (this.noise(u * 13, v * 13, 11) - 0.5);
    const deepTerrain = smooth(0.008, 0.042, distance) * (trench + bathymetry);
    let magical = 0;
    if (climate) {
      const warpedX = u + 0.013 * (this.noise(u * 37, v * 37, 12) - 0.5);
      const warpedY = v + 0.013 * (this.noise(u * 37, v * 37, 13) - 0.5);
      for (const field of this.magicalSeas) {
        magical = Math.max(magical, 1 - smooth(0.2, 1, fieldDistance(warpedX, warpedY, field)));
      }
    }
    return {
      ...NO_LAND_SIGNALS, region: 'ocean', coast, magical, moisture: 1,
      elevation: Math.max(MIN_ELEVATION, Math.min(0, -(shelf + descent + deepTerrain))),
      temperature: climate ? this.temperature(u, v, 0) : 0,
    };
  }

  private mountainHeight(x: number, y: number, u: number, v: number): { signal: number; height: number } {
    let height = 0;
    let signal = 0;
    for (const ridge of this.ridges) {
      const widthSquared = ridge.width * ridge.width;
      if (squaredDistanceToBox(x, y, ridge.bounds) >= widthSquared) continue;
      let distance = widthSquared;
      for (const path of ridge.segments) distance = Math.min(distance, squaredDistanceToSegment(x, y, path));
      const lateral = Math.sqrt(distance) / ridge.width;
      const shoulders = 1 - smooth(0.02, 1, lateral);
      const drainage = this.noise(u * 220, v * 220, 14);
      const sides = blend(0.83, 1.2, this.noise(u * 93, v * 93, 15));
      const furrow = 1 - (0.10 + 0.23 * lateral) * ridge.roughness * smooth(0.15, 0.57, 1 - drainage);
      const crest = shoulders ** sides * furrow;
      height = Math.max(height, ridge.height * crest);
      signal = Math.max(signal, crest * blend(0.3, 1, clamp01(ridge.height / 3_100)));
    }
    return { signal, height };
  }

  private plateauHeight(x: number, y: number, u: number, v: number): {
    signal: number; height: number; style: PlateauStyle | null; rockiness: number;
  } {
    let signal = 0;
    let height = 0;
    let materialStrength = 0;
    let rockiness = 0;
    let weights = 0;
    let style: PlateauStyle | null = null;
    for (const plateau of this.plateaus) {
      const edgeDistance = fieldDistance(x, y, plateau);
      const shelf = 1 - smooth(0.62, 1, edgeDistance);
      if (shelf === 0) continue;
      const kind = plateau.field.style;
      const cuts = this.noise(u * 195, v * 195, 16);
      const roughness = kind === 'dissected' ? 1 : kind === 'rock' ? 0.60 : 0.28;
      const erosion = 540 * roughness * smooth(0.22, 0.77, 1 - cuts);
      const terraces = kind === 'terraced' ? 165 * smooth(0.42, 0.49, edgeDistance) : 0;
      const weight = shelf ** 3;
      weights += weight;
      height += weight * (plateau.field.height - erosion - terraces);
      rockiness += weight * roughness;
      signal = Math.max(signal, shelf);
      const interior = shelf * (1 - edgeDistance * 0.5);
      if (interior > materialStrength) {
        materialStrength = interior;
        style = kind;
      }
    }
    return { signal, height: weights ? height / weights : 0, style, rockiness: weights ? signal * rockiness / weights : 0 };
  }

  private plainHeight(x: number, y: number): { signal: number; height: number } {
    return this.regionHeight(x, y, this.plains, 0.31);
  }

  private basinDepth(x: number, y: number): { signal: number; height: number } {
    return this.regionHeight(x, y, this.basins, 0.2);
  }

  private regionHeight(
    x: number, y: number, fields: readonly PreparedField<RegionalField>[], inner: number,
  ): { signal: number; height: number } {
    let signal = 0;
    let height = 0;
    let weights = 0;
    for (const field of fields) {
      const mask = 1 - smooth(inner, 1, fieldDistance(x, y, field));
      const weight = mask ** 3;
      signal = Math.max(signal, mask);
      weights += weight;
      height += field.field.height * weight;
    }
    return { signal, height: weights ? height / weights : 0 };
  }

  private volcanicHeight(x: number, y: number): { signal: number; height: number; crater: number } {
    let signal = 0;
    let crater = 0;
    let height = 0;
    for (const field of this.volcanoes) {
      const relative = fieldDistance(x, y, field);
      const rim = (1 - smooth(0.14, 1, relative)) ** 1.5;
      const hollow = 1 - smooth(0.07, 0.32, relative);
      height = Math.max(height, field.field.height * Math.max(0, rim - hollow * 0.78));
      signal = Math.max(signal, rim);
      crater = Math.max(crater, hollow);
    }
    return { signal, height, crater };
  }

  private localRelief(
    x: number, y: number, u: number, v: number,
    ridge: number, rockiness: number, plain: number,
  ): number {
    const terrain = this.noiseParameters.localRelief;
    if (terrain === 0) return 0;
    const mountain = 1.7 * ridge;
    const ruggedness = (0.49 + mountain + 0.53 * rockiness) * (1 - 0.58 * plain);
    return terrain * ruggedness * (
      170 * (this.noise(u * 375, v * 375, 17) - 0.5) +
      50 * (this.noise(x / 8_900, y / 8_900, 18) - 0.5) +
      15 * (this.noise(x / 1_200, y / 1_200, 19) - 0.5) +
      4.1 * (this.noise(x / 117, y / 117, 20) - 0.5) +
      0.82 * (this.noise(x / 28, y / 28, 21) - 0.5)
    );
  }

  private temperature(u: number, v: number, elevation: number): number {
    return clamp01(0.96 - 0.88 * (1 - v) ** 1.65 - elevation / 7_600 + 0.16 * (this.noise(u * 14, v * 14, 22) - 0.5));
  }

  private moisture(u: number, v: number, inland: number, ridge: number, basin: number): number {
    const rainShadow = 0.49 * smooth(0.306, 0.387, u) * smooth(0.425, 0.555, v);
    const coast = 0.20 * (1 - smooth(0, 0.030, inland));
    const mesoclimate = this.noise(u * 37, v * 37, 23);
    return clamp01(0.19 + coast + 0.61 * mesoclimate + 0.12 * ridge - 0.09 * basin - rainShadow);
  }
}
