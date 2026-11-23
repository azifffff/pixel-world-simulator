import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, type Scene } from 'three';
import type { Camera3D } from '../world/camera3d.ts';
import {
  CHUNK_SIZE_METERS, HEX_FLAT_WIDTH_METERS, MAX_DISPLAY_ELEVATION,
  clippedHexPolygon, hexesInBounds, type Bounds, type Hex, type Point,
} from '../world/coordinates.ts';
import { HEIGHT_SCALE, type RenderOrigin } from '../world/coordinates3d.ts';
import type { TerrainTile } from '../world/streaming.ts';
import { buildTileContours, clipLine, contourInterval, drapeTileLine, drawChunkLines, type DrawSegment } from './overlay-geometry.ts';

const MAX_GRID_HEXES = 650;
const MAX_HEX_SEGMENTS = 20_000;
const MAX_CHUNK_SEGMENTS = 18_000;
const MAX_CONTOUR_SEGMENTS = 10_000;
const CONTOUR_STRIDE = 5;

interface Options {
  readonly hex: boolean;
  readonly chunks: boolean;
  readonly contours: boolean;
}

interface ContourCache {
  interval: number;
  segments: Float32Array | null;
}

function limits(tiles: readonly TerrainTile[]): Bounds {
  return {
    minX: Math.min(...tiles.map(({ bounds }) => bounds.minX)),
    minY: Math.min(...tiles.map(({ bounds }) => bounds.minY)),
    maxX: Math.max(...tiles.map(({ bounds }) => bounds.maxX)),
    maxY: Math.max(...tiles.map(({ bounds }) => bounds.maxY)),
  };
}

// Adjacent polygons and tiles can both own an exactly aligned edge. Key it
// at micrometre resolution in world coordinates to avoid blending it twice.
function lineKey(from: Point, to: Point): string {
  const pointKey = ({ x, y }: Point) => String(Math.round(x * 1e6)) + ',' + Math.round(y * 1e6);
  const a = pointKey(from);
  const b = pointKey(to);
  return a < b ? a + ':' + b : b + ':' + a;
}

function withSegmentBudget(origin: RenderOrigin, limit: number) {
  const positions: number[] = [];
  const draw: DrawSegment = (a, b) => {
    if (a.x === b.x && a.y === b.y) return true;
    if (positions.length >= limit * 6) return false;
    positions.push(
      a.x - origin.x, a.elevation * HEIGHT_SCALE, a.y - origin.y,
      b.x - origin.x, b.elevation * HEIGHT_SCALE, b.y - origin.y,
    );
    return true;
  };
  return { positions, draw };
}

function hexPositions(hexes: readonly Hex[], tiles: readonly TerrainTile[], worldSize: number, origin: RenderOrigin) {
  const { positions, draw } = withSegmentBudget(origin, MAX_HEX_SEGMENTS);
  const edges = new Map<string, [Point, Point]>();
  for (const { q, r } of hexes) {
    const polygon = clippedHexPolygon(q, r, worldSize);
    for (let i = 0; i < polygon.length; i++) {
      const from = polygon[i];
      const to = polygon[(i + 1) % polygon.length];
      edges.set(lineKey(from, to), [from, to]);
    }
  }

  const drawnOnBorders = new Set<string>();
  for (const [from, to] of edges.values()) {
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);
    for (const tile of tiles) {
      const bounds = tile.bounds;
      if (minX > bounds.maxX || maxX < bounds.minX || minY > bounds.maxY || maxY < bounds.minY) continue;
      const segment = clipLine(from, to, bounds);
      if (!segment) continue;

      const [start, end] = segment;
      const onBorder = (start.x === end.x && (start.x === bounds.minX || start.x === bounds.maxX)) ||
        (start.y === end.y && (start.y === bounds.minY || start.y === bounds.maxY));
      if (onBorder) {
        const key = lineKey(start, end);
        if (drawnOnBorders.has(key)) continue;
        drawnOnBorders.add(key);
      }
      if (!drapeTileLine(tile, start, end, draw)) return [];
    }
  }
  return positions;
}

class OverlayLayer {
  private readonly line: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly bias = { value: 0 };
  private origin: RenderOrigin = { x: 0, y: 0 };
  private key: string | null = null;
  private hasPositions = false;

  constructor(scene: Scene, name: string, color: number, opacity: number, order: number) {
    const material = new LineBasicMaterial({ color, opacity, transparent: true, depthWrite: false });
    // Depth bias retains the exact world coordinates and works on line primitives.
    material.onBeforeCompile = (shader) => {
      shader.uniforms.aetherOverlayBias = this.bias;
      shader.vertexShader = 'uniform float aetherOverlayBias;\n' + shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n gl_Position.z -= aetherOverlayBias * gl_Position.w;',
      );
    };
    this.line = new LineSegments(new BufferGeometry(), material);
    this.line.name = name;
    this.line.renderOrder = order;
    this.line.visible = false;
    scene.add(this.line);
  }

  invalidate(): void {
    this.key = null;
  }

  update(key: string | null, origin: RenderOrigin, bias: number, build: () => number[]): void {
    if (key === null) {
      this.line.visible = false;
      return;
    }
    if (this.key !== key) {
      const positions = build();
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      this.line.geometry.dispose();
      this.line.geometry = geometry;
      this.hasPositions = positions.length > 0;
      this.origin = origin;
      this.key = key;
    }
    this.line.position.set(this.origin.x - origin.x, 0, this.origin.y - origin.y);
    this.line.visible = this.hasPositions;
    this.bias.value = bias;
  }

  destroy(): void {
    this.line.removeFromParent();
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}

export class TerrainOverlays3D {
  private readonly grid: OverlayLayer;
  private readonly highlight: OverlayLayer;
  private readonly chunks: OverlayLayer;
  private readonly contours: OverlayLayer;
  private readonly contourCache = new WeakMap<TerrainTile, ContourCache>();
  private tiles: readonly TerrainTile[] = [];

  constructor(scene: Scene) {
    this.contours = new OverlayLayer(scene, 'terrain-contours', 0x584633, 0.65, 1);
    this.grid = new OverlayLayer(scene, 'terrain-hex-grid', 0xebeece, 0.52, 2);
    this.chunks = new OverlayLayer(scene, 'terrain-chunks', 0xffe2aa, 0.64, 3);
    this.highlight = new OverlayLayer(scene, 'terrain-selected-hex', 0xffd48b, 0.95, 4);
  }

  render(options: Options, selected: Hex | null, camera: Camera3D, tiles: readonly TerrainTile[]): void {
    if (this.tiles.length !== tiles.length || this.tiles.some((tile, i) => tile !== tiles[i])) {
      this.tiles = tiles;
      this.contours.invalidate();
      this.grid.invalidate();
      this.chunks.invalidate();
      this.highlight.invalidate();
    }
    const { origin, pixelsPerMeter } = camera.frame;
    const { near, far } = camera.camera;
    // A few depth-buffer units, bounded well below one CSS pixel of depth.
    const bias = Math.max(4 / 2 ** 24, Math.min(1e-5, 0.16 / ((far - near) * pixelsPerMeter)));
    const hasTiles = tiles.length > 0;
    const hexPixels = HEX_FLAT_WIDTH_METERS * pixelsPerMeter;

    this.grid.update(hasTiles && options.hex && hexPixels >= 20 ? 'grid' : null, origin, bias, () => {
      const hexes = hexesInBounds(limits(tiles), MAX_GRID_HEXES);
      return hexes ? hexPositions(hexes, tiles, camera.worldSize, origin) : [];
    });
    const selectedKey = selected && selected.q + ',' + selected.r;
    this.highlight.update(hasTiles && options.hex && hexPixels >= 3 ? selectedKey : null, origin, bias, () =>
      selected ? hexPositions([selected], tiles, camera.worldSize, origin) : []);
    this.chunks.update(hasTiles && options.chunks && CHUNK_SIZE_METERS * pixelsPerMeter >= 18 ? 'chunks' : null,
      origin, bias, () => {
        const { positions, draw } = withSegmentBudget(origin, MAX_CHUNK_SEGMENTS);
        return drawChunkLines(tiles, camera.worldSize, draw, MAX_CHUNK_SEGMENTS) ? positions : [];
      });
    this.contours.update(hasTiles && options.contours ? 'contours' : null, origin, bias, () =>
      this.contourPositions(tiles, origin));
  }

  destroy(): void {
    this.contours.destroy();
    this.grid.destroy();
    this.chunks.destroy();
    this.highlight.destroy();
    this.tiles = [];
  }

  private contourPositions(tiles: readonly TerrainTile[], origin: RenderOrigin): number[] {
    let interval = contourInterval(tiles[0].spacing);
    while (interval <= MAX_DISPLAY_ELEVATION) {
      const positions: number[] = [];
      for (const tile of tiles) {
        const cached = this.contourCache.get(tile);
        const segments = cached?.interval === interval ? cached.segments
          : buildTileContours(tile, interval, MAX_CONTOUR_SEGMENTS);
        if (cached?.interval !== interval) this.contourCache.set(tile, { interval, segments });
        if (!segments || positions.length / 6 + segments.length / CONTOUR_STRIDE > MAX_CONTOUR_SEGMENTS) break;

        const x = tile.bounds.minX - origin.x;
        const z = tile.bounds.minY - origin.y;
        for (let i = 0; i < segments.length; i += CONTOUR_STRIDE) {
          const y = segments[i + 4] * HEIGHT_SCALE;
          positions.push(x + segments[i], y, z + segments[i + 1], x + segments[i + 2], y, z + segments[i + 3]);
        }
        if (tile === tiles[tiles.length - 1]) return positions;
      }
      // Coarsen all neighboring tiles together to preserve a consistent interval at their seams.
      interval *= 2;
    }
    return [];
  }
}
