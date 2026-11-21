import { MAX_DISPLAY_ELEVATION } from '../world/coordinates.ts';

export const TREE_GRID_METERS = 19;
const TREE_MIN_HEIGHT_METERS = 16;
const TREE_MAX_HEIGHT_METERS = 23;
const MAX_TREE_GROUND_GRADE = 0.7;
const CLIFF_GRADE = Math.tan(55 * Math.PI / 180);
const MIN_CLIFF_RISE_METERS = 8;

export interface TreeRoot {
  readonly x: number;
  readonly y: number;
  readonly canopy: number;
  readonly trunk: number;
  readonly height: number;
}

export function pixelNoise(x: number, y: number): number {
  let bits = Math.imul(x, 0x2c1b3c6d) ^ Math.imul(y, 0x297a2d39);
  bits = Math.imul(bits ^ (bits >>> 15), 0x2c1b3c6d);
  return ((bits ^ (bits >>> 16)) >>> 0) / 0x1_0000_0000;
}

/** A seed-independent local placement grid, masked by the sampled forest. All dimensions are metres. */
export function treeRoot(column: number, row: number): TreeRoot {
  return {
    x: (column + 0.22 + pixelNoise(column + 889, row) * 0.56) * TREE_GRID_METERS,
    y: (row + 0.22 + pixelNoise(column, row - 431) * 0.56) * TREE_GRID_METERS,
    canopy: 6 + 2 * pixelNoise(column + 139, row + 89),
    trunk: 0.75 + 0.45 * pixelNoise(column - 121, row + 157),
    height: TREE_MIN_HEIGHT_METERS + (TREE_MAX_HEIGHT_METERS - TREE_MIN_HEIGHT_METERS) *
      pixelNoise(column + 817, row + 241),
  };
}

export function rootedTreeElevation(
  u: number, v: number, nw: number, ne: number, sw: number, se: number, width: number, depth: number,
): number | null {
  // Same NW–SE diagonal as the terrain and cursor picking.
  const riseX = u >= v ? ne - nw : se - sw;
  const riseY = u >= v ? se - ne : sw - nw;
  if (Math.hypot(riseX / width, riseY / depth) > MAX_TREE_GROUND_GRADE) return null;
  const elevation = nw + riseX * u + riseY * v;
  return elevation > 0 ? elevation : null;
}

export function terrainFacet(top: number, middle: number, bottom: number, riseX: number, riseY: number, spacing: number) {
  const grade = Math.hypot(riseX, riseY);
  const cliff = grade >= CLIFF_GRADE &&
    Math.max(top, middle, bottom) - Math.min(top, middle, bottom) >= MIN_CLIFF_RISE_METERS;
  const lightDot = (riseX * 0.55 + riseY * 0.32 + 0.77) / Math.hypot(grade, 1);
  // Preserve the readable continental relief at coarse LOD, without flattening
  // the face-to-face light response on the true geometry at local scales.
  const directional = Math.tanh((riseX * 0.81 + riseY * 0.59) * (1.5 + Math.sqrt(spacing) * 0.55));
  const light = cliff ? 0.71 + Math.max(0, lightDot) * 0.37
    : 1 + (Math.max(0, lightDot) - 0.77) * 0.23 + directional * 0.23;
  return { cliff, light };
}

/** For a particular projected pixel, higher geometry is nearer along the isometric ray. */
export function terrainDepth(elevation: number): number {
  const limit = MAX_DISPLAY_ELEVATION + TREE_MAX_HEIGHT_METERS + 2;
  return 1 - (elevation + 1) / limit;
}
