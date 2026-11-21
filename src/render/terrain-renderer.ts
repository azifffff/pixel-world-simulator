import { RIVER_LINE_SPACING } from './river-overlay.ts';
import { Container, Mesh, MeshGeometry, State, type Shader } from 'pixi.js';
import {
  FOREST_MATERIAL, isBathymetryMaterial, isWaterMaterial, materialForBiome, RIVER_MATERIAL,
  NEUTRAL_LAND_MATERIAL, NEUTRAL_SEA_MATERIAL,
} from '../terrain/aether-classification.ts';
import { projectIsometric, surfaceElevation, type Point } from '../world/coordinates.ts';
import { BIOMES, type TerrainTile } from '../world/streaming.ts';
import { cliffTexel, createTerrainPalette, decorationTexel, PALETTE_HEIGHT, PALETTE_WIDTH, terrainTexel } from './terrain-palette.ts';
import { pixelNoise, rootedTreeElevation, terrainDepth, terrainFacet, treeRoot, TREE_GRID_METERS, type TreeRoot } from './terrain-detail.ts';
import { createTerrainShader } from './terrain-shader.ts';

interface RenderCamera {
  center: Point;
  width: number;
  height: number;
  pixelsPerMeter: number;
}

interface RenderTile {
  origin: Point;
  mesh: Mesh<MeshGeometry, Shader>;
}

export interface TerrainRenderOptions {
  readonly colors: boolean;
  readonly shading: boolean;
  readonly water: boolean;
  readonly classification: boolean;
}

const DEFAULT_OPTIONS: TerrainRenderOptions = { colors: true, shading: true, water: true, classification: false };

const MESH_PREPARATION_BUDGET_MS = 2.5;
const TREE_QUADS = 7;
const PROJECTED_METERS_PER_HEIGHT_METER = -projectIsometric(0, 0, 1).y;

interface PlacedTree extends TreeRoot {
  readonly elevation: number;
}

class TileGeometry {
  private readonly positions: Float32Array;
  private readonly uvs: Float32Array;
  private readonly indices: Uint32Array;
  private readonly depths: Float32Array;
  private positionLength = 0;
  private indexLength = 0;

  constructor(faceCount: number, treeCapacity: number) {
    const treeQuads = treeCapacity * TREE_QUADS;
    this.positions = new Float32Array(faceCount * 12 + treeQuads * 8);
    this.uvs = new Float32Array(this.positions.length);
    this.depths = new Float32Array(this.positions.length / 2);
    this.indices = new Uint32Array(faceCount * 6 + treeQuads * 6);
  }

  triangle(
    points: Float32Array, elevations: Float32Array, first: number, second: number, third: number, texel: number,
  ): void {
    const start = this.positionLength / 2;
    this.vertex(points[first * 2], points[first * 2 + 1], elevations[first], texel);
    this.vertex(points[second * 2], points[second * 2 + 1], elevations[second], texel);
    this.vertex(points[third * 2], points[third * 2 + 1], elevations[third], texel);
    this.indices[this.indexLength++] = start;
    this.indices[this.indexLength++] = start + 1;
    this.indices[this.indexLength++] = start + 2;
  }

  treeBand(
    x: number, rootY: number, width: number, elevation: number, bottom: number, top: number, texel: number,
  ): void {
    const start = this.positionLength / 2;
    const topY = rootY - top * PROJECTED_METERS_PER_HEIGHT_METER;
    const bottomY = rootY - bottom * PROJECTED_METERS_PER_HEIGHT_METER;
    this.vertex(x, topY, elevation + top, texel);
    this.vertex(x + width, topY, elevation + top, texel);
    this.vertex(x + width, bottomY, elevation + bottom, texel);
    this.vertex(x, bottomY, elevation + bottom, texel);
    this.indices[this.indexLength++] = start;
    this.indices[this.indexLength++] = start + 1;
    this.indices[this.indexLength++] = start + 2;
    this.indices[this.indexLength++] = start;
    this.indices[this.indexLength++] = start + 2;
    this.indices[this.indexLength++] = start + 3;
  }

  finish(): MeshGeometry {
    const geometry = new MeshGeometry({
      positions: this.positions.subarray(0, this.positionLength),
      uvs: this.uvs.subarray(0, this.positionLength),
      indices: this.indices.subarray(0, this.indexLength),
    });
    geometry.addAttribute('aDepth', {
      buffer: this.depths.subarray(0, this.positionLength / 2), format: 'float32', stride: 4,
    });
    return geometry;
  }

  private vertex(x: number, y: number, height: number, texel: number): void {
    const offset = this.positionLength;
    this.depths[offset / 2] = terrainDepth(height);
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

function appendTree(geometry: TileGeometry, tree: PlacedTree, origin: Point): void {
  const { canopy, trunk, height, elevation } = tree;
  const root = projectIsometric(tree.x - origin.x, tree.y - origin.y, elevation);
  geometry.treeBand(root.x - trunk / 2, root.y, trunk, elevation, 0, height * 0.38, decorationTexel(0));
  // Opaque, non-overlapping bands all sit on the same vertical plane through the trunk.
  const bands = [
    { bottom: 0.38, top: 0.64, width: 1, leftColor: 2, rightColor: 1 },
    { bottom: 0.64, top: 0.85, width: 0.74, leftColor: 3, rightColor: 2 },
    { bottom: 0.85, top: 1, width: 0.4, leftColor: 4, rightColor: 3 },
  ];
  for (const band of bands) {
    const width = canopy * band.width;
    const left = root.x - width * 0.5;
    const middle = left + width * 0.58;
    geometry.treeBand(left, root.y, width * 0.58, elevation, height * band.bottom, height * band.top, decorationTexel(band.leftColor));
    geometry.treeBand(middle, root.y, width * 0.42, elevation, height * band.bottom, height * band.top, decorationTexel(band.rightColor));
  }
}

function collectTrees(tile: TerrainTile, surface: Float32Array): PlacedTree[] {
  const { xs, ys, spacing, materials, biomes, moistures } = tile;
  const maxX = xs[xs.length - 1];
  const maxY = ys[ys.length - 1];
  const trees: PlacedTree[] = [];

  for (let gy = Math.floor(ys[0] / TREE_GRID_METERS); gy * TREE_GRID_METERS < maxY; gy++) {
    for (let gx = Math.floor(xs[0] / TREE_GRID_METERS); gx * TREE_GRID_METERS < maxX; gx++) {
      const tree = treeRoot(gx, gy);
      if (tree.x < xs[0] || tree.x >= maxX || tree.y < ys[0] || tree.y >= maxY) continue;
      const column = Math.floor((tree.x - xs[0]) / spacing);
      const row = Math.floor((tree.y - ys[0]) / spacing);
      const face = row * (xs.length - 1) + column;
      if ((materials?.[face] ?? materialForBiome(BIOMES[biomes[face]])) !== FOREST_MATERIAL) continue;
      const moisture = moistures[face] / 255;
      if (pixelNoise(gx, gy) > 0.49 + moisture * 0.26) continue;

      const index = row * xs.length + column;
      const width = xs[column + 1] - xs[column];
      const depth = ys[row + 1] - ys[row];
      const elevation = rootedTreeElevation(
        (tree.x - xs[column]) / width, (tree.y - ys[row]) / depth,
        surface[index], surface[index + 1], surface[index + xs.length], surface[index + xs.length + 1],
        width, depth,
      );
      if (elevation !== null) trees.push({ ...tree, elevation });
    }
  }
  return trees;
}

function createTileGeometry(tile: TerrainTile, options: TerrainRenderOptions): MeshGeometry {
  const { xs, ys, spacing } = tile;
  const rows = ys.length - 1;
  const columns = xs.length - 1;
  const surface = tile.elevations.map(surfaceElevation);
  const vertices = projectedVertices(tile, surface);
  const trees = tile.lod === 4 && spacing <= 20 && options.colors && !options.classification
    ? collectTrees(tile, surface)
    : [];
  const geometry = new TileGeometry(rows * columns, trees.length);
  const materials = options.water ? tile.materials : tile.dryMaterials;

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
      const sampled = materials?.[face] ?? materialForBiome(biome);
      const original = spacing >= RIVER_LINE_SPACING && sampled === RIVER_MATERIAL
        ? tile.dryMaterials?.[face] ?? sampled
        : sampled;
      const water = isWaterMaterial(original);
      const material = options.colors ? original : water ? NEUTRAL_SEA_MATERIAL : NEUTRAL_LAND_MATERIAL;
      const width = xs[x + 1] - xs[x];
      const depth = ys[y + 1] - ys[y];
      const strength = options.shading ? options.classification ? 0.1 : 1 : 0;
      const grain = (pixelNoise(Math.floor(xs[x] / spacing), Math.floor(ys[y] / spacing)) - 0.5) *
        strength * (tile.lod >= 3 ? 0.075 : 0.027);
      const bathymetry = !options.classification && isBathymetryMaterial(material) ? height : undefined;
      if (water) {
        const light = 1 + grain - strength * Math.min(1, Math.max(0, -height / 6_500)) * 0.16;
        const texel = terrainTexel(material, light, bathymetry);
        geometry.triangle(vertices, surface, nw, ne, se, texel);
        geometry.triangle(vertices, surface, nw, se, sw, texel);
      } else {
        const neFacet = terrainFacet(surface[nw], surface[ne], surface[se],
          (surface[ne] - surface[nw]) / width, (surface[se] - surface[ne]) / depth, spacing);
        const swFacet = terrainFacet(surface[nw], surface[sw], surface[se],
          (surface[se] - surface[sw]) / width, (surface[sw] - surface[nw]) / depth, spacing);
        const rockFaces = options.colors && !options.classification;
        const neLight = 1 + (neFacet.light - 1) * strength + grain;
        const swLight = 1 + (swFacet.light - 1) * strength + grain;
        geometry.triangle(vertices, surface, nw, ne, se,
          rockFaces && neFacet.cliff ? cliffTexel(neLight) : terrainTexel(material, neLight));
        geometry.triangle(vertices, surface, nw, se, sw,
          rockFaces && swFacet.cliff ? cliffTexel(swLight) : terrainTexel(material, swLight));
      }
    }
  }

  const origin = { x: xs[0], y: ys[0] };
  for (const tree of trees) appendTree(geometry, tree, origin);
  return geometry.finish();
}

export class TerrainRenderer {
  private readonly layer = new Container({ sortableChildren: true });
  private readonly palette = createTerrainPalette();
  private readonly shader = createTerrainShader(this.palette);
  private readonly state = State.for2d();
  private readonly entries = new Map<string, RenderTile>();
  private options = DEFAULT_OPTIONS;

  constructor(parent: Container) {
    this.layer.eventMode = 'none';
    this.state.depthTest = true;
    this.state.depthMask = true;
    this.state.blend = false;
    parent.addChild(this.layer);
  }

  get resourceCount(): number {
    return this.entries.size;
  }

  setOptions(options: TerrainRenderOptions): void {
    if (
      this.options.colors === options.colors && this.options.shading === options.shading &&
      this.options.water === options.water && this.options.classification === options.classification
    ) return;
    this.options = { ...options };
    this.clearTiles();
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
    this.clearTiles();
    this.layer.destroy();
    this.shader.destroy();
    this.palette.destroy(true);
  }

  private createRenderTile(tile: TerrainTile): RenderTile {
    const mesh = new Mesh({
      geometry: createTileGeometry(tile, this.options), texture: this.palette, shader: this.shader, state: this.state,
    });
    mesh.zIndex = tile.bounds.minX + tile.bounds.maxX + tile.bounds.minY + tile.bounds.maxY;
    const origin = { x: tile.xs[0], y: tile.ys[0] };
    const entry = { mesh, origin };
    this.entries.set(tile.key, entry);
    return entry;
  }

  private clearTiles(): void {
    for (const { mesh } of this.entries.values()) this.disposeMesh(mesh);
    this.entries.clear();
  }

  private disposeMesh(mesh: Mesh<MeshGeometry, Shader>): void {
    const geometry = mesh.geometry;
    mesh.destroy();
    geometry.destroy(true);
  }
}
