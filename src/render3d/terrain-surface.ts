import { clamp, surfaceElevation } from '../world/coordinates.ts';
import type { TerrainTile } from '../world/streaming.ts';

export function terrainCell(tile: TerrainTile, x: number, y: number): { column: number; row: number } {
  return {
    column: clamp(Math.floor((x - tile.xs[0]) / tile.spacing), 0, tile.xs.length - 2),
    row: clamp(Math.floor((y - tile.ys[0]) / tile.spacing), 0, tile.ys.length - 2),
  };
}

/** Interpolate the signed DEM on the same NW–SE diagonal used by the meshes. */
export function sampleTerrainFacet(tile: TerrainTile, x: number, y: number) {
  const { xs, ys, elevations } = tile;
  const { column, row } = terrainCell(tile, x, y);
  const i = row * xs.length + column;
  const width = xs[column + 1] - xs[column];
  const depth = ys[row + 1] - ys[row];
  const u = (x - xs[column]) / width;
  const v = (y - ys[row]) / depth;
  const nw = elevations[i];
  const ne = elevations[i + 1];
  const sw = elevations[i + xs.length];
  const se = elevations[i + xs.length + 1];
  const riseX = u >= v ? ne - nw : se - sw;
  const riseY = u >= v ? se - ne : sw - nw;
  return { elevation: nw + riseX * u + riseY * v, slopeX: riseX / width, slopeY: riseY / depth };
}

export function rawHeightAt(tile: TerrainTile, x: number, y: number): number {
  return sampleTerrainFacet(tile, x, y).elevation;
}

export function displayHeightAt(tile: TerrainTile, x: number, y: number): number {
  return surfaceElevation(rawHeightAt(tile, x, y));
}
