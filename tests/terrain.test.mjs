import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TerrainData,
  TerrainGenerator,
  createWorldMetadata,
  loadWorldMetadata,
  saveWorldMetadata,
} from '../src/terrain/index.ts';
import {
  loadActiveWorld, terrainStorageKey, WORLD_METADATA_KEY,
} from '../src/terrain/metadata.ts';
import { DEFAULT_AETHER_CONFIG } from '../src/terrain/aether-config.ts';
import { CHUNK_SIZE_METERS, hexNeighbors, hexToWorld, worldToChunk, worldToHex } from '../src/world/coordinates.ts';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

test('generation is deterministic across sample order, and seed changes the map', () => {
  const metadata = createWorldMetadata('order-test');
  const other = createWorldMetadata('another-seed');
  const side = metadata.worldSizeMeters;
  const points = [[0, 0], [0.23, 0.45], [0.27, 0.50], [0.29, 0.53], [0.35, 0.49],
    [0.43, 0.63], [0.76, 0.35], [1 - 2.25 / side, 1 - 19.5 / side]]
    .map(([x, y]) => [x * side, y * side]);
  const generatorA = new TerrainData(metadata);
  const generatorB = new TerrainData(metadata);
  const generatorC = new TerrainData(other);
  const original = points.map(([x, y]) => generatorA.sample(x, y, 80));

  assert.deepEqual(points.toReversed().map(([x, y]) => generatorB.sample(x, y, 80)), original.toReversed());
  assert.ok(points.some(([x, y], index) => generatorC.sample(x, y, 80).elevation !== original[index].elevation));
  assert.ok(original.every(({ elevation, moisture }) => Number.isFinite(elevation) && moisture >= 0 && moisture <= 1));
});

test('global heights stay continuous at hex edges and stable at identical coordinates across LOD', () => {
  const terrain = new TerrainData(createWorldMetadata('seam-test'));
  const side = terrain.metadata.worldSizeMeters;
  const owner = worldToHex(side * 0.27, side * 0.50);
  const center = hexToWorld(owner.q, owner.r);
  for (const neighbor of hexNeighbors(owner.q, owner.r)) {
    const adjacent = hexToWorld(neighbor.q, neighbor.r);
    const dx = adjacent.x - center.x;
    const dy = adjacent.y - center.y;
    const before = { x: center.x + dx * 0.4999995, y: center.y + dy * 0.4999995 };
    const after = { x: center.x + dx * 0.5000005, y: center.y + dy * 0.5000005 };
    assert.deepEqual(worldToHex(before.x, before.y), owner);
    assert.deepEqual(worldToHex(after.x, after.y), neighbor);
    const lowResolution = terrain.sample(before.x, before.y, 10_240).elevation;
    assert.equal(terrain.sample(before.x, before.y, 5).elevation, lowResolution);
    assert.equal(terrain.elevationAt(before.x, before.y), lowResolution);
    assert.ok(Math.abs(terrain.sample(after.x, after.y, 5).elevation - lowResolution) < 0.2);
  }
});

test('authored terrain and patches persist with field-level precedence and version guards', () => {
  const storage = memoryStorage();
  const metadata = createWorldMetadata('saved-world');
  const bounds = { minX: 10_810, minY: 11_140, maxX: 10_890, maxY: 11_310 };
  const target = { x: 10_850, y: 11_250 };
  const terrain = new TerrainData(metadata, storage);
  const base = terrain.sample(target.x, target.y, 10);
  const outside = terrain.sample(15_000, 16_000, 10);

  saveWorldMetadata(metadata, storage);
  terrain.setAuthoredTerrain({ id: 'survey', ...bounds, elevation: 212, biome: 'forest' });
  const revision = terrain.revision;
  terrain.setPatch({ id: 'raise', ...bounds, elevation: 418 });
  terrain.setPatch({ id: 'raise-again', ...bounds, elevation: 519 });
  assert.ok(terrain.revision > revision);
  const patched = terrain.sample(target.x, target.y, 10);
  assert.equal(patched.elevation, 519);
  assert.equal(patched.biome, 'forest');
  assert.equal(terrain.elevationAt(target.x, target.y), 519);
  assert.deepEqual(terrain.sample(15_000, 16_000, 10), outside);

  const reloaded = new TerrainData(loadWorldMetadata(storage), storage);
  assert.deepEqual(reloaded.metadata, metadata);
  assert.deepEqual(reloaded.sample(target.x, target.y, 10), patched);
  assert.equal(reloaded.sample(target.x, target.y, 80).elevation, 519);
  reloaded.removePatch('raise-again');
  assert.equal(new TerrainData(metadata, storage).sample(target.x, target.y, 10).elevation, 418);
  reloaded.removePatch('raise');
  assert.equal(reloaded.sample(target.x, target.y, 10).elevation, 212);
  reloaded.removeAuthoredTerrain('survey');
  assert.deepEqual(new TerrainData(metadata, storage).sample(target.x, target.y, 10), base);

  assert.throws(() => new TerrainData({ ...metadata, generatorVersion: 999 }, storage));
});

test('edits remain associated with the seed and full generator configuration', () => {
  const storage = memoryStorage();
  const metadata = createWorldMetadata('patch-isolation');
  const terrain = new TerrainData(metadata, storage);
  terrain.setPatch({ id: 'peak', minX: 0, minY: 0, maxX: 100, maxY: 100, elevation: 3_512 });

  for (const otherMetadata of [createWorldMetadata('other-seed'), {
    ...metadata,
    terrain: { ...metadata.terrain, reliefMultiplier: metadata.terrain.reliefMultiplier * 0.9 },
  }, {
    ...metadata,
    layout: { ...DEFAULT_AETHER_CONFIG, noise: { ...DEFAULT_AETHER_CONFIG.noise, coastWarp: 0 } },
  }]) {
    assert.deepEqual(new TerrainData(otherMetadata, storage).sample(50, 50),
      new TerrainData(otherMetadata).sample(50, 50));
  }
  assert.equal(new TerrainData(metadata, storage).sample(50, 50).elevation, 3_512);
});

test('patches merge with stored edits and preserve the revision if persistence fails', () => {
  const storage = memoryStorage();
  const metadata = createWorldMetadata('overlapping-clients');
  const first = new TerrainData(metadata, storage);
  const second = new TerrainData(metadata, storage);
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  first.setPatch({ id: 'high', ...bounds, elevation: 500 });
  second.setPatch({ id: 'trees', ...bounds, biome: 'forest' });
  const reopened = new TerrainData(metadata, storage);
  const saved = reopened.sample(50, 50);
  assert.equal(saved.elevation, 500);
  assert.equal(saved.biome, 'forest');

  const revision = reopened.revision;
  storage.setItem = () => { throw new Error('Storage full'); };
  assert.throws(() => reopened.setPatch({ id: 'high', ...bounds, elevation: 800 }), /Storage full/);
  assert.equal(reopened.revision, revision);
  assert.deepEqual(reopened.sample(50, 50), saved);
  assert.deepEqual(new TerrainData(metadata, storage).sample(50, 50), saved);
});


test('feathered coastline edits preserve a continuous edge and persist a surface override', () => {
  const storage = memoryStorage();
  const metadata = createWorldMetadata('feathered-coast');
  const terrain = new TerrainData(metadata, storage);
  const { worldSizeMeters: side } = metadata;
  const x = side * 0.48;
  const y = side * 0.50;
  const minX = x - 2_000;
  const mainPatch = {
    id: 'coast-rise', minX, minY: y - 2_000, maxX: x + 2_000, maxY: y + 2_000,
    elevation: 120, blendMeters: 1_000, surface: 'beach',
  };
  const untouchedEdge = terrain.elevationAt(minX, y);
  terrain.setPatch(mainPatch);
  const reloaded = new TerrainData(metadata, storage);

  assert.equal(reloaded.elevationAt(minX, y), untouchedEdge);
  assert.ok(Math.abs(reloaded.elevationAt(minX + 0.01, y) - untouchedEdge) < 0.1);
  assert.equal(reloaded.elevationAt(x, y), 120);
  assert.equal(reloaded.sample(x, y).surface, 'beach');
  assert.equal(reloaded.sample(x, y).water, 'none');
  assert.deepEqual(reloaded.sample(x, y), terrain.sample(x, y));
});

test('the application opens v1 saves in the current version without destroying v1 metadata or patches', () => {
  const storage = memoryStorage();
  const v1 = { ...createWorldMetadata('verdant-reach'), generatorVersion: 1 };
  const legacyKey = terrainStorageKey(v1);
  const metadataText = JSON.stringify(v1);
  const patchText = JSON.stringify({
    schemaVersion: 1,
    worldKey: legacyKey,
    authored: [],
    patches: [{ id: 'old', minX: 0, minY: 0, maxX: 100, maxY: 100, elevation: 6 }],
  });

  storage.setItem(WORLD_METADATA_KEY, metadataText);
  storage.setItem(legacyKey, patchText);
  assert.throws(() => loadWorldMetadata(storage), /Unsupported terrain generator version/);
  const { metadata, migrated } = loadActiveWorld(storage);

  assert.equal(migrated, true);
  assert.equal(metadata.seed, createWorldMetadata().seed);
  assert.notEqual(metadata.generatorVersion, 1);
  assert.equal(storage.getItem('pixel-world:metadata:v1'), metadataText);
  assert.equal(storage.getItem(legacyKey), patchText);
  assert.notEqual(terrainStorageKey(metadata), legacyKey);
  const terrain = new TerrainData(metadata, storage);
  assert.deepEqual(terrain.sample(50, 50), new TerrainData(metadata).sample(50, 50));

  saveWorldMetadata(metadata, storage);
  assert.equal(loadActiveWorld(storage).migrated, false);
  assert.equal(storage.getItem(legacyKey), patchText);
});

test('an Aetheria river reach flows downhill through real chunk and hex coordinates', () => {
  const generator = new TerrainGenerator(createWorldMetadata());
  const { segments, lakes } = generator.hydrology;
  assert.ok(segments.length > 0 && lakes.length > 0);
  assert.ok(segments.every(({ from, to }) => from.elevation >= to.elevation));

  const reaches = segments.filter(({ from, to }) =>
    from.elevation - to.elevation >= 5 && to.elevation > 50 &&
    generator.layout.sample((from.x + to.x) / 2, (from.y + to.y) / 2).region === 'main',
  );
  const sampleReach = ({ from, to }) => Array.from({ length: 9 }, (_, index) => {
    const progress = (index + 1) / 10;
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    return { x, y, fine: generator.sample(x, y, 5), coarse: generator.sample(x, y, 10_240) };
  });
  let river;
  let segment;
  for (const candidate of reaches) {
    const reach = sampleReach(candidate);
    if (reach.every(({ fine }, index) =>
      fine.water === 'river' && fine.waterLevel > fine.elevation &&
      (index === 0 || fine.waterLevel <= reach[index - 1].fine.waterLevel + 0.01),
    )) {
      river = reach;
      segment = candidate;
      break;
    }
  }
  assert.ok(river && segment, 'the default mainland contains a connected downsloping reach');
  const hexes = new Set();
  const chunks = new Set();
  for (const { x, y, fine, coarse } of river) {
    const { q, r } = worldToHex(x, y);
    const chunk = worldToChunk(x, y);
    hexes.add(`${q},${r}`);
    chunks.add(`${chunk.x},${chunk.y}`);
    assert.equal(coarse.elevation, fine.elevation);
    assert.equal(coarse.water, 'river');
  }
  assert.ok(hexes.size >= 2);
  assert.ok(chunks.size >= 6);
  const { from, to } = segment;
  const axis = Math.abs(to.x - from.x) > Math.abs(to.y - from.y) ? 'x' : 'y';
  const seam = Math.round((from[axis] + to[axis]) / 2 / CHUNK_SIZE_METERS) * CHUNK_SIZE_METERS;
  const progress = (seam - from[axis]) / (to[axis] - from[axis]);
  const onEitherSide = [-0.01, 0.01].map((offset) => {
    const x = from.x + (to.x - from.x) * progress + (axis === 'x' ? offset : 0);
    const y = from.y + (to.y - from.y) * progress + (axis === 'y' ? offset : 0);
    return generator.sample(x, y, 5);
  });
  assert.ok(onEitherSide.every(({ water }) => water === 'river'));
  assert.ok(Math.abs(onEitherSide[0].elevation - onEitherSide[1].elevation) < 0.1);
  const lake = lakes.find(({ x, y }) => generator.layout.sample(x, y).region === 'main');
  assert.ok(lake);
  const underLake = generator.sample(lake.x, lake.y);
  assert.equal(underLake.water, 'lake');
  assert.ok(underLake.waterLevel > underLake.elevation);
});
