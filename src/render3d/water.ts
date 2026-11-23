import {
  BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, type Scene,
} from 'three';
import { MATERIALS, materialForTerrain, NEUTRAL_SEA_MATERIAL, RIVER_MATERIAL } from '../terrain/aether-classification.ts';
import type { RiverSegment } from '../terrain/aether-hydrology.ts';
import { clamp, MAX_DISPLAY_ELEVATION, type Bounds } from '../world/coordinates.ts';
import { HEIGHT_SCALE, type RenderOrigin } from '../world/coordinates3d.ts';
import { WATER_KINDS, type TerrainTile } from '../world/streaming.ts';

const RIBBON_SPACING = 2_560;
const WATER_BUILD_BUDGET_MS = 2;
const MAX_WATER_BUILDS_PER_FRAME = 4;
const RIVER_COLOR = MATERIALS[RIVER_MATERIAL];
const LAKE_COLOR = MATERIALS[materialForTerrain('basin', 'freshwater', 'lake')];
const NEUTRAL_COLOR = MATERIALS[NEUTRAL_SEA_MATERIAL];

interface WaterVertex {
  x: number;
  y: number;
  ground: number;
  level: number;
}

interface Channel {
  readonly segment: RiverSegment;
  readonly length: number;
  readonly east: number;
  readonly south: number;
  readonly halfWidth: number;
  readonly extension: number;
  readonly bounds: Bounds;
}

interface Cell {
  readonly column: number;
  readonly row: number;
}

interface WaterPositions {
  readonly lakes: number[];
  readonly rivers: number[];
}

interface WaterOptions {
  readonly water: boolean;
  readonly colors: boolean;
}

function clipPolygon(vertices: readonly WaterVertex[], distance: (vertex: WaterVertex) => number): WaterVertex[] {
  if (vertices.length === 0) return [];
  const result: WaterVertex[] = [];
  let previous = vertices[vertices.length - 1];
  let previousDistance = distance(previous);
  for (const current of vertices) {
    const currentDistance = distance(current);
    if ((previousDistance < 0) !== (currentDistance < 0)) {
      const fraction = previousDistance / (previousDistance - currentDistance);
      result.push({
        x: previous.x + (current.x - previous.x) * fraction,
        y: previous.y + (current.y - previous.y) * fraction,
        ground: previous.ground + (current.ground - previous.ground) * fraction,
        level: previous.level + (current.level - previous.level) * fraction,
      });
    }
    if (currentDistance >= 0) result.push(current);
    previous = current;
    previousDistance = currentDistance;
  }
  return result;
}

function emitPolygon(output: number[], vertices: readonly WaterVertex[], tile: TerrainTile): void {
  for (let index = 1; index + 1 < vertices.length; index++) {
    const a = vertices[0];
    const b = vertices[index];
    const c = vertices[index + 1];
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (area <= 0) continue;
    // X/Z increase east/south, so reverse winding for an upward-facing water surface.
    for (const { x, y, level } of [a, c, b]) {
      output.push(x - tile.bounds.minX, level * HEIGHT_SCALE, y - tile.bounds.minY);
    }
  }
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function makeChannel(segment: RiverSegment, broad: boolean, tile: TerrainTile): Channel | null {
  const { from, to } = segment;
  const halfWidth = broad ? Math.max(segment.halfWidth, tile.spacing * 0.13) : segment.halfWidth;
  // Ribbons overlap slightly at bends and confluences. They share the exact
  // ground projection and opaque material, so the overlap is visually flat.
  const extension = broad ? halfWidth * 0.55 : 0;
  const margin = broad ? halfWidth + extension : halfWidth * 1.5;
  const bounds = {
    minX: Math.min(from.x, to.x) - margin,
    maxX: Math.max(from.x, to.x) + margin,
    minY: Math.min(from.y, to.y) - margin,
    maxY: Math.max(from.y, to.y) + margin,
  };
  if (!intersects(bounds, tile.bounds)) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length > 0 ? { segment, length, east: dx / length, south: dy / length, halfWidth, extension, bounds } : null;
}

function along(channel: Channel, x: number, y: number): number {
  return (x - channel.segment.from.x) * channel.east + (y - channel.segment.from.y) * channel.south;
}

function across(channel: Channel, vertex: WaterVertex): number {
  return (vertex.x - channel.segment.from.x) * channel.south - (vertex.y - channel.segment.from.y) * channel.east;
}

function channelLevel(channels: readonly Channel[], x: number, y: number): number {
  let distanceRatio = Infinity;
  let level = NaN;
  for (const channel of channels) {
    const { from, to, halfWidth } = channel.segment;
    const length = clamp(along(channel, x, y), 0, channel.length);
    const dx = x - from.x - channel.east * length;
    const dy = y - from.y - channel.south * length;
    const distance = (dx * dx + dy * dy) / (halfWidth * halfWidth);
    if (distance >= distanceRatio || distance > 2.25) continue;
    distanceRatio = distance;
    level = from.elevation + (to.elevation - from.elevation) * (length / channel.length);
  }
  return level;
}

function* cellsInBounds(tile: TerrainTile, bounds: Bounds): Iterable<Cell> {
  const { xs, ys, spacing } = tile;
  const firstX = clamp(Math.floor((bounds.minX - xs[0]) / spacing), 0, xs.length - 2);
  const lastX = clamp(Math.floor((bounds.maxX - xs[0]) / spacing), 0, xs.length - 2);
  const firstY = clamp(Math.floor((bounds.minY - ys[0]) / spacing), 0, ys.length - 2);
  const lastY = clamp(Math.floor((bounds.maxY - ys[0]) / spacing), 0, ys.length - 2);

  for (let row = firstY; row <= lastY; row++) {
    for (let column = firstX; column <= lastX; column++) yield { column, row };
  }
}

function cellTriangles(
  tile: TerrainTile, { column, row }: Cell, levelAt: (x: number, y: number, ground: number) => number,
): readonly [WaterVertex[], WaterVertex[]] {
  const { xs, ys, elevations } = tile;
  const vertex = (gridX: number, gridY: number): WaterVertex => {
    const x = xs[gridX];
    const y = ys[gridY];
    const ground = elevations[gridY * xs.length + gridX];
    return { x, y, ground, level: levelAt(x, y, ground) };
  };
  const nw = vertex(column, row);
  const ne = vertex(column + 1, row);
  const sw = vertex(column, row + 1);
  const se = vertex(column + 1, row + 1);
  return [[nw, ne, se], [nw, se, sw]];
}

function addRibbon(output: number[], tile: TerrainTile, channel: Channel): void {
  for (const cell of cellsInBounds(tile, channel.bounds)) {
    for (const triangle of cellTriangles(tile, cell, (_x, _y, ground) => Math.min(ground, MAX_DISPLAY_ELEVATION))) {
      let clipped = clipPolygon(triangle, (vertex) => along(channel, vertex.x, vertex.y) + channel.extension);
      clipped = clipPolygon(clipped, (vertex) => channel.length + channel.extension - along(channel, vertex.x, vertex.y));
      clipped = clipPolygon(clipped, (vertex) => channel.halfWidth - across(channel, vertex));
      clipped = clipPolygon(clipped, (vertex) => channel.halfWidth + across(channel, vertex));
      clipped = clipPolygon(clipped, (vertex) => vertex.ground);
      // An entirely submerged triangle belongs to the ocean surface.
      if (clipped.some(({ ground }) => ground > 0)) emitPolygon(output, clipped, tile);
    }
  }
}

export function buildWaterPositions(tile: TerrainTile, segments: readonly RiverSegment[]): WaterPositions {
  const { spacing, waterKinds, waterLevels, xs } = tile;
  const positions: WaterPositions = { lakes: [], rivers: [] };
  const broad = spacing >= RIBBON_SPACING;
  const minFlow = spacing >= 163_840 ? 70 : spacing >= 40_960 ? 18 : 6;
  const channels: Channel[] = [];
  if (broad || waterKinds?.includes(WATER_KINDS.river)) {
    for (const segment of segments) {
      if (broad && segment.discharge < minFlow) continue;
      const channel = makeChannel(segment, broad, tile);
      if (channel) channels.push(channel);
    }
  }

  if (broad) {
    for (const channel of channels) addRibbon(positions.rivers, tile, channel);
  }

  if (!waterKinds || !waterLevels) return positions;
  for (const cell of cellsInBounds(tile, tile.bounds)) {
    const index = cell.row * (xs.length - 1) + cell.column;
    const kind = waterKinds[index];
    const sampledLevel = waterLevels[index];
    if (!Number.isFinite(sampledLevel) || sampledLevel <= 0) continue;
    if (kind !== WATER_KINDS.lake && kind !== WATER_KINDS.river) continue;

    // A manually painted river may have no procedural channel or separate
    // water level. Draping it preserves the authored material on the ground.
    const painted = kind === WATER_KINDS.river &&
      Math.abs(sampledLevel - (tile.surfaceElevations?.[index] ?? NaN)) < 0.001;
    if (painted) {
      for (const triangle of cellTriangles(tile, cell, (_x, _y, ground) => Math.min(ground, MAX_DISPLAY_ELEVATION))) {
        const shore = clipPolygon(triangle, (vertex) => vertex.ground);
        if (shore.some(({ ground }) => ground > 0)) emitPolygon(positions.rivers, shore, tile);
      }
      continue;
    }
    if (broad && kind === WATER_KINDS.river) continue;

    const output = kind === WATER_KINDS.lake ? positions.lakes : positions.rivers;
    for (const triangle of cellTriangles(tile, cell, (x, y) => {
      const level = kind === WATER_KINDS.lake ? NaN : channelLevel(channels, x, y);
      return clamp(Number.isFinite(level) ? level : sampledLevel, 0, MAX_DISPLAY_ELEVATION);
    })) {
      let clipped = clipPolygon(triangle, (vertex) => vertex.level - vertex.ground);
      clipped = clipPolygon(clipped, (vertex) => vertex.ground);
      if (clipped.some(({ level, ground }) => level > ground)) emitPolygon(output, clipped, tile);
    }
  }
  return positions;
}

export class WaterRenderer3D {
  private readonly layer = new Group();
  private readonly river = new MeshBasicMaterial({ color: RIVER_COLOR, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  private readonly lake = new MeshBasicMaterial({ color: LAKE_COLOR, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  private readonly tiles = new Map<string, Group | null>();
  private segments?: readonly RiverSegment[];

  constructor(scene: Scene) {
    scene.add(this.layer);
  }

  get resourceCount(): number {
    let count = 0;
    for (const entry of this.tiles.values()) count += entry?.children.length ?? 0;
    return count;
  }

  render(
    tiles: readonly TerrainTile[], origin: RenderOrigin, segments: readonly RiverSegment[],
    _pixelsPerMeter: number, options: WaterOptions, pendingTiles: readonly TerrainTile[] = [],
  ): boolean {
    if (!options.water) {
      this.clear();
      return false;
    }
    if (segments !== this.segments) {
      this.clear();
      this.segments = segments;
    }
    this.river.color.setHex(options.colors ? RIVER_COLOR : NEUTRAL_COLOR);
    this.lake.color.setHex(options.colors ? LAKE_COLOR : NEUTRAL_COLOR);

    const active = new Set(tiles.map(({ key }) => key));
    const retained = new Set([...active, ...pendingTiles.map(({ key }) => key)]);
    for (const [key, mesh] of this.tiles) {
      if (retained.has(key)) continue;
      if (mesh) this.dispose(mesh);
      this.tiles.delete(key);
    }

    const deadline = performance.now() + WATER_BUILD_BUDGET_MS;
    let built = 0;
    for (const tile of [...tiles, ...pendingTiles]) {
      if (this.tiles.has(tile.key)) continue;
      if (built >= MAX_WATER_BUILDS_PER_FRAME || (built > 0 && performance.now() >= deadline)) break;
      this.tiles.set(tile.key, this.createTile(tile, segments));
      built++;
    }

    for (const tile of [...tiles, ...pendingTiles]) {
      const mesh = this.tiles.get(tile.key);
      if (!mesh) continue;
      mesh.position.set(tile.bounds.minX - origin.x, 0, tile.bounds.minY - origin.y);
      mesh.visible = active.has(tile.key);
    }

    return tiles.some(({ key }) => !this.tiles.has(key));
  }

  destroy(): void {
    this.clear();
    this.layer.removeFromParent();
    this.river.dispose();
    this.lake.dispose();
  }

  private createTile(tile: TerrainTile, segments: readonly RiverSegment[]): Group | null {
    const { rivers, lakes } = buildWaterPositions(tile, segments);
    if (!rivers.length && !lakes.length) return null;
    const group = new Group();
    for (const [positions, material] of [[rivers, this.river], [lakes, this.lake]] as const) {
      if (!positions.length) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      group.add(new Mesh(geometry, material));
    }
    this.layer.add(group);
    return group;
  }

  private clear(): void {
    for (const mesh of this.tiles.values()) {
      if (mesh) this.dispose(mesh);
    }
    this.tiles.clear();
  }

  private dispose(group: Group): void {
    for (const mesh of group.children) {
      if (mesh instanceof Mesh) mesh.geometry.dispose();
    }
    group.removeFromParent();
  }
}
