import { Container, Mesh, MeshGeometry } from 'pixi.js';
import { projectIsometric, surfaceElevation, type Point } from '../world/coordinates.ts';
import { BIOMES, type TerrainTile } from '../world/streaming.ts';
import { createTerrainPalette, decorationTexel, PALETTE_HEIGHT, PALETTE_WIDTH, terrainTexel } from './terrain-palette.ts';

interface RenderCamera {
  center: Point;
  width: number;
  height: number;
  pixelsPerMeter: number;
}

interface RenderTile {
  origin: Point;
  mesh: Mesh;
}

const TREE_GRID_METERS = 28;
const TREE_PIXEL_METERS = 2.15;
const MESH_PREPARATION_BUDGET_MS = 2.5;

function pixelNoise(x: number, y: number): number {
  let bits = Math.imul(x, 0x2c1b3c6d) ^ Math.imul(y, 0x297a2d39);
  bits = Math.imul(bits ^ (bits >>> 15), 0x2c1b3c6d);
  return ((bits ^ (bits >>> 12)) >>> 0) / 0x1_0000_0000;
}

function terrainLight(riseX: number, riseY: number, spacing: number): number {
  // Larger detail bands omit local relief, so their gradients need a stronger light response.
  const relief = 2.1 + Math.sqrt(spacing) * 0.6;
  const gradient = (riseX * 0.81 + riseY * 0.59) * relief;
  return 0.99 + Math.tanh(gradient) * 0.29;
}

class TileGeometry {
  private readonly positions: Float32Array;
  private readonly uvs: Float32Array;
  private readonly indices: Uint32Array;
  private positionLength = 0;
  private indexLength = 0;

  constructor(faceCount: number, treeCapacity: number) {
    this.positions = new Float32Array(faceCount * 12 + treeCapacity * 48);
    this.uvs = new Float32Array(this.positions.length);
    this.indices = new Uint32Array(faceCount * 6 + treeCapacity * 36);
  }

  triangle(points: Float32Array, first: number, second: number, third: number, texel: number): void {
    const start = this.positionLength / 2;
    this.vertex(points[first * 2], points[first * 2 + 1], texel);
    this.vertex(points[second * 2], points[second * 2 + 1], texel);
    this.vertex(points[third * 2], points[third * 2 + 1], texel);
    this.indices[this.indexLength++] = start;
    this.indices[this.indexLength++] = start + 1;
    this.indices[this.indexLength++] = start + 2;
  }

  rectangle(x: number, y: number, width: number, height: number, texel: number): void {
    const start = this.positionLength / 2;
    this.vertex(x, y, texel);
    this.vertex(x + width, y, texel);
    this.vertex(x + width, y + height, texel);
    this.vertex(x, y + height, texel);
    this.indices[this.indexLength++] = start;
    this.indices[this.indexLength++] = start + 1;
    this.indices[this.indexLength++] = start + 2;
    this.indices[this.indexLength++] = start;
    this.indices[this.indexLength++] = start + 2;
    this.indices[this.indexLength++] = start + 3;
  }

  finish(): MeshGeometry {
    return new MeshGeometry({
      positions: this.positions.subarray(0, this.positionLength),
      uvs: this.uvs.subarray(0, this.positionLength),
      indices: this.indices.subarray(0, this.indexLength),
    });
  }

  private vertex(x: number, y: number, texel: number): void {
    const offset = this.positionLength;
    this.positions[offset] = x;
    this.positions[offset + 1] = y;
    this.uvs[offset] = (texel % PALETTE_WIDTH + 0.5) / PALETTE_WIDTH;
    this.uvs[offset + 1] = (Math.floor(texel / PALETTE_WIDTH) + 0.5) / PALETTE_HEIGHT;
    this.positionLength += 2;
  }
}

function projectedVertices(tile: TerrainTile, surface: Float32Array): Float32Array {
  const { xs, ys } = tile;
  const projected = new Float32Array(xs.length * ys.length * 2);

  for (let y = 0; y < ys.length; y++) {
    for (let x = 0; x < xs.length; x++) {
      const index = y * xs.length + x;
      const position = projectIsometric(xs[x] - xs[0], ys[y] - ys[0], surface[index]);
      projected[index * 2] = position.x;
      projected[index * 2 + 1] = position.y;
    }
  }

  return projected;
}

function appendTree(geometry: TileGeometry, root: Point, size: number): void {
  const { x, y } = root;
  geometry.rectangle(x - size, y - 3 * size, 2 * size, 3 * size, decorationTexel(0));
  geometry.rectangle(x - 3 * size, y - 7 * size, 6 * size, 4 * size, decorationTexel(1));
  geometry.rectangle(x - 2 * size, y - 9 * size, 4 * size, 3 * size, decorationTexel(2));
  geometry.rectangle(x - 3 * size, y - 7 * size, 4 * size, 2 * size, decorationTexel(2));
  geometry.rectangle(x - 2 * size, y - 8 * size, 2 * size, 2 * size, decorationTexel(3));
  geometry.rectangle(x - size, y - 9 * size, size, size, decorationTexel(4));
}

function appendForest(
  geometry: TileGeometry,
  tile: TerrainTile,
  surface: Float32Array,
  column: number,
  row: number,
  moisture: number,
): void {
  const { xs, ys } = tile;
  const minX = xs[column];
  const minY = ys[row];
  const maxX = xs[column + 1];
  const maxY = ys[row + 1];
  const rowOffset = row * xs.length + column;

  for (let gy = Math.floor(minY / TREE_GRID_METERS); gy * TREE_GRID_METERS < maxY; gy++) {
    for (let gx = Math.floor(minX / TREE_GRID_METERS); gx * TREE_GRID_METERS < maxX; gx++) {
      const chance = pixelNoise(gx, gy);
      if (chance > 0.18 + moisture * 0.36) continue;

      const x = (gx + 0.12 + pixelNoise(gx + 889, gy) * 0.76) * TREE_GRID_METERS;
      const y = (gy + 0.12 + pixelNoise(gx, gy - 431) * 0.76) * TREE_GRID_METERS;
      if (x < minX || x >= maxX || y < minY || y >= maxY) continue;

      // Use the same NW–SE triangle as the terrain mesh to keep each trunk on the surface.
      const u = (x - minX) / (maxX - minX);
      const v = (y - minY) / (maxY - minY);
      const nw = surface[rowOffset];
      const ne = surface[rowOffset + 1];
      const sw = surface[rowOffset + xs.length];
      const se = surface[rowOffset + xs.length + 1];
      const height = u >= v ? nw * (1 - u) + ne * (u - v) + se * v : nw * (1 - v) + sw * (v - u) + se * u;
      const root = projectIsometric(x - xs[0], y - ys[0], height);
      appendTree(geometry, root, TREE_PIXEL_METERS * (0.83 + chance * 0.58));
    }
  }
}

function createTileGeometry(tile: TerrainTile): MeshGeometry {
  const { xs, ys, spacing } = tile;
  const rows = ys.length - 1;
  const columns = xs.length - 1;
  const surface = tile.elevations.map(surfaceElevation);
  const vertices = projectedVertices(tile, surface);
  const trees = tile.lod === 4 && spacing <= 20;
  const treeColumns = Math.ceil(xs[columns] / TREE_GRID_METERS) - Math.floor(xs[0] / TREE_GRID_METERS);
  const treeRows = Math.ceil(ys[rows] / TREE_GRID_METERS) - Math.floor(ys[0] / TREE_GRID_METERS);
  const geometry = new TileGeometry(rows * columns, trees ? treeColumns * treeRows : 0);

  for (let diagonal = 0; diagonal < rows + columns - 1; diagonal++) {
    const end = Math.min(rows - 1, diagonal);
    for (let y = Math.max(0, diagonal - columns + 1); y <= end; y++) {
      const x = diagonal - y;
      const face = y * columns + x;
      const nw = y * xs.length + x;
      const ne = nw + 1;
      const sw = nw + xs.length;
      const se = sw + 1;
      const biome = BIOMES[tile.biomes[face]];
      const height = tile.surfaceElevations[face];
      const moisture = tile.moistures[face] / 255;
      const width = xs[x + 1] - xs[x];
      const depth = ys[y + 1] - ys[y];
      const noise = pixelNoise(Math.floor(xs[x] / spacing), Math.floor(ys[y] / spacing)) - 0.5;
      const grain = noise * (tile.lod >= 3 ? 0.085 : 0.044);
      const lightNE = terrainLight((surface[ne] - surface[nw]) / width, (surface[se] - surface[ne]) / depth, spacing);
      const lightSW = terrainLight((surface[se] - surface[sw]) / width, (surface[sw] - surface[nw]) / depth, spacing);
      const light = biome === 'ocean' || biome === 'river' ? 0.98 : (lightNE + lightSW) * 0.5;

      // A small facet response reveals local slopes without adding visible lines between cells.
      const facet = biome === 'ocean' || biome === 'river' ? 0 : (lightNE - lightSW) * 0.22;
      geometry.triangle(vertices, nw, ne, se, terrainTexel(biome, height, moisture, light + grain + facet));
      geometry.triangle(vertices, nw, se, sw, terrainTexel(biome, height, moisture, light + grain - facet));
      if (trees && biome === 'forest') appendForest(geometry, tile, surface, x, y, moisture);
    }
  }

  return geometry.finish();
}

export class TerrainRenderer {
  private readonly layer = new Container({ sortableChildren: true });
  private readonly palette = createTerrainPalette();
  private readonly entries = new Map<string, RenderTile>();

  constructor(parent: Container) {
    this.layer.eventMode = 'none';
    parent.addChild(this.layer);
  }

  get resourceCount(): number {
    return this.entries.size;
  }

  render(tiles: readonly TerrainTile[], camera: RenderCamera, pendingTiles: readonly TerrainTile[] = []): void {
    const active = new Set(tiles.map((tile) => tile.key));
    const pending = new Set(pendingTiles.map((tile) => tile.key));
    for (const [key, entry] of this.entries) {
      if (active.has(key)) continue;
      if (pending.has(key)) {
        entry.mesh.removeFromParent();
      } else {
        this.disposeMesh(entry.mesh);
        this.entries.delete(key);
      }
    }

    for (const tile of tiles) {
      const entry = this.entries.get(tile.key) ?? this.createRenderTile(tile);
      if (!entry.mesh.parent) this.layer.addChild(entry.mesh);
    }

    const deadline = performance.now() + MESH_PREPARATION_BUDGET_MS;
    for (const tile of pendingTiles) {
      if (!this.entries.has(tile.key)) this.createRenderTile(tile);
      if (performance.now() >= deadline) break;
    }

    this.layer.position.set(camera.width / 2, camera.height / 2);
    this.layer.scale.set(camera.pixelsPerMeter);

    for (const { mesh, origin } of this.entries.values()) {
      if (!mesh.parent) continue;
      const offset = projectIsometric(origin.x - camera.center.x, origin.y - camera.center.y);
      mesh.position.set(offset.x, offset.y);
    }
  }

  destroy(): void {
    for (const { mesh } of this.entries.values()) this.disposeMesh(mesh);
    this.entries.clear();
    this.layer.destroy();
    this.palette.destroy(true);
  }

  private createRenderTile(tile: TerrainTile): RenderTile {
    const mesh = new Mesh({ geometry: createTileGeometry(tile), texture: this.palette });
    mesh.zIndex = tile.bounds.minX + tile.bounds.maxX + tile.bounds.minY + tile.bounds.maxY;
    const origin = { x: tile.xs[0], y: tile.ys[0] };
    const entry = { mesh, origin };
    this.entries.set(tile.key, entry);
    return entry;
  }

  private disposeMesh(mesh: Mesh): void {
    const geometry = mesh.geometry;
    mesh.destroy();
    geometry.destroy(true);
  }
}
