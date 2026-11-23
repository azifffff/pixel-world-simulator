import { BufferGeometry, Float32BufferAttribute } from 'three';
import {
  BATHYMETRY_MATERIALS, MATERIALS, NEUTRAL_LAND_MATERIAL, NEUTRAL_SEA_MATERIAL, RIVER_MATERIAL,
  isBathymetryMaterial, isWaterMaterial, materialForBiome, materialForTerrain,
} from '../terrain/aether-classification.ts';
import { pixelNoise, terrainFacet } from '../render/terrain-detail.ts';
import { clamp, MAX_DISPLAY_ELEVATION } from '../world/coordinates.ts';
import { HEIGHT_SCALE } from '../world/coordinates3d.ts';
import { BIOMES, type TerrainTile } from '../world/streaming.ts';

export interface TerrainRenderOptions {
  readonly colors: boolean;
  readonly shading: boolean;
  readonly water: boolean;
  readonly classification: boolean;
}

const ROCK = 0x847769;
const COAST = MATERIALS[materialForTerrain('coastal-plain', 'grassland', 'none')];
const LAKE_MATERIAL = materialForTerrain('basin', 'freshwater', 'lake');
const DEPTH_RAMP = [
  [0, BATHYMETRY_MATERIALS.shallow],
  [620, BATHYMETRY_MATERIALS.shelf],
  [3_950, BATHYMETRY_MATERIALS.deep],
  [7_000, BATHYMETRY_MATERIALS.trench],
] as const;

const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, index) => {
  const s = index / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
});

interface LocalVertex {
  readonly x: number;
  readonly z: number;
  readonly h: number;
}

function channelColor(channel: number, light: number): number {
  return SRGB_TO_LINEAR[clamp(Math.round(channel * light), 0, 255)];
}

function litColor(color: number, light: number): [number, number, number] {
  return [
    channelColor((color >>> 16) & 255, light),
    channelColor((color >>> 8) & 255, light),
    channelColor(color & 255, light),
  ];
}

function localSunlight(xGrade: number, zGrade: number): number {
  // A face with Y = xGrade * X + zGrade * Z has an upward normal (-xGrade, 1, -zGrade).
  const nx = -xGrade * HEIGHT_SCALE;
  const nz = -zGrade * HEIGHT_SCALE;
  const sun = (nx * 0.56 + 0.74 - nz * 0.37) / Math.hypot(nx, 1, nz);
  return 0.55 + 0.61 * Math.max(0, sun);
}

function bathymetry(elevation: number): number {
  const depth = Math.round(clamp(-elevation, 0, 7_000) * 95 / 7_000) * 7_000 / 95;
  for (let i = 1; i < DEPTH_RAMP.length; i++) {
    const [end, to] = DEPTH_RAMP[i];
    if (depth > end) continue;
    const [start, from] = DEPTH_RAMP[i - 1];
    const f = (depth - start) / (end - start);
    const one = MATERIALS[from];
    const two = MATERIALS[to];
    let color = 0;
    for (const bit of [16, 8, 0]) {
      const a = (one >>> bit) & 255;
      const b = (two >>> bit) & 255;
      color |= Math.round(a + (b - a) * f) << bit;
    }
    return color;
  }
  return MATERIALS[BATHYMETRY_MATERIALS.trench];
}

function seaCrossing(a: LocalVertex, b: LocalVertex): LocalVertex {
  // Always compute from the submerged endpoint so a shared edge has one intersection.
  const low = a.h < b.h ? a : b;
  const high = low === a ? b : a;
  const f = -low.h / (high.h - low.h);
  return { x: low.x + (high.x - low.x) * f, z: low.z + (high.z - low.z) * f, h: 0 };
}

function clipSea(triangle: readonly LocalVertex[], land: boolean): LocalVertex[] {
  const polygon: LocalVertex[] = [];
  let previous = triangle[triangle.length - 1];
  for (const current of triangle) {
    if (previous.h * current.h < 0) polygon.push(seaCrossing(previous, current));
    if (land ? current.h >= 0 : current.h <= 0) polygon.push(current);
    previous = current;
  }
  return polygon;
}

/**
 * Keep the DEM's original land planes and split any mixed-sign triangle at
 * sea level. Submerged polygons share the same coastline but lie flat at y=0.
 */
export function buildTerrainGeometry(tile: TerrainTile, options: TerrainRenderOptions): BufferGeometry {
  const { xs, ys, elevations, biomes, surfaceElevations, materials, dryMaterials, spacing } = tile;
  const columns = xs.length - 1;
  const rows = ys.length - 1;
  const vertices: LocalVertex[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      vertices.push({
        x: xs[column] - xs[0], z: ys[row] - ys[0],
        h: Math.min(MAX_DISPLAY_ELEVATION, elevations[row * xs.length + column]),
      });
    }
  }

  // A sea clip splits a triangle into at most three output triangles.
  const positions = new Float32Array(rows * columns * 54);
  const colors = new Float32Array(positions.length);
  let cursor = 0;
  const strength = options.shading ? options.classification ? 0.1 : 1 : 0;

  function write(vertex: LocalVertex, color: readonly number[], land: boolean): void {
    positions[cursor] = vertex.x;
    positions[cursor + 1] = land ? vertex.h * HEIGHT_SCALE : 0;
    positions[cursor + 2] = vertex.z;
    colors.set(color, cursor);
    cursor += 3;
  }

  function triangulate(polygon: readonly LocalVertex[], color: readonly number[], land: boolean): void {
    for (let i = 1; i + 1 < polygon.length; i++) {
      write(polygon[0], color, land);
      write(polygon[i], color, land);
      write(polygon[i + 1], color, land);
    }
  }

  function drawFacet(
    a: LocalVertex, b: LocalVertex, c: LocalVertex, material: number, seaMaterial: number,
    grain: number, faceHeight: number, xGrade: number, zGrade: number,
  ): void {
    const facet = [a, b, c];
    const low = Math.min(a.h, b.h, c.h);
    const high = Math.max(a.h, b.h, c.h);
    if (high > 0) {
      const relief = terrainFacet(a.h, b.h, c.h, xGrade, zGrade, spacing);
      const rock = options.colors && !options.classification && relief.cliff;
      const neutral = MATERIALS[NEUTRAL_LAND_MATERIAL];
      const base = options.colors ? rock ? ROCK : isWaterMaterial(material) ? COAST : MATERIALS[material] : neutral;
      const light = tile.lod >= 3 ? localSunlight(xGrade, zGrade) : relief.light;
      const color = litColor(base, 1 + strength * (light - 1) + grain);
      triangulate(low >= 0 ? facet : clipSea(facet, true), color, true);
    }
    if (low < 0 || high <= 0) {
      const depth = faceHeight < 0 ? faceHeight : low / 2;
      const base = !options.colors ? MATERIALS[NEUTRAL_SEA_MATERIAL]
        : options.classification || !isBathymetryMaterial(seaMaterial)
          ? MATERIALS[seaMaterial] : bathymetry(depth);
      const light = 1 + grain - strength * Math.min(1, Math.max(0, -depth / 6_500)) * 0.16;
      triangulate(high <= 0 ? facet : clipSea(facet, false), litColor(base, light), false);
    }
  }

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const face = row * columns + column;
      const index = row * xs.length + column;
      const nw = vertices[index];
      const ne = vertices[index + 1];
      const sw = vertices[index + xs.length];
      const se = vertices[index + xs.length + 1];
      const sampled = materials?.[face] ?? materialForBiome(BIOMES[biomes[face]] ?? 'plains');
      const inland = sampled === RIVER_MATERIAL || sampled === LAKE_MATERIAL;
      const landMaterial = inland ? dryMaterials?.[face] ?? sampled : sampled;
      const seaMaterial = isWaterMaterial(sampled) && !inland ? sampled : BATHYMETRY_MATERIALS.shallow;
      const grain = (pixelNoise(Math.floor(xs[column] / spacing), Math.floor(ys[row] / spacing)) - 0.5) *
        strength * (tile.lod >= 3 ? 0.075 : 0.027);
      const width = ne.x - nw.x;
      const depth = sw.z - nw.z;
      const height = surfaceElevations[face];

      // The winding points skyward in Three.js (+Y up, +Z south).
      drawFacet(nw, se, ne, landMaterial, seaMaterial, grain, height,
        (ne.h - nw.h) / width, (se.h - ne.h) / depth);
      drawFacet(nw, sw, se, landMaterial, seaMaterial, grain, height,
        (se.h - sw.h) / width, (sw.h - nw.h) / depth);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions.slice(0, cursor), 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors.slice(0, cursor), 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
