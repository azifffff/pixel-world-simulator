/**
 * Hydrology is solved once on a regional grid in world coordinates. Render tiles
 * query the same channels and lakes at every LOD, including across tile seams.
 */
const GRID_SIZE = 225;
const MIN_DRAINAGE_CELLS = 6;
const MIN_LAKE_DEPTH = 38;
const DEPRESSION_LEVEL_TOLERANCE = 0.01;
const MAX_CHANNEL_VALLEY_FACTOR = 5;
const AGGREGATE_WIDTH_FACTOR = 0.13;

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
  [1, -1], [1, 1], [-1, 1], [-1, -1],
];

interface FlowPoint {
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
}

export interface RiverSegment {
  readonly from: FlowPoint;
  readonly to: FlowPoint;
  readonly halfWidth: number;
  readonly discharge: number;
}

export interface LakeNode extends FlowPoint {
  readonly depth: number;
}

export interface HydrologySample {
  readonly elevation: number;
  readonly water: 'none' | 'river' | 'lake';
  readonly waterLevel: number | null;
  readonly discharge: number;
}

interface Network {
  readonly segments: readonly RiverSegment[];
  readonly lakes: readonly LakeNode[];
  readonly riverBuckets: ReadonlyMap<number, readonly RiverSegment[]>;
  readonly lakeBuckets: ReadonlyMap<number, readonly LakeNode[]>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class AetherHydrology {
  private readonly step: number;
  private readonly side: number;
  private readonly groundAt: (x: number, y: number) => number;
  private readonly riverWidthMeters: number;
  private network?: Network;

  constructor(worldSize: number, elevationAt: (x: number, y: number) => number, riverWidthMeters: number) {
    this.side = worldSize;
    this.step = worldSize / (GRID_SIZE - 1);
    this.groundAt = elevationAt;
    this.riverWidthMeters = riverWidthMeters;
  }

  get segments(): readonly RiverSegment[] {
    return this.getNetwork().segments;
  }

  get lakes(): readonly LakeNode[] {
    return this.getNetwork().lakes;
  }

  sample(x: number, y: number, groundElevation: number, spacing = 0): HydrologySample {
    if (groundElevation <= 0 || x < 0 || x > this.side || y < 0 || y > this.side) {
      return { elevation: groundElevation, water: 'none', waterLevel: null, discharge: 0 };
    }

    const network = this.getNetwork();
    const bucket = this.bucket(x, y);
    const aggregateWidth = spacing <= this.step * 0.75
      ? Math.min(this.step * AGGREGATE_WIDTH_FACTOR, spacing * 0.68)
      : 0;
    let elevation = groundElevation;
    let nearestRiver = Infinity;
    let riverLevel: number | null = null;
    let discharge = 0;

    for (const { from, to, halfWidth, discharge: flow } of network.riverBuckets.get(bucket) ?? []) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const progress = clamp(((x - from.x) * dx + (y - from.y) * dy) / (dx * dx + dy * dy), 0, 1);
      const distanceSquared = (x - (from.x + dx * progress)) ** 2 + (y - (from.y + dy * progress)) ** 2;
      const valleyHalfWidth = halfWidth * MAX_CHANNEL_VALLEY_FACTOR;
      if (distanceSquared >= Math.max(valleyHalfWidth, aggregateWidth) ** 2) continue;
      const distance = Math.sqrt(distanceSquared);

      const waterLevel = from.elevation + (to.elevation - from.elevation) * progress;
      if (distance < valleyHalfWidth) {
        const bank = clamp((distance - halfWidth * 0.8) / (valleyHalfWidth - halfWidth * 0.8), 0, 1);
        const weight = 1 - bank * bank * (3 - 2 * bank);
        const channelDepth = Math.min(waterLevel, 3 + 5 * Math.log2(1 + flow / MIN_DRAINAGE_CELLS));
        const bed = waterLevel - channelDepth;
        elevation = Math.min(elevation, groundElevation + (bed - groundElevation) * weight);
      }

      const distanceToWidth = distance / Math.max(halfWidth, aggregateWidth);
      if (distanceToWidth <= 1 && distanceToWidth < nearestRiver) {
        nearestRiver = distanceToWidth;
        riverLevel = waterLevel;
        discharge = flow;
      }
    }

    // Lake water follows a single spill elevation and disappears where the
    // continuous ground field rises through it. The shoreline can be finer
    // than the regional grid used to identify the basin.
    const lakeRadiusSquared = (this.step * 0.9) ** 2;
    let lakeLevel: number | null = null;
    for (const lake of network.lakeBuckets.get(bucket) ?? []) {
      const distanceSquared = (x - lake.x) ** 2 + (y - lake.y) ** 2;
      if (distanceSquared <= lakeRadiusSquared && groundElevation <= lake.elevation - 0.5) {
        lakeLevel = lakeLevel === null ? lake.elevation : Math.max(lakeLevel, lake.elevation);
      }
    }

    if (lakeLevel !== null) return { elevation, water: 'lake', waterLevel: lakeLevel, discharge };
    return { elevation, water: riverLevel === null ? 'none' : 'river', waterLevel: riverLevel, discharge };
  }

  elevationAt(x: number, y: number, groundElevation: number): number {
    return this.sample(x, y, groundElevation).elevation;
  }

  private bucket(x: number, y: number): number {
    const column = clamp(Math.floor(x / this.step), 0, GRID_SIZE - 1);
    const row = clamp(Math.floor(y / this.step), 0, GRID_SIZE - 1);
    return row * GRID_SIZE + column;
  }

  private indexRegion<T>(
    buckets: Map<number, T[]>, item: T,
    minX: number, minY: number, maxX: number, maxY: number,
  ): void {
    const first = this.bucket(minX, minY);
    const last = this.bucket(maxX, maxY);
    for (let row = Math.floor(first / GRID_SIZE); row <= Math.floor(last / GRID_SIZE); row++) {
      for (let column = first % GRID_SIZE; column <= last % GRID_SIZE; column++) {
        const id = row * GRID_SIZE + column;
        const bucket = buckets.get(id);
        if (bucket) bucket.push(item);
        else buckets.set(id, [item]);
      }
    }
  }

  private gridPoint(index: number, elevation: number): FlowPoint {
    return {
      x: Math.min(this.side, (index % GRID_SIZE) * this.step),
      y: Math.min(this.side, Math.floor(index / GRID_SIZE) * this.step),
      elevation,
    };
  }

  private getNetwork(): Network {
    if (this.network) return this.network;

    const size = GRID_SIZE * GRID_SIZE;
    const ground = new Float32Array(size);
    for (let row = 0; row < GRID_SIZE; row++) {
      const y = Math.min(this.side, row * this.step);
      for (let column = 0; column < GRID_SIZE; column++) {
        const x = Math.min(this.side, column * this.step);
        ground[row * GRID_SIZE + column] = this.groundAt(x, y);
      }
    }

    const { filled, receiver, order } = priorityFlood(ground);
    const discharge = new Uint32Array(size);
    for (let i = order.length - 1; i >= 0; i--) {
      const node = order[i];
      discharge[node]++;
      const next = receiver[node];
      if (next >= 0 && ground[next] > 0) discharge[next] += discharge[node];
    }

    const segments: RiverSegment[] = [];
    const riverBuckets = new Map<number, RiverSegment[]>();
    if (this.riverWidthMeters > 0) {
      for (const node of order) {
        const downstream = receiver[node];
        const flow = discharge[node];
        if (downstream < 0 || flow < MIN_DRAINAGE_CELLS) continue;
        const head = this.gridPoint(node, filled[node]);
        const tail = this.gridPoint(downstream, Math.max(0, filled[downstream]));
        const halfWidth = Math.min(this.step * 0.08, this.riverWidthMeters * (flow / MIN_DRAINAGE_CELLS) ** 0.23);
        this.appendChannel(head, tail, halfWidth, flow, node, segments, riverBuckets);
      }
    }

    const lakes: LakeNode[] = [];
    const lakeBuckets = new Map<number, LakeNode[]>();
    for (const index of order) {
      const depth = filled[index] - ground[index];
      if (depth < MIN_LAKE_DEPTH || ground[index] <= 10) continue;
      const adjacentBasinFloor = neighbors(index).some((neighbor) =>
        filled[neighbor] - ground[neighbor] >= MIN_LAKE_DEPTH &&
        Math.abs(filled[neighbor] - filled[index]) <= DEPRESSION_LEVEL_TOLERANCE,
      );
      if (!adjacentBasinFloor && depth < 120) continue;
      const lake = { ...this.gridPoint(index, filled[index]), depth };
      lakes.push(lake);
      const radius = this.step * 0.9;
      this.indexRegion(lakeBuckets, lake, lake.x - radius, lake.y - radius, lake.x + radius, lake.y + radius);
    }

    this.network = { segments, lakes, riverBuckets, lakeBuckets };
    return this.network;
  }

  private appendChannel(
    head: FlowPoint, tail: FlowPoint, halfWidth: number, discharge: number, node: number,
    segments: RiverSegment[], buckets: Map<number, RiverSegment[]>,
  ): void {
    // Bend each interior link slightly. Adjacent links always share endpoints
    // and their flow levels agree at the confluence.
    const bend = ((Math.imul(node + 47, 0x9e3779b1) >>> 0) / 0x1_0000_0000 - 0.5) * 0.17;
    const midpoint = {
      x: clamp((head.x + tail.x) / 2 - (tail.y - head.y) * bend, 0, this.side),
      y: clamp((head.y + tail.y) / 2 + (tail.x - head.x) * bend, 0, this.side),
      elevation: (head.elevation + tail.elevation) / 2,
    };
    const points = tail.elevation === 0 ? [head, tail] : [head, midpoint, tail];
    for (let part = 1; part < points.length; part++) {
      const from = points[part - 1];
      const end = points[part];
      const mouth = this.findShore(from, end);
      const to = mouth ?? end;
      if (from.x !== to.x || from.y !== to.y) {
        const segment = { from, to, halfWidth, discharge };
        segments.push(segment);
        const margin = Math.max(halfWidth * MAX_CHANNEL_VALLEY_FACTOR, this.step * AGGREGATE_WIDTH_FACTOR);
        this.indexRegion(
          buckets, segment,
          Math.min(from.x, to.x) - margin, Math.min(from.y, to.y) - margin,
          Math.max(from.x, to.x) + margin, Math.max(from.y, to.y) + margin,
        );
      }
      if (mouth) break;
    }
  }

  private findShore(from: FlowPoint, to: FlowPoint): FlowPoint | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    let lastLand = 0;
    for (let i = 1; i <= 8; i++) {
      const progress = i / 8;
      if (this.groundAt(from.x + dx * progress, from.y + dy * progress) > 0) {
        lastLand = progress;
        continue;
      }
      let firstWater = progress;
      for (let step = 0; step < 16; step++) {
        const middle = (lastLand + firstWater) / 2;
        if (this.groundAt(from.x + dx * middle, from.y + dy * middle) > 0) lastLand = middle;
        else firstWater = middle;
      }
      return { x: from.x + dx * firstWater, y: from.y + dy * firstWater, elevation: 0 };
    }
    return null;
  }
}

function neighbors(index: number): number[] {
  const x = index % GRID_SIZE;
  const y = Math.floor(index / GRID_SIZE);
  const result: number[] = [];
  for (const [dx, dy] of NEIGHBORS) {
    const column = x + dx;
    const row = y + dy;
    if (column >= 0 && column < GRID_SIZE && row >= 0 && row < GRID_SIZE) {
      result.push(row * GRID_SIZE + column);
    }
  }
  return result;
}

/** Priority flood routes every inland grid node to a lower or equal spill level. */
function priorityFlood(ground: Float32Array) {
  const filled = ground.slice();
  const receiver = new Int32Array(ground.length).fill(-1);
  const visited = new Uint8Array(ground.length);
  const order: number[] = [];
  const queue = new ElevationQueue(filled);
  for (let node = 0; node < ground.length; node++) {
    if (ground[node] <= 0) {
      visited[node] = 1;
      continue;
    }
    const column = node % GRID_SIZE;
    const row = Math.floor(node / GRID_SIZE);
    const outlet = neighbors(node).find((neighbor) => ground[neighbor] <= 0);
    if (outlet !== undefined || column === 0 || row === 0 || column === GRID_SIZE - 1 || row === GRID_SIZE - 1) {
      visited[node] = 1;
      receiver[node] = outlet ?? -1;
      queue.push(node);
    }
  }

  while (queue.size > 0) {
    const node = queue.pop();
    order.push(node);
    for (const next of neighbors(node)) {
      if (visited[next]) continue;
      visited[next] = 1;
      filled[next] = Math.max(ground[next], filled[node]);
      receiver[next] = node;
      queue.push(next);
    }
  }

  return { filled, receiver, order };
}

class ElevationQueue {
  private readonly items: number[] = [];
  private readonly levels: Float32Array;

  constructor(levels: Float32Array) {
    this.levels = levels;
  }

  get size(): number {
    return this.items.length;
  }

  push(item: number): void {
    let slot = this.items.length;
    while (slot > 0) {
      const parent = (slot - 1) >>> 1;
      if (!this.before(item, this.items[parent])) break;
      this.items[slot] = this.items[parent];
      slot = parent;
    }
    this.items[slot] = item;
  }

  pop(): number {
    const head = this.items[0];
    const tail = this.items.pop()!;
    if (this.items.length === 0) return head;

    let slot = 0;
    while (slot * 2 + 1 < this.items.length) {
      let child = slot * 2 + 1;
      if (child + 1 < this.items.length && this.before(this.items[child + 1], this.items[child])) child++;
      if (!this.before(this.items[child], tail)) break;
      this.items[slot] = this.items[child];
      slot = child;
    }
    this.items[slot] = tail;
    return head;
  }

  private before(a: number, b: number): boolean {
    return this.levels[a] < this.levels[b] || (this.levels[a] === this.levels[b] && a < b);
  }
}
