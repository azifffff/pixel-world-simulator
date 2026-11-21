import { MAX_ELEVATION, MIN_ELEVATION, type WorldMetadata } from './metadata.ts';

export const BIOMES = ['ocean', 'plains', 'hills', 'mountains', 'forest', 'river'] as const;
export type Biome = typeof BIOMES[number];

export interface TerrainSample {
  elevation: number;
  biome: Biome;
  moisture: number;
}

interface Landform {
  elevation: number;
  ocean: boolean;
  river: boolean;
  valley: number;
  warpedU: number;
  warpedV: number;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(min: number, max: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193);
  }
  return hash;
}

function latticeValue(x: number, y: number, seed: number): number {
  let hash = seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4_294_967_295;
}

export class TerrainGenerator {
  private readonly metadata: WorldMetadata;
  private readonly seed: number;

  constructor(metadata: WorldMetadata) {
    this.metadata = metadata;
    this.seed = hashSeed(metadata.seed);
  }

  private noise(x: number, y: number, channel: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const dx = x - x0;
    const dy = y - y0;
    const tx = dx * dx * (3 - 2 * dx);
    const ty = dy * dy * (3 - 2 * dy);
    const seed = this.seed ^ Math.imul(channel, 0x27d4eb2d);
    return mix(
      mix(latticeValue(x0, y0, seed), latticeValue(x0 + 1, y0, seed), tx),
      mix(latticeValue(x0, y0 + 1, seed), latticeValue(x0 + 1, y0 + 1, seed), tx),
      ty,
    );
  }

  sample(x: number, y: number, spacing = 0): TerrainSample {
    const { elevation, ocean, river, valley, warpedU, warpedV } = this.landform(x, y, spacing);
    if (ocean) return { elevation, biome: 'ocean', moisture: 1 };

    const moisture = Math.max(0, Math.min(1,
      0.65 * this.noise(warpedU * 10.5, warpedV * 10.5, 14) +
      0.26 * this.noise(x / 365_000, y / 365_000, 15) +
      0.09 * this.noise(x / 38_000, y / 38_000, 16) +
      0.16 * valley,
    ));

    let biome: Biome = 'plains';
    if (river) biome = 'river';
    else if (elevation >= 1_450) biome = 'mountains';
    else if (moisture >= 0.58 - 0.08 * smoothstep(0, 600, elevation)) biome = 'forest';
    else if (elevation >= 445) biome = 'hills';

    return { elevation, biome, moisture };
  }

  elevationAt(x: number, y: number): number {
    return this.landform(x, y, 0).elevation;
  }

  private landform(x: number, y: number, spacing: number): Landform {
    const { worldSizeMeters: side, terrain } = this.metadata;
    const u = x / side;
    const v = y / side;
    const warpedU = u + 0.14 * (this.noise(u * 3.2, v * 3.2, 1) - 0.5);
    const warpedV = v + 0.14 * (this.noise(u * 3.2, v * 3.2, 2) - 0.5);
    const edge = Math.min(u, v, 1 - u, 1 - v);
    const continent =
      0.66 * this.noise(warpedU * 4.4, warpedV * 4.4, 3) +
      0.24 * this.noise(warpedU * 10.7, warpedV * 10.7, 4) +
      0.08 * this.noise(warpedU * 29, warpedV * 29, 5) +
      0.02 * this.noise(warpedU * 102, warpedV * 102, 6) -
      0.065 * (1 - smoothstep(0, 0.10, edge));

    const inland = continent - terrain.seaLevel;
    if (inland <= 0) {
      return {
        elevation: MIN_ELEVATION * smoothstep(0, 0.37, -inland),
        ocean: true,
        river: false,
        valley: 0,
        warpedU,
        warpedV,
      };
    }

    const ridge = 1 - Math.abs(2 * this.noise(warpedU * 16 + warpedV * 8, warpedV * 14, 7) - 1);
    const uplift = smoothstep(0.36, 0.79, this.noise(warpedU * 8.3, warpedV * 8.3, 8));
    const ridgeBelt = smoothstep(0.17, 0.86, ridge * uplift);
    const roughness = this.noise(x / 235_000, y / 235_000, 9);
    const hills = 950 * smoothstep(0.29, 0.84, roughness) * smoothstep(0.02, 0.2, inland);
    const detail =
      135 * (this.noise(x / 44_000, y / 44_000, 10) - 0.5) +
      35 * (this.noise(x / 5_500, y / 5_500, 11) - 0.5) +
      10 * (this.noise(x / 660, y / 660, 12) - 0.5) +
      2 * (this.noise(x / 83, y / 83, 13) - 0.5);

    const river = this.riverInfluence(x, y, spacing);
    const coast = smoothstep(0, 0.045, inland);
    const baseElevation = 90 + 1_850 * inland + hills + 4_650 * ridgeBelt ** 1.3 + detail;
    const valley = 1 - 0.68 * river.valley;
    const elevation = Math.min(MAX_ELEVATION, Math.max(0,
      (baseElevation * terrain.reliefMultiplier * valley - 22 * river.channel) * coast,
    ));

    return { elevation, ocean: false, river: river.visible, valley: river.valley, warpedU, warpedV };
  }

  private riverInfluence(x: number, y: number, spacing: number) {
    const { worldSizeMeters: side, terrain } = this.metadata;
    if (terrain.riverWidthMeters === 0) return { visible: false, valley: 0, channel: 0 };

    const period = side / 21;
    const corridor = Math.floor(x / period);
    const trunk = period * (corridor + 0.24 +
      0.52 * this.noise(y / (side / 5), corridor, 17) +
      0.10 * (this.noise(y / 295_000, corridor, 18) - 0.5) +
      0.018 * (this.noise(y / 35_000, corridor, 19) - 0.5));

    // The branches grow from tapered headwaters and join the trunk within each basin.
    const basinLength = period * 1.25;
    const basinY = y / basinLength;
    const basin = Math.floor(basinY);
    const progress = basinY - basin;
    const sideOfRiver = latticeValue(corridor, basin, this.seed) < 0.5 ? -1 : 1;
    const tributary = trunk + sideOfRiver * period * 0.13 *
      (1 - smoothstep(0.07, 0.8, progress));
    const trunkDistance = Math.abs(x - trunk);
    const branchDistance = Math.abs(x - tributary);
    const width = Math.min(terrain.riverWidthMeters, period * 0.015);
    const branchStrength = smoothstep(0, 0.18, progress);
    const branchWidth = width * 0.58 * branchStrength;
    const aggregateWidth = Math.min(4_500, period * 0.015, spacing * 0.44);

    const valley = Math.max(
      1 - smoothstep(0, period * 0.06, trunkDistance),
      0.45 * branchStrength * (1 - smoothstep(0, period * 0.028, branchDistance)),
    );
    const channel = Math.max(
      1 - smoothstep(width * 0.7, width * 4, trunkDistance),
      branchStrength * (1 - smoothstep(width * 0.5, width * 2.5, branchDistance)),
    );
    // An overview sample much wider than a river shows the enclosing valley instead.
    const visible = spacing <= width * 20 && (
      trunkDistance < Math.max(width, aggregateWidth) ||
      branchDistance < Math.max(branchWidth, aggregateWidth * 0.6 * branchStrength)
    );
    return { visible, valley, channel };
  }
}
