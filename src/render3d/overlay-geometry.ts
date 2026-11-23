import {
  CHUNK_SIZE_METERS, MAX_DISPLAY_ELEVATION, clamp, type Bounds, type Point,
} from '../world/coordinates.ts';
import type { TerrainTile } from '../world/streaming.ts';
import { rawHeightAt, terrainCell } from './terrain-surface.ts';

interface Vertex extends Point {
  elevation: number;
}

export type DrawSegment = (a: Vertex, b: Vertex) => boolean;
const PARAMETER_EPSILON = 1e-9;

function pointAt(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Clip in double-precision world coordinates before rebasing output positions. */
export function clipLine(from: Point, to: Point, bounds: Bounds): [Point, Point] | null {
  let start = 0;
  let end = 1;
  for (const axis of ['x', 'y'] as const) {
    const min = axis === 'x' ? bounds.minX : bounds.minY;
    const max = axis === 'x' ? bounds.maxX : bounds.maxY;
    const delta = to[axis] - from[axis];
    if (delta === 0) {
      if (from[axis] < min || from[axis] > max) return null;
    } else {
      const a = (min - from[axis]) / delta;
      const b = (max - from[axis]) / delta;
      start = Math.max(start, Math.min(a, b));
      end = Math.min(end, Math.max(a, b));
    }
  }
  if (end - start <= PARAMETER_EPSILON) return null;
  const clipped = (t: number): Point => {
    const { x, y } = pointAt(from, to, t);
    return {
      x: clamp(x, bounds.minX, bounds.maxX),
      y: clamp(y, bounds.minY, bounds.maxY),
    };
  };
  return [clipped(start), clipped(end)];
}

export function surfaceSegment(a: Vertex, b: Vertex, draw: DrawSegment): boolean {
  if (a.elevation >= 0 && a.elevation <= MAX_DISPLAY_ELEVATION &&
    b.elevation >= 0 && b.elevation <= MAX_DISPLAY_ELEVATION) return draw(a, b);

  // The sea surface replaces the submerged part of a triangle at its signed crossing.
  const crossings = [0, MAX_DISPLAY_ELEVATION]
    .map((elevation) => ({ elevation, t: (elevation - a.elevation) / (b.elevation - a.elevation) }))
    .filter(({ t }) => t > 0 && t < 1)
    .sort((left, right) => left.t - right.t);
  let previous = { ...a, elevation: clamp(a.elevation, 0, MAX_DISPLAY_ELEVATION) };
  for (const { elevation, t } of crossings) {
    const next = { ...pointAt(a, b, t), elevation };
    if (!draw(previous, next)) return false;
    previous = next;
  }
  return draw(previous, { ...b, elevation: clamp(b.elevation, 0, MAX_DISPLAY_ELEVATION) });
}

/** A clipped line follows the tile's NW–SE triangles exactly, even through a steep crease. */
export function drapeTileLine(tile: TerrainTile, from: Point, to: Point, draw: DrawSegment): boolean {
  const { xs, ys } = tile;
  const cuts = [0, 1];
  for (const [axis, start, end] of [[xs, from.x, to.x], [ys, from.y, to.y]] as const) {
    if (start === end) continue;
    for (let i = 1; i < axis.length - 1; i++) {
      const t = (axis[i] - start) / (end - start);
      if (t > PARAMETER_EPSILON && t < 1 - PARAMETER_EPSILON) cuts.push(t);
    }
  }
  cuts.sort((a, b) => a - b);

  let previousT = 0;
  let previousPoint = { ...from, elevation: rawHeightAt(tile, from.x, from.y) };
  for (const t of cuts.slice(1)) {
    if (t - previousT <= PARAMETER_EPSILON) continue;
    const mid = pointAt(from, to, (previousT + t) / 2);
    const { column, row } = terrainCell(tile, mid.x, mid.y);
    const width = xs[column + 1] - xs[column];
    const depth = ys[row + 1] - ys[row];
    const fromDiagonal = (previousPoint.x - xs[column]) / width - (previousPoint.y - ys[row]) / depth;
    const end = pointAt(from, to, t);
    const toDiagonal = (end.x - xs[column]) / width - (end.y - ys[row]) / depth;
    if (fromDiagonal * toDiagonal < -(PARAMETER_EPSILON ** 2)) {
      const crossing = pointAt(previousPoint, end, fromDiagonal / (fromDiagonal - toDiagonal));
      const onDiagonal = { ...crossing, elevation: rawHeightAt(tile, crossing.x, crossing.y) };
      if (!surfaceSegment(previousPoint, onDiagonal, draw)) return false;
      previousPoint = onDiagonal;
    }
    const next = { ...end, elevation: rawHeightAt(tile, end.x, end.y) };
    if (!surfaceSegment(previousPoint, next, draw)) return false;
    previousPoint = next;
    previousT = t;
  }
  return true;
}

function chunkAxes(axis: Float64Array, worldSize: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < axis.length - 1; i++) {
    if (axis[i] % CHUNK_SIZE_METERS === 0) result.push(i);
  }
  // Neighboring tiles own shared edges through their first vertex. This tile owns the world edge.
  if (axis[axis.length - 1] === worldSize) result.push(axis.length - 1);
  return result;
}

export function drawChunkLines(
  tiles: readonly TerrainTile[], worldSize: number, draw: DrawSegment, maxSegments: number,
): boolean {
  const boundaries = tiles.filter(({ spacing }) => spacing <= CHUNK_SIZE_METERS)
    .map((tile) => ({ tile, columns: chunkAxes(tile.xs, worldSize), rows: chunkAxes(tile.ys, worldSize) }));
  const estimate = boundaries.reduce((sum, { tile, columns, rows }) =>
    sum + columns.length * (tile.ys.length - 1) + rows.length * (tile.xs.length - 1), 0);
  if (estimate > maxSegments) return false;

  for (const { tile: { xs, ys, elevations }, columns, rows } of boundaries) {
    const vertex = (column: number, row: number): Vertex => ({
      x: xs[column], y: ys[row], elevation: elevations[row * xs.length + column],
    });
    for (const column of columns) {
      let from = vertex(column, 0);
      for (let row = 1; row < ys.length; row++) {
        const to = vertex(column, row);
        if (!surfaceSegment(from, to, draw)) return false;
        from = to;
      }
    }
    for (const row of rows) {
      let from = vertex(0, row);
      for (let column = 1; column < xs.length; column++) {
        const to = vertex(column, row);
        if (!surfaceSegment(from, to, draw)) return false;
        from = to;
      }
    }
  }
  return true;
}

function interpolateLevel(from: Vertex, to: Vertex, elevation: number): Point {
  return pointAt(from, to, (elevation - from.elevation) / (to.elevation - from.elevation));
}

function appendContours(
  result: number[], a: Vertex, b: Vertex, c: Vertex, interval: number, limit: number,
): boolean {
  const minimum = Math.min(a.elevation, b.elevation, c.elevation);
  const maximum = Math.min(MAX_DISPLAY_ELEVATION, Math.max(a.elevation, b.elevation, c.elevation));
  const first = Math.max(interval, (Math.floor(minimum / interval) + 1) * interval);
  for (let elevation = first; elevation <= maximum; elevation += interval) {
    const aAbove = a.elevation >= elevation;
    const bAbove = b.elevation >= elevation;
    const cAbove = c.elevation >= elevation;
    // Find the lone vertex on one side of the level and trace its two crossings.
    const [vertex, edgeA, edgeB] = bAbove === cAbove ? [a, b, c]
      : aAbove === cAbove ? [b, a, c] : [c, a, b];
    const from = interpolateLevel(vertex, edgeA, elevation);
    const to = interpolateLevel(vertex, edgeB, elevation);
    if (from.x === to.x && from.y === to.y) continue;
    if (result.length >= limit * 5) return false;
    result.push(from.x, from.y, to.x, to.y, elevation);
  }
  return true;
}

/** Each record stores two tile-local horizontal endpoints and their shared elevation. */
export function buildTileContours(tile: TerrainTile, interval: number, limit: number): Float32Array | null {
  const { xs, ys, elevations, bounds } = tile;
  const segments: number[] = [];
  const vertex = (column: number, row: number, elevation: number): Vertex => ({
    x: xs[column] - bounds.minX,
    y: ys[row] - bounds.minY,
    elevation,
  });
  for (let row = 0; row + 1 < ys.length; row++) {
    for (let column = 0; column + 1 < xs.length; column++) {
      const index = row * xs.length + column;
      const heights = [elevations[index], elevations[index + 1],
        elevations[index + xs.length], elevations[index + xs.length + 1]];
      const minimum = Math.max(0, Math.min(...heights));
      const maximum = Math.min(MAX_DISPLAY_ELEVATION, Math.max(...heights));
      if (Math.floor(minimum / interval) >= Math.floor(maximum / interval)) continue;
      const nw = vertex(column, row, heights[0]);
      const ne = vertex(column + 1, row, heights[1]);
      const sw = vertex(column, row + 1, heights[2]);
      const se = vertex(column + 1, row + 1, heights[3]);
      if (!appendContours(segments, nw, ne, se, interval, limit) ||
        !appendContours(segments, nw, se, sw, interval, limit)) return null;
    }
  }
  return Float32Array.from(segments);
}

export function contourInterval(spacing: number): number {
  if (spacing >= 40_960) return 1_000;
  if (spacing >= 5_120) return 500;
  if (spacing >= 320) return 200;
  if (spacing >= 40) return 50;
  return 10;
}
