import assert from 'node:assert/strict';
import test from 'node:test';

import { TerrainData, createWorldMetadata } from '../src/terrain/index.ts';
import { CHUNK_SIZE_METERS, WORLD_SIDE_METERS, pointInWorld } from '../src/world/coordinates.ts';
import { ChunkManager, STREAM_SETTINGS, selectDetail } from '../src/world/streaming.ts';

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
