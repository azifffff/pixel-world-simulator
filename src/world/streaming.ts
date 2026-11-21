import { BIOMES, type Biome, type TerrainData } from '../terrain/index.ts';
import { CHUNK_SIZE_METERS, type Bounds, type Point } from './coordinates.ts';

export { BIOMES };
const BIOME_INDEX = Object.fromEntries(BIOMES.map((biome, index) => [biome, index])) as Record<Biome, number>;

export const STREAM_SETTINGS = {
  minSampleSpacing: 5,
  maxSampleSpacing: 655_360,
  pixelsPerSample: 8,
  maxTileCells: 32,
  maxActiveTiles: 120,
  maxCachedTiles: 256,
  maxTilesPerFrame: 4,
  maxMillisecondsPerFrame: 6,
} as const;

export type LodLevel = 0 | 1 | 2 | 3 | 4;

export interface DetailLevel {
  readonly lod: LodLevel;
  readonly spacing: number;
}

export interface TerrainTile extends DetailLevel {
  readonly key: string;
  readonly bounds: Bounds;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly elevations: Float32Array;
  readonly biomes: Uint8Array;
  readonly surfaceElevations: Float32Array;
  readonly moistures: Uint8Array;
}

export interface StreamView {
  readonly bounds: Bounds;
  readonly center: Point;
  readonly pixelsPerMeter: number;
  /** Optional screen-space test. Include relief and decoration margins in its viewport. */
  readonly intersects?: (bounds: Bounds) => boolean;
}

export interface StreamBudget {
  readonly maxTiles?: number;
  readonly maxMilliseconds?: number;
}

export interface StreamFrame {
  readonly lod: LodLevel;
  readonly desiredLod: LodLevel;
  readonly tiles: readonly TerrainTile[];
  /** Already sampled target tiles available to prepare while the prior layout is visible. */
  readonly pendingTiles: readonly TerrainTile[];
  readonly loading: boolean;
  /** Physical 640 m chunks represented by visible samples at LOD 3 and 4. */
  readonly loadedChunks: number;
  readonly cachedTiles: number;
  readonly targetTiles: number;
}

interface TileRequest {
  readonly key: string;
  readonly bounds: Bounds;
}

interface TileLayout {
  readonly detail: DetailLevel;
  readonly requests: readonly TileRequest[];
}

interface TileBuild {
  readonly tile: TerrainTile;
  nextRow: number;
}

type TerrainTileSource = Pick<TerrainData, 'metadata' | 'revision' | 'sample' | 'elevationAt'>;

function detailForSpacing(spacing: number): DetailLevel {
  if (spacing >= 40_960) return { lod: 0, spacing };
  if (spacing >= 5_120) return { lod: 1, spacing };
  if (spacing >= 320) return { lod: 2, spacing };
  if (spacing >= 40) return { lod: 3, spacing };
  return { lod: 4, spacing };
}

export function selectDetail(pixelsPerMeter: number): DetailLevel {
  const { minSampleSpacing, maxSampleSpacing, pixelsPerSample } = STREAM_SETTINGS;
  if (!(pixelsPerMeter > 0) || !Number.isFinite(pixelsPerMeter)) return detailForSpacing(maxSampleSpacing);
  const exponent = Math.round(Math.log2(pixelsPerSample / (pixelsPerMeter * minSampleSpacing)));
  const spacing = Math.min(maxSampleSpacing, Math.max(minSampleSpacing, minSampleSpacing * 2 ** exponent));
  return detailForSpacing(spacing);
}

function sampleAxis(min: number, max: number, spacing: number): Float64Array {
  const axis = new Float64Array(Math.ceil((max - min) / spacing) + 1);
  for (let i = 0; i < axis.length - 1; i++) axis[i] = min + i * spacing;
  axis[axis.length - 1] = max;
  return axis;
}

function centerDistanceSquared(bounds: Bounds, center: Point): number {
  const dx = (bounds.minX + bounds.maxX) / 2 - center.x;
  const dy = (bounds.minY + bounds.maxY) / 2 - center.y;
  return dx * dx + dy * dy;
}

function countPhysicalChunks(tiles: readonly TerrainTile[], lod: LodLevel): number {
  if (lod < 3) return 0;

  let count = 0;
  const dividedChunks = new Set<string>();
  for (const { bounds, spacing } of tiles) {
    const firstX = Math.floor(bounds.minX / CHUNK_SIZE_METERS);
    const firstY = Math.floor(bounds.minY / CHUNK_SIZE_METERS);
    if (spacing * STREAM_SETTINGS.maxTileCells < CHUNK_SIZE_METERS) {
      dividedChunks.add(`${firstX},${firstY}`);
    } else {
      const lastX = Math.ceil(bounds.maxX / CHUNK_SIZE_METERS);
      const lastY = Math.ceil(bounds.maxY / CHUNK_SIZE_METERS);
      count += (lastX - firstX) * (lastY - firstY);
    }
  }
  return count + dividedChunks.size;
}

export class ChunkManager {
  private readonly cache = new Map<string, TerrainTile>();
  private readonly terrain: TerrainTileSource;
  private displaySpacing?: number;
  private targetSpacing?: number;
  private partialTile?: TileBuild;
  private revision: number;

  constructor(terrain: TerrainTileSource) {
    this.terrain = terrain;
    this.revision = terrain.revision;
  }

  update(view: StreamView, budget: StreamBudget = {}): StreamFrame {
    if (this.revision !== this.terrain.revision) {
      this.revision = this.terrain.revision;
      this.cache.clear();
      this.partialTile = undefined;
    }

    const preferred = this.preferredSpacing(view.pixelsPerMeter);
    const target = this.fitLayout(preferred, view);
    this.targetSpacing = target.detail.spacing;

    const maxTiles = budget.maxTiles ?? STREAM_SETTINGS.maxTilesPerFrame;
    const maxMilliseconds = budget.maxMilliseconds ?? STREAM_SETTINGS.maxMillisecondsPerFrame;
    const targetMissing = this.missingRequests(target, view.center);
    let display = target;

    if (targetMissing.length > 0) {
      display = this.chooseDisplayLayout(target, view, targetMissing.length);
      const deadline = performance.now() + maxMilliseconds;
      let generated = 0;
      const displayMissing = display === target ? [] : this.missingRequests(display, view.center);

      build: for (const { layout, requests } of [
        { layout: display, requests: displayMissing }, { layout: target, requests: targetMissing },
      ]) {
        for (const request of requests) {
          if (generated >= maxTiles || (generated > 0 && performance.now() >= deadline)) break build;
          if (!this.advanceTile(layout.detail, request, deadline)) break build;
          generated++;
        }
      }
    }

    const loading = target.requests.some(({ key }) => !this.cache.has(key));
    if (!loading) display = target;
    this.displaySpacing = display.detail.spacing;

    // Protect both the visible layout and pending replacement during LRU eviction.
    const pendingTiles = display.detail.spacing === target.detail.spacing ? [] : this.touchTiles(target);
    const tiles = this.touchTiles(display);
    this.trimCache();

    return {
      lod: display.detail.lod,
      desiredLod: target.detail.lod,
      tiles,
      pendingTiles,
      loading,
      loadedChunks: countPhysicalChunks(tiles, display.detail.lod),
      cachedTiles: this.cache.size,
      targetTiles: target.requests.length,
    };
  }

  private preferredSpacing(pixelsPerMeter: number): number {
    if (!(pixelsPerMeter > 0) || !Number.isFinite(pixelsPerMeter)) return STREAM_SETTINGS.maxSampleSpacing;
    if (this.targetSpacing !== undefined) {
      const relativeSize = this.targetSpacing * pixelsPerMeter / STREAM_SETTINGS.pixelsPerSample;
      if (relativeSize >= 0.64 && relativeSize <= 1.56) return this.targetSpacing;
    }
    return selectDetail(pixelsPerMeter).spacing;
  }

  private chooseDisplayLayout(target: TileLayout, view: StreamView, missingCount: number): TileLayout {
    const previous = this.displaySpacing === undefined ? undefined : this.createLayout(this.displaySpacing, view);
    if (previous && previous.detail.spacing === target.detail.spacing && missingCount <= 12) return target;
    if (previous && previous.requests.length > 0) {
      const ready = previous.requests.filter(({ key }) => this.cache.has(key)).length;
      if (ready > 0 && (ready * 2 >= previous.requests.length || previous.requests.length - ready <= 12)) {
        return previous.detail.spacing === target.detail.spacing ? target : previous;
      }
    }
    if (missingCount <= 12) return target;

    // A small coarse layout fills the screen quickly on startup and after a large camera jump.
    const coarseSpacing = Math.min(STREAM_SETTINGS.maxSampleSpacing, target.detail.spacing * 4);
    if (coarseSpacing === target.detail.spacing) return target;
    return this.fitLayout(coarseSpacing, view);
  }

  private fitLayout(spacing: number, view: StreamView): TileLayout {
    // Larger custom worlds may need to aggregate beyond the normal overview.
    for (let candidate = spacing; ; candidate *= 2) {
      const layout = this.createLayout(candidate, view);
      if (layout) return layout;
    }
  }

  private createLayout(spacing: number, view: StreamView): TileLayout | undefined {
    const detail = detailForSpacing(spacing);
    const tileSize = spacing * STREAM_SETTINGS.maxTileCells;
    const side = this.terrain.metadata.worldSizeMeters;
    const firstX = Math.max(0, Math.floor(view.bounds.minX / tileSize));
    const firstY = Math.max(0, Math.floor(view.bounds.minY / tileSize));
    const lastX = Math.ceil(Math.min(side, view.bounds.maxX) / tileSize) - 1;
    const lastY = Math.ceil(Math.min(side, view.bounds.maxY) / tileSize) - 1;
    const requests: TileRequest[] = [];

    if (lastX < firstX || lastY < firstY) return { detail, requests };
    const candidateCount = (lastX - firstX + 1) * (lastY - firstY + 1);
    if (candidateCount > STREAM_SETTINGS.maxActiveTiles * 4) return undefined;

    for (let y = firstY; y <= lastY; y++) {
      for (let x = firstX; x <= lastX; x++) {
        const bounds: Bounds = {
          minX: x * tileSize,
          minY: y * tileSize,
          maxX: Math.min((x + 1) * tileSize, side),
          maxY: Math.min((y + 1) * tileSize, side),
        };
        if (view.intersects && !view.intersects(bounds)) continue;
        requests.push({ key: `${this.revision}/${spacing}/${x}/${y}`, bounds });
        if (requests.length > STREAM_SETTINGS.maxActiveTiles) return undefined;
      }
    }
    return { detail, requests };
  }

  private missingRequests(layout: TileLayout, center: Point): TileRequest[] {
    return layout.requests
      .filter(({ key }) => !this.cache.has(key))
      .sort((a, b) => centerDistanceSquared(a.bounds, center) - centerDistanceSquared(b.bounds, center));
  }

  private touchTiles(layout: TileLayout): TerrainTile[] {
    const tiles: TerrainTile[] = [];
    for (const { key } of layout.requests) {
      const tile = this.cache.get(key);
      if (!tile) continue;
      this.cache.delete(key);
      this.cache.set(key, tile);
      tiles.push(tile);
    }
    return tiles;
  }

  private trimCache(): void {
    for (const key of this.cache.keys()) {
      if (this.cache.size <= STREAM_SETTINGS.maxCachedTiles) break;
      this.cache.delete(key);
    }
  }

  private beginTile(detail: DetailLevel, { key, bounds }: TileRequest): TileBuild {
    const { spacing } = detail;
    const xs = sampleAxis(bounds.minX, bounds.maxX, spacing);
    const ys = sampleAxis(bounds.minY, bounds.maxY, spacing);
    const cellCount = (xs.length - 1) * (ys.length - 1);
    return {
      tile: {
        ...detail, key, bounds, xs, ys,
        elevations: new Float32Array(xs.length * ys.length),
        biomes: new Uint8Array(cellCount),
        surfaceElevations: new Float32Array(cellCount),
        moistures: new Uint8Array(cellCount),
      },
      nextRow: 0,
    };
  }

  private advanceTile(detail: DetailLevel, request: TileRequest, deadline: number): boolean {
    const build = this.partialTile?.tile.key === request.key ? this.partialTile : this.beginTile(detail, request);
    const { xs, ys, spacing, elevations, biomes, surfaceElevations, moistures } = build.tile;
    const cellWidth = xs.length - 1;

    while (build.nextRow < ys.length) {
      const y = build.nextRow++;
      for (let x = 0; x < xs.length; x++) {
        elevations[y * xs.length + x] = this.terrain.elevationAt(xs[x], ys[y]);
      }
      if (y === ys.length - 1) break;
      const centerY = (ys[y] + ys[y + 1]) / 2;
      for (let x = 0; x < cellWidth; x++) {
        const centerX = (xs[x] + xs[x + 1]) / 2;
        const sample = this.terrain.sample(centerX, centerY, spacing);
        const index = y * cellWidth + x;
        biomes[index] = BIOME_INDEX[sample.biome];
        surfaceElevations[index] = sample.elevation;
        moistures[index] = Math.round(Math.max(0, Math.min(1, sample.moisture)) * 255);
      }
      if (performance.now() >= deadline) {
        this.partialTile = build;
        return false;
      }
    }

    this.cache.set(request.key, build.tile);
    this.partialTile = undefined;
    return true;
  }
}
