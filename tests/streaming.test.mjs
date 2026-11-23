import assert from 'node:assert/strict';
import test from 'node:test';

import { TerrainData, createWorldMetadata } from '../src/terrain/index.ts';
import { CHUNK_SIZE_METERS, WORLD_SIDE_METERS, pointInWorld } from '../src/world/coordinates.ts';
import { ChunkManager, STREAM_SETTINGS, WATER_KINDS, selectDetail } from '../src/world/streaming.ts';

function view(x, y, width, height, spacing) {
  return {
    bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height },
    center: { x: x + width / 2, y: y + height / 2 },
    pixelsPerMeter: STREAM_SETTINGS.pixelsPerSample / spacing,
  };
}

function fakeTerrain(worldSizeMeters = WORLD_SIDE_METERS) {
  return {
    metadata: { worldSizeMeters },
    revision: 0,
    calls: 0,
    elevationAt(x, y) {
      return this.sample(x, y).elevation;
    },
    sample(x, y) {
      this.calls += 1;
      assert.ok(pointInWorld(x, y, worldSizeMeters));
      return { elevation: (x - y) / 10_000 + this.revision * 100, biome: 'plains', moisture: 0.5 };
    },
  };
}

function settle(manager, viewport) {
  for (let step = 0; step < STREAM_SETTINGS.maxActiveTiles + 2; step += 1) {
    const frame = manager.update(viewport, { maxTiles: 32, maxMilliseconds: 10_000 });
    if (!frame.loading) return frame;
  }
  assert.fail('Terrain streaming did not settle');
}

test('the full world uses aggregate tiles and starts with bounded sample work', () => {
  const terrain = fakeTerrain();
  const manager = new ChunkManager(terrain);
  assert.equal(terrain.calls, 0);
  const viewport = view(0, 0, WORLD_SIDE_METERS, WORLD_SIDE_METERS, 655_360);
  const first = manager.update(viewport, { maxTiles: 1, maxMilliseconds: 10_000 });
  assert.ok(first.tiles.length <= 1);
  assert.ok(terrain.calls <= 2 * (STREAM_SETTINGS.maxTileCells + 1) ** 2);

  const frame = settle(manager, viewport);
  assert.equal(frame.lod, 0);
  assert.equal(frame.loadedChunks, 0);
  assert.ok(frame.tiles.length > 0 && frame.tiles.length <= STREAM_SETTINGS.maxActiveTiles);
  assert.ok(terrain.calls < 500_000);
  assert.ok(frame.tiles.every((tile) => tile.spacing > CHUNK_SIZE_METERS));
  assert.equal(Math.max(...frame.tiles.map((tile) => tile.bounds.maxX)), WORLD_SIDE_METERS);
  assert.equal(Math.max(...frame.tiles.map((tile) => tile.bounds.maxY)), WORLD_SIDE_METERS);
});

test('five levels change the actual grid spacing and retain terrain during a transition', () => {
  const spacings = [163_840, 10_240, 640, 80, 10];
  assert.deepEqual(spacings.map((spacing) => selectDetail(STREAM_SETTINGS.pixelsPerSample / spacing).lod),
    [0, 1, 2, 3, 4]);

  const manager = new ChunkManager(fakeTerrain());
  let previousSpacing = Infinity;
  for (const [level, spacing] of spacings.entries()) {
    const viewport = view(20_000_000, 20_000_000, 650, 650, spacing);
    if (level > 0) {
      const interim = manager.update(viewport, { maxTiles: 1, maxMilliseconds: 10_000 });
      assert.ok(interim.tiles.length > 0);
    }
    const frame = settle(manager, viewport);
    assert.equal(frame.lod, level);
    assert.ok(frame.tiles.length > 0);
    const newSpacing = Math.max(...frame.tiles.map((tile) => tile.spacing));
    assert.ok(newSpacing < previousSpacing);
    previousSpacing = newSpacing;
  }
});

test('physical chunk seams share vertex coordinates and heights regardless of load order', () => {
  const metadata = createWorldMetadata('chunk-seam-test');
  const first = new ChunkManager(new TerrainData(metadata));
  const second = new ChunkManager(new TerrainData(metadata));
  const x = 12_800_000;
  const y = 10_240_000;
  const left = view(x - 460, y + 40, 340, 240, 10);
  const right = view(x + 30, y + 40, 310, 240, 10);
  const snapshot = (frame) => frame.tiles.toSorted((a, b) => a.key.localeCompare(b.key));

  const firstLeft = snapshot(settle(first, left));
  const firstRight = snapshot(settle(first, right));
  const secondRight = snapshot(settle(second, right));
  const secondLeft = snapshot(settle(second, left));
  assert.deepEqual(secondLeft, firstLeft);
  assert.deepEqual(secondRight, firstRight);

  const across = settle(first, view(x - 500, y + 40, 1010, 230, 10));
  const a = across.tiles.find((tile) => tile.bounds.maxX === x);
  assert.ok(a);
  const b = across.tiles.find((tile) => tile.bounds.minX === x && tile.bounds.minY === a.bounds.minY);
  assert.ok(b);
  assert.equal(a.xs.at(-1), b.xs[0]);
  assert.deepEqual(a.ys, b.ys);
  for (let index = 0; index < a.ys.length; index += 1) {
    assert.equal(a.elevations[(index + 1) * a.xs.length - 1], b.elevations[index * b.xs.length]);
  }
});

test('a large zoom jump promotes a complete intermediate mesh ahead of the final detail', () => {
  const manager = new ChunkManager(fakeTerrain());
  const viewport = view(4_000, 5_000, 1_640, 1_200, 10);
  settle(manager, { ...viewport, pixelsPerMeter: STREAM_SETTINGS.pixelsPerSample / 40_960 });

  let preview;
  for (let i = 0; i < 10; i++) {
    const frame = manager.update(viewport, { maxTiles: 1, maxMilliseconds: 10_000 });
    assert.ok(frame.tiles.length > 0);
    if (frame.tiles[0].spacing === 40) {
      preview = frame;
      break;
    }
  }
  assert.ok(preview?.loading);
  assert.equal(preview.tiles.length, 4);
  const final = settle(manager, viewport);
  assert.equal(final.lod, 4);
  assert.ok(final.tiles.every(({ spacing }) => spacing === 10));
});

test('a detailed view has complete edge coverage, culls rejected tiles and refreshes edited data', () => {
  const side = CHUNK_SIZE_METERS * 10 + 47;
  const terrain = fakeTerrain(side);
  const manager = new ChunkManager(terrain);
  const viewport = view(side - 28, side - 35, 42, 50, 5);
  const old = settle(manager, viewport);
  const corner = old.tiles.find((tile) => tile.bounds.maxX === side && tile.bounds.maxY === side);
  assert.ok(corner);
  assert.equal(corner.xs.at(-1), side);
  assert.equal(corner.ys.at(-1), side);
  assert.ok(old.loadedChunks > 0);

  terrain.revision += 1;
  const updated = settle(manager, viewport);
  const newCorner = updated.tiles.find((tile) => tile.bounds.maxX === side && tile.bounds.maxY === side);
  assert.ok(newCorner);
  assert.notEqual(newCorner.key, corner.key);
  assert.equal(newCorner.elevations.at(-1) - corner.elevations.at(-1), 100);

  const unseen = settle(manager, { ...viewport, intersects: () => false });
  assert.equal(unseen.tiles.length, 0);
});

test('tile face buffers carry water kind and level on the same grid as terrain materials', () => {
  const terrain = fakeTerrain(320);
  const sample = terrain.sample.bind(terrain);
  terrain.sample = (x, y) => {
    const [water, waterLevel] = x < 10 ? ['ocean', 0]
      : x < 20 ? ['river', 103.5] : x < 30 ? ['lake', 120] : ['none', null];
    return { ...sample(x, y), water, waterLevel };
  };
  const [tile] = settle(new ChunkManager(terrain), view(0, 0, 40, 20, 10)).tiles;
  assert.equal(tile.waterKinds.length, tile.materials.length);
  assert.equal(tile.waterLevels.length, tile.materials.length);
  assert.deepEqual(Array.from(tile.waterKinds.subarray(0, 4)), [
    WATER_KINDS.ocean, WATER_KINDS.river, WATER_KINDS.lake, WATER_KINDS.none,
  ]);
  assert.deepEqual(Array.from(tile.waterLevels.subarray(0, 4)), [0, 103.5, 120, NaN]);
});

test('a moved height patch refreshes old and new seam tiles across travel, LOD, and reload', () => {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const metadata = createWorldMetadata('three-patch-streaming');
  const terrain = new TerrainData(metadata, storage);
  const manager = new ChunkManager(terrain);
  let changes = 0;
  const unsubscribe = terrain.onChange(() => changes++);
  const x = 12_800_000;
  const y = 10_240_080;
  const shift = 25_600;
  const near = (patchX, spacing = 10) => view(patchX - 50, y - 40, 100, 80, spacing);
  const untouched = view(x + 70_000, y + 70_000, 100, 80, 10);
  const patch = (patchX, elevation) => ({
    id: 'seam-patch', minX: patchX - 40, minY: y - 40, maxX: patchX + 40, maxY: y + 40, elevation,
  });
  const vertex = (tile, px) => {
    const column = tile.xs.indexOf(px);
    const row = tile.ys.indexOf(y);
    assert.ok(column >= 0 && row >= 0);
    return tile.elevations[row * tile.xs.length + column];
  };

  const before = settle(manager, near(x)).tiles;
  assert.equal(before.length, 2);
  settle(manager, near(x + shift));
  const retained = settle(manager, untouched).tiles;
  terrain.setPatch(patch(x, 1_215));
  const edited = settle(manager, near(x)).tiles;
  assert.ok(edited.every((tile) => vertex(tile, x) === 1_215 && !before.includes(tile)));
  assert.equal(vertex(settle(manager, near(x, 80)).tiles[0], x), 1_215);

  terrain.setPatch(patch(x + shift, 1_320));
  assert.equal(changes, 2);
  unsubscribe();
  const afterMove = settle(manager, near(x)).tiles;
  assert.ok(afterMove.every((tile) => vertex(tile, x) !== 1_215 && !edited.includes(tile)));
  assert.ok(settle(manager, near(x + shift)).tiles.every((tile) => vertex(tile, x + shift) === 1_320));
  const afterTravel = settle(manager, untouched).tiles;
  assert.ok(afterTravel.every((tile, index) => tile === retained[index]));

  const reloaded = new TerrainData(metadata, storage);
  assert.equal(reloaded.elevationAt(x + shift, y), 1_320);
  const rebuilt = settle(new ChunkManager(reloaded), near(x + shift, 80)).tiles;
  assert.equal(vertex(rebuilt[0], x + shift), 1_320);
  terrain.removePatch('seam-patch');
  assert.equal(changes, 2);
});

test('an overlapping patch promoted to last invalidates the layer and off-center morphology samples', () => {
  const terrain = new TerrainData(createWorldMetadata());
  const manager = new ChunkManager(terrain);
  const x = 40_960;
  const y = 40_960;
  const shape = { minX: x - 10, minY: y - 10, maxX: x + 10, maxY: y + 10 };
  const low = { ...shape, id: 'low', elevation: 120 };
  terrain.setPatch(low);
  terrain.setPatch({ ...shape, id: 'high', elevation: 420 });
  const viewport = view(x + 1, y + 1, 20, 20, 10);
  const offset = view(x + 750, y + 1, 20, 20, 10);
  const oldOffsetTile = settle(manager, offset).tiles[0];
  assert.equal(settle(manager, viewport).tiles[0].elevations[0], 420);

  terrain.setPatch(low);
  assert.equal(settle(manager, viewport).tiles[0].elevations[0], 120);
  assert.notEqual(settle(manager, offset).tiles[0], oldOffsetTile);
});

test('returning to a recent view reuses its data, and repeated travel caps the cache', () => {
  const terrain = fakeTerrain();
  const manager = new ChunkManager(terrain);
  const start = view(1_000, 1_000, 160, 120, 10);
  const first = settle(manager, start);
  settle(manager, view(20_000, 30_000, 160, 120, 10));
  const calls = terrain.calls;
  const returned = settle(manager, start);
  assert.equal(terrain.calls, calls);
  assert.deepEqual(returned.tiles, first.tiles);

  for (let index = 1; index <= STREAM_SETTINGS.maxCachedTiles + 8; index += 1) {
    const frame = settle(manager, view(index * 4_608, index * 4_608, 160, 120, 10));
    assert.ok(frame.cachedTiles <= STREAM_SETTINGS.maxCachedTiles);
    assert.ok(frame.tiles.length <= STREAM_SETTINGS.maxActiveTiles);
  }
});
