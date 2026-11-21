import { BIOMES, type Biome, type TerrainSample } from './generator.ts';
import { materialForBiome, materialForTerrain, SURFACE_LABELS, type SurfaceMaterial } from './aether-classification.ts';
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
  readonly surface?: SurfaceMaterial;
  readonly blendMeters?: number;
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
  const { id, minX, minY, maxX, maxY, elevation, biome, surface, blendMeters } = value as Partial<TerrainPatch>;
  if (typeof id !== 'string' || !id.trim() || id.length > 128 ||
      !inRange(minX, 0, worldSize) || !inRange(minY, 0, worldSize) ||
      !inRange(maxX, minX, worldSize) || !inRange(maxY, minY, worldSize) ||
      (elevation === undefined && biome === undefined && surface === undefined) ||
      (elevation !== undefined && !inRange(elevation, MIN_ELEVATION, MAX_ELEVATION)) ||
      (biome !== undefined && !BIOMES.includes(biome)) ||
      (surface !== undefined && (typeof surface !== 'string' || !Object.hasOwn(SURFACE_LABELS, surface))) ||
      (blendMeters !== undefined && (elevation === undefined || !inRange(blendMeters, 0, Math.min(maxX - minX, maxY - minY) / 2)))) {
    throw new Error('Invalid terrain patch');
  }
  return { id, minX, minY, maxX, maxY, elevation, biome, surface, blendMeters };
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

function findOverride<K extends 'biome' | 'surface'>(
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

  apply(x: number, y: number, source: TerrainSample, elevationAlreadyApplied = false): TerrainSample {
    const elevation = elevationAlreadyApplied ? undefined : this.elevationOverrideAt(x, y, () => source.elevation);
    if (elevation !== undefined) source = { ...source, elevation };
    const biome = this.override('biome', x, y);
    const surface = this.override('surface', x, y);
    if (surface === undefined && biome === undefined) return source;
    const water = biome === 'ocean' ? 'ocean' : biome === 'river' ? 'river' : source.water;
    const material = surface !== undefined
      ? materialForTerrain(source.landform, surface, water)
      : biome === undefined ? source.material : materialForBiome(biome);
    const dryMaterial = surface !== undefined
      ? materialForTerrain(source.landform, surface, water === 'ocean' ? 'ocean' : 'none')
      : water === 'none' || water === 'ocean' ? material : source.dryMaterial;
    const waterLevel = water === 'ocean' ? 0 : water === 'river' ? source.waterLevel ?? source.elevation : source.waterLevel;
    return { ...source, biome: biome ?? source.biome, surface: surface ?? source.surface, water, waterLevel, material, dryMaterial };
  }

  elevationOverrideAt(x: number, y: number, base: () => number): number | undefined {
    if (this.edits.authored.length === 0 && this.edits.patches.length === 0) return undefined;
    let elevation: number | undefined;
    for (const layer of [this.edits.authored, this.edits.patches]) {
      for (const patch of layer) {
        if (patch.elevation === undefined || !covers(patch, x, y)) continue;
        const edge = Math.min(x - patch.minX, patch.maxX - x, y - patch.minY, patch.maxY - y);
        if (!patch.blendMeters || edge >= patch.blendMeters) {
          elevation = patch.elevation;
        } else if (edge > 0) {
          const t = edge / patch.blendMeters;
          const below = elevation ?? base();
          elevation = below + (patch.elevation - below) * t * t * (3 - 2 * t);
        }
      }
    }
    return elevation;
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

  private override<K extends 'biome' | 'surface'>(field: K, x: number, y: number) {
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
