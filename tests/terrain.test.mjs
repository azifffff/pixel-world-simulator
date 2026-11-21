import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TerrainData,
  createWorldMetadata,
  loadWorldMetadata,
  saveWorldMetadata,
} from '../src/terrain/index.ts';
import {
  CHUNK_SIZE_METERS, hexNeighbors, hexToWorld, worldToChunk, worldToHex,
} from '../src/world/coordinates.ts';

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
  const points = [[0, 0], [23_411, 80_019], [10_000_000, 5_000_000], [15_431_409, 9_059_024],
    [22_222_222, 19_145_014], [metadata.worldSizeMeters - 2.25, metadata.worldSizeMeters - 19.5]];
  const generatorA = new TerrainData(metadata);
  const generatorB = new TerrainData(metadata);
  const generatorC = new TerrainData(other);
  const original = points.map(([x, y]) => generatorA.sample(x, y, 80));

  assert.deepEqual(points.toReversed().map(([x, y]) => generatorB.sample(x, y, 80)), original.toReversed());
  assert.ok(points.some(([x, y], index) => generatorC.sample(x, y, 80).elevation !== original[index].elevation));
  assert.ok(original.every(({ elevation, moisture }) => Number.isFinite(elevation) && moisture >= 0 && moisture <= 1));
});

test('default overview has five broad terrain types and detail resolves rivers', () => {
  const terrain = new TerrainData(createWorldMetadata());
  const side = terrain.metadata.worldSizeMeters;
  const seen = new Set();
  for (let row = 0; row < 64; row += 1) {
    for (let column = 0; column < 64; column += 1) {
      const x = (column + 0.5) * side / 64;
      const y = (row + 0.5) * side / 64;
      seen.add(terrain.sample(x, y, side / 64).biome);
    }
  }
  assert.deepEqual(seen, new Set(['ocean', 'plains', 'hills', 'mountains', 'forest']));
  assert.equal(terrain.sample(16_214_400, 16_000_000, 160).biome, 'river');
});

test('global heights stay continuous at hex edges and stable at identical coordinates across LOD', () => {
  const terrain = new TerrainData(createWorldMetadata('seam-test'));
  const owner = { q: 801, r: 961 };
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
    assert.ok(Math.abs(terrain.sample(after.x, after.y, 5).elevation - lowResolution) < 0.05);
  }
});

test('a river remains connected across multiple physical chunks and hexes', () => {
  const terrain = new TerrainData(createWorldMetadata('verdant-reach'));
  const startY = 16_000_000;
  const spacing = CHUNK_SIZE_METERS / 4;
  let previousX = 16_214_400;
  const hexes = new Set();
  const chunks = new Set();

  for (let row = 0; row <= 64; row += 1) {
    const y = startY + row * CHUNK_SIZE_METERS;
    const candidates = [];
    for (let offset = -12; offset <= 12; offset += 1) {
      const x = previousX + offset * spacing;
      if (terrain.sample(x, y, spacing).biome === 'river') candidates.push(x);
    }
    assert.ok(candidates.length > 0, `river lost at y=${y}`);
    const x = candidates[Math.floor(candidates.length / 2)];
    const { q, r } = worldToHex(x, y);
    const chunk = worldToChunk(x, y);
    hexes.add(`${q},${r}`);
    chunks.add(`${chunk.x},${chunk.y}`);
    assert.equal(terrain.sample(x, y - 0.01, spacing).biome, 'river');
    assert.equal(terrain.sample(x, y + 0.01, spacing).biome, 'river');
    if (row > 0) {
      assert.equal(terrain.sample((x + previousX) / 2, y - CHUNK_SIZE_METERS / 2, spacing).biome, 'river');
    }
    previousX = x;
  }
  assert.equal(chunks.size, 65);
  assert.ok(hexes.size >= 2);
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
  assert.deepEqual(terrain.sample(target.x, target.y, 10), { ...base, elevation: 519, biome: 'forest' });
  assert.deepEqual(terrain.sample(15_000, 16_000, 10), outside);

  const reloaded = new TerrainData(loadWorldMetadata(storage), storage);
  assert.deepEqual(reloaded.metadata, metadata);
  assert.deepEqual(reloaded.sample(target.x, target.y, 80), { ...base, elevation: 519, biome: 'forest' });
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
