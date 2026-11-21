export { TerrainData } from './data.ts';
export { BIOMES, TerrainGenerator, type Biome, type TerrainSample } from './generator.ts';
export {
  DEFAULT_SEED, GENERATOR_VERSION, MAX_ELEVATION, MIN_ELEVATION, WORLD_METADATA_KEY,
  createWorldMetadata, loadWorldMetadata, saveWorldMetadata, terrainStorageKey,
  type TerrainParameters, type WorldMetadata, type WorldStorage,
} from './metadata.ts';
export { TerrainPatchManager, type TerrainPatch } from './patches.ts';
