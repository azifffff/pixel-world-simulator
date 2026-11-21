import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENERATOR_VERSION, TerrainData, WORLD_METADATA_KEY, createWorldMetadata,
  loadActiveWorld, loadWorldMetadata, saveWorldMetadata, terrainStorageKey,
} from '../src/terrain/index.ts';
import { WORLD_SIDE_METERS } from '../src/world/coordinates.ts';

const LEGACY_SIDE_METERS = Math.sqrt(1_530_000_000) * 1_000;
const ARCHIVE_V2_KEY = `${WORLD_METADATA_KEY}:v2`;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function legacyWorld(seed) {
  return {
    ...createWorldMetadata(seed),
    generatorVersion: 2,
    worldSizeMeters: LEGACY_SIDE_METERS,
    terrain: { seaLevel: 0.55, reliefMultiplier: 1.3, riverWidthMeters: 800 },
  };
}

test('Aetheria 2.0 metadata and terrain edits retain their original size and coordinates', () => {
  const storage = memoryStorage();
  const legacy = {
    ...legacyWorld('saved-aetheria'),
    layout: { landmasses: [{ id: 'legacy-coast', region: 'main', outline: [[0.2, 0.2], [0.3, 0.2], [0.2, 0.3]] }] },
  };
  const legacyJson = JSON.stringify(legacy);
  const legacyKey = terrainStorageKey(legacy);
  const legacyEdits = JSON.stringify({
    schemaVersion: 1,
    worldKey: legacyKey,
    authored: [],
    patches: [
      { id: 'old-hill', minX: 0, minY: 0, maxX: 120, maxY: 120, elevation: 810 },
      { id: 'old-edge', minX: LEGACY_SIDE_METERS - 500, minY: 0, maxX: LEGACY_SIDE_METERS, maxY: 100, elevation: 510 },
    ],
  });
  storage.setItem(WORLD_METADATA_KEY, legacyJson);
  storage.setItem(legacyKey, legacyEdits);

  const opened = loadActiveWorld(storage);
  assert.equal(opened.migrated, true);
  assert.equal(opened.previousVersion, 2);
  assert.equal(opened.metadata.generatorVersion, GENERATOR_VERSION);
  assert.equal(opened.metadata.worldSizeMeters, WORLD_SIDE_METERS);
  assert.ok(opened.metadata.worldSizeMeters < LEGACY_SIDE_METERS);
  assert.equal(opened.metadata.seed, legacy.seed);
  assert.deepEqual(opened.metadata.terrain, legacy.terrain);
  assert.equal(opened.metadata.layout, undefined);
  assert.equal(storage.getItem(ARCHIVE_V2_KEY), legacyJson);

  saveWorldMetadata(opened.metadata, storage);
  const terrain = new TerrainData(loadWorldMetadata(storage), storage);
  assert.equal(terrain.elevationAt(60, 60), new TerrainData(opened.metadata).elevationAt(60, 60));
  terrain.setPatch({ id: 'new-hill', minX: 0, minY: 0, maxX: 120, maxY: 120, elevation: 235 });
  assert.throws(() => terrain.setPatch({
    id: 'invalid-old-edge', minX: LEGACY_SIDE_METERS - 500, minY: 0,
    maxX: LEGACY_SIDE_METERS, maxY: 100, elevation: 510,
  }), /Invalid terrain patch/);

  const current = loadActiveWorld(storage);
  assert.equal(current.migrated, false);
  assert.equal(new TerrainData(current.metadata, storage).sample(60, 60, 80).elevation, 235);
  assert.equal(storage.getItem(ARCHIVE_V2_KEY), legacyJson);
  assert.equal(storage.getItem(legacyKey), legacyEdits);
});

test('restoring another version 2 save preserves both archives without duplicates', () => {
  const storage = memoryStorage();
  const earlier = JSON.stringify(legacyWorld('earlier'));
  const restored = JSON.stringify(legacyWorld('restored'));
  storage.setItem(ARCHIVE_V2_KEY, earlier);
  storage.setItem(WORLD_METADATA_KEY, restored);
  const opened = loadActiveWorld(storage);
  assert.equal(opened.metadata.seed, 'restored');
  assert.equal(storage.getItem(ARCHIVE_V2_KEY), earlier);
  assert.equal(storage.getItem(`${ARCHIVE_V2_KEY}:2`), restored);
  saveWorldMetadata(opened.metadata, storage);
  assert.equal(storage.getItem(`${ARCHIVE_V2_KEY}:3`), null);
});

test('failed archiving and unrecognized versions cannot overwrite active metadata', () => {
  const storage = memoryStorage();
  const legacy = JSON.stringify(legacyWorld('cannot-archive'));
  storage.setItem(WORLD_METADATA_KEY, legacy);
  const write = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === ARCHIVE_V2_KEY) throw new Error('Storage full');
    write(key, value);
  };

  assert.throws(() => loadActiveWorld(storage), /Storage full/);
  assert.throws(() => saveWorldMetadata(createWorldMetadata(), storage), /Storage full/);
  assert.equal(storage.getItem(WORLD_METADATA_KEY), legacy);

  const future = JSON.stringify({ ...createWorldMetadata(), generatorVersion: GENERATOR_VERSION + 1 });
  write(WORLD_METADATA_KEY, future);
  assert.throws(() => loadActiveWorld(storage), /Unsupported terrain generator version/);
  assert.throws(() => saveWorldMetadata(createWorldMetadata(), storage), /Unsupported terrain generator version/);
  assert.equal(storage.getItem(WORLD_METADATA_KEY), future);
});
