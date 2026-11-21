import { MAX_DISPLAY_ELEVATION, WORLD_SIDE_METERS } from '../world/coordinates.ts';
import { validateAetherConfig, type AetherConfig } from './aether-config.ts';

export const GENERATOR_VERSION = 2;
export const DEFAULT_SEED = 'aetheria';
export const WORLD_METADATA_KEY = 'pixel-world:metadata';
const LEGACY_METADATA_KEY = 'pixel-world:metadata:v1';
export const MIN_ELEVATION = -7_000;
export const MAX_ELEVATION = MAX_DISPLAY_ELEVATION;

export interface TerrainParameters {
  readonly seaLevel: number;
  readonly reliefMultiplier: number;
  readonly riverWidthMeters: number;
}

export interface WorldMetadata {
  readonly seed: string;
  readonly generatorVersion: number;
  readonly worldSizeMeters: number;
  readonly terrain: TerrainParameters;
  readonly layout?: AetherConfig;
}

export type WorldStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DEFAULT_PARAMETERS: TerrainParameters = Object.freeze({
  seaLevel: 0.49,
  reliefMultiplier: 1,
  riverWidthMeters: 1_200,
});

export function createWorldMetadata(seed = DEFAULT_SEED): WorldMetadata {
  return validateWorldMetadata({
    seed: seed.trim() || DEFAULT_SEED,
    generatorVersion: GENERATOR_VERSION,
    worldSizeMeters: WORLD_SIDE_METERS,
    terrain: DEFAULT_PARAMETERS,
  });
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function validateWorldMetadata(value: unknown): WorldMetadata {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid world metadata');
  }
  const { seed, generatorVersion, worldSizeMeters, terrain, layout } = value as Partial<WorldMetadata>;
  if (generatorVersion !== GENERATOR_VERSION) {
    throw new Error(`Unsupported terrain generator version: ${String(generatorVersion)}`);
  }
  if (typeof seed !== 'string' || !seed.trim() || seed.length > 128 ||
      !inRange(worldSizeMeters, 1, Number.MAX_SAFE_INTEGER) || !terrain ||
      !inRange(terrain.seaLevel, 0.25, 0.75) ||
      !inRange(terrain.reliefMultiplier, 0.25, 2) ||
      !inRange(terrain.riverWidthMeters, 0, 5_000)) {
    throw new Error('Invalid terrain generator configuration');
  }
  return Object.freeze({
    seed,
    generatorVersion,
    worldSizeMeters,
    terrain: Object.freeze({
      seaLevel: terrain.seaLevel,
      reliefMultiplier: terrain.reliefMultiplier,
      riverWidthMeters: terrain.riverWidthMeters,
    }),
    ...(layout === undefined ? {} : { layout: validateAetherConfig(layout) }),
  });
}

export function loadWorldMetadata(storage?: WorldStorage): WorldMetadata {
  const stored = storage?.getItem(WORLD_METADATA_KEY);
  return stored == null ? createWorldMetadata() : validateWorldMetadata(JSON.parse(stored));
}

export function loadActiveWorld(storage?: WorldStorage): { metadata: WorldMetadata; migrated: boolean } {
  const stored = storage?.getItem(WORLD_METADATA_KEY);
  if (stored == null) return { metadata: createWorldMetadata(), migrated: false };
  const value = JSON.parse(stored) as Partial<WorldMetadata> | null;
  if (value?.generatorVersion !== 1) return { metadata: validateWorldMetadata(value), migrated: false };

  const metadata = validateWorldMetadata({
    seed: value.seed === 'verdant-reach' ? DEFAULT_SEED : value.seed,
    generatorVersion: GENERATOR_VERSION,
    worldSizeMeters: value.worldSizeMeters,
    terrain: value.terrain,
  });
  if (storage?.getItem(LEGACY_METADATA_KEY) == null) storage?.setItem(LEGACY_METADATA_KEY, stored);
  return { metadata, migrated: true };
}

export function saveWorldMetadata(metadata: WorldMetadata, storage?: WorldStorage): void {
  const validated = validateWorldMetadata(metadata);
  storage?.setItem(WORLD_METADATA_KEY, JSON.stringify(validated));
}

export function terrainStorageKey(metadata: WorldMetadata): string {
  const { seed, generatorVersion, worldSizeMeters, terrain, layout } = metadata;
  return 'pixel-world:terrain:' + JSON.stringify([
    seed, generatorVersion, worldSizeMeters,
    terrain.seaLevel, terrain.reliefMultiplier, terrain.riverWidthMeters,
    ...(layout === undefined ? [] : [layout]),
  ]);
}
