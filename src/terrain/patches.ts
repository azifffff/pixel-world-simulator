import { BIOMES, type Biome, type TerrainSample } from './generator.ts';
import { MAX_ELEVATION, MIN_ELEVATION, terrainStorageKey,
  type WorldMetadata, type WorldStorage } from './metadata.ts';

export interface TerrainPatch {
  readonly id: string;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly elevation?: number;
  readonly biome?: Biome;
}

const PATCH_SCHEMA_VERSION = 1;
type TerrainLayer = 'authored' | 'patches';

interface TerrainEdits {
  readonly schemaVersion: number;
  readonly worldKey: string;
  readonly authored: readonly TerrainPatch[];
  readonly patches: readonly TerrainPatch[];
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validatePatch(value: unknown, worldSize: number): TerrainPatch {
  if (!value || typeof value !== 'object') throw new Error('Invalid terrain patch');
  const { id, minX, minY, maxX, maxY, elevation, biome } = value as Partial<TerrainPatch>;
  if (typeof id !== 'string' || !id.trim() || id.length > 128 ||
      !inRange(minX, 0, worldSize) || !inRange(minY, 0, worldSize) ||
      !inRange(maxX, minX, worldSize) || !inRange(maxY, minY, worldSize) ||
      (elevation === undefined && biome === undefined) ||
      (elevation !== undefined && !inRange(elevation, MIN_ELEVATION, MAX_ELEVATION)) ||
      (biome !== undefined && !BIOMES.includes(biome))) {
    throw new Error('Invalid terrain patch');
  }
  return { id, minX, minY, maxX, maxY, elevation, biome };
}

function validateLayer(value: unknown, worldSize: number): TerrainPatch[] {
  if (!Array.isArray(value)) throw new Error('Invalid saved terrain edits');
  const patches = value.map((patch: unknown) => validatePatch(patch, worldSize));
  if (new Set(patches.map((patch) => patch.id)).size !== patches.length) {
    throw new Error('Duplicate saved terrain patch ID');
  }
  return patches;
}

function covers(patch: TerrainPatch, x: number, y: number): boolean {
  return x >= patch.minX && x <= patch.maxX && y >= patch.minY && y <= patch.maxY;
}

function findOverride<K extends 'elevation' | 'biome'>(
  patches: readonly TerrainPatch[], field: K, x: number, y: number,
): TerrainPatch[K] | undefined {
  for (let i = patches.length - 1; i >= 0; i--) {
    const value = patches[i][field];
    if (value !== undefined && covers(patches[i], x, y)) return value;
  }
  return undefined;
}

export class TerrainPatchManager {
  private readonly worldSize: number;
  private readonly storage?: WorldStorage;
  private readonly worldKey: string;
  private edits: TerrainEdits;
  private changeCount = 0;

  constructor(metadata: WorldMetadata, storage?: WorldStorage) {
    this.worldSize = metadata.worldSizeMeters;
    this.storage = storage;
    this.worldKey = terrainStorageKey(metadata);
    this.edits = this.read() ?? {
      schemaVersion: PATCH_SCHEMA_VERSION, worldKey: this.worldKey, authored: [], patches: [],
    };
  }

  get revision(): number {
    return this.changeCount;
  }

  apply(x: number, y: number, source: TerrainSample): TerrainSample {
    const elevation = this.override('elevation', x, y);
    const biome = this.override('biome', x, y);
    if (elevation === undefined && biome === undefined) return source;
    return {
      elevation: elevation ?? source.elevation,
      biome: biome ?? source.biome,
      moisture: source.moisture,
    };
  }

  elevationOverrideAt(x: number, y: number): number | undefined {
    return this.override('elevation', x, y);
  }

  set(layer: TerrainLayer, patch: TerrainPatch): void {
    const validated = validatePatch(patch, this.worldSize);
    const current = this.read() ?? this.edits;
    this.write({
      ...current,
      [layer]: [...current[layer].filter((existing) => existing.id !== validated.id), validated],
    });
  }

  remove(layer: TerrainLayer, id: string): boolean {
    const current = this.read() ?? this.edits;
    const remaining = current[layer].filter((patch) => patch.id !== id);
    if (remaining.length === current[layer].length) return false;
    this.write({ ...current, [layer]: remaining });
    return true;
  }

  private override<K extends 'elevation' | 'biome'>(field: K, x: number, y: number) {
    return findOverride(this.edits.patches, field, x, y) ??
      findOverride(this.edits.authored, field, x, y);
  }

  private read(): TerrainEdits | undefined {
    const stored = this.storage?.getItem(this.worldKey);
    if (stored == null) return undefined;
    const data: unknown = JSON.parse(stored);
    if (!data || typeof data !== 'object') throw new Error('Invalid saved terrain edits');
    const { schemaVersion, worldKey, authored, patches } = data as Partial<TerrainEdits>;
    if (schemaVersion !== PATCH_SCHEMA_VERSION || worldKey !== this.worldKey) {
      throw new Error('Saved terrain edits do not match this world configuration');
    }
    return {
      schemaVersion,
      worldKey,
      authored: validateLayer(authored, this.worldSize),
      patches: validateLayer(patches, this.worldSize),
    };
  }

  private write(edits: TerrainEdits): void {
    this.storage?.setItem(this.worldKey, JSON.stringify(edits));
    this.edits = edits;
    this.changeCount++;
  }
}
