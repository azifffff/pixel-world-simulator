import assert from 'node:assert/strict';
import test from 'node:test';
import { AetherHydrology } from '../src/terrain/aether-hydrology.ts';

const SIDE = 640 * 224;
const STEP = 640;

function basinIsland(x, y) {
  const u = x / SIDE - 0.5;
  const v = y / SIDE - 0.5;
  const shelf = (0.42 - Math.hypot(u, v)) * 2_100;
  return shelf - 620 * Math.exp(-((u * u + v * v) / 0.0028));
}

function pointKey({ x, y }) {
  return `${x},${y}`;
}

test('regional rivers accumulate tributaries and their levels never rise downstream', () => {
  const hydrology = new AetherHydrology(SIDE, basinIsland, 45);
  const outlets = new Map(hydrology.segments.map((segment) => [pointKey(segment.from), segment]));
  const upstreamCounts = new Map();
  let shorelineMouths = 0;
  for (const segment of hydrology.segments) {
    const { from, to, discharge } = segment;
    assert.ok(from.elevation >= to.elevation);
    const next = outlets.get(pointKey(to));
    if (next) {
      assert.equal(next.from.elevation, to.elevation);
      assert.ok(next.discharge >= discharge);
      upstreamCounts.set(pointKey(to), (upstreamCounts.get(pointKey(to)) ?? 0) + 1);
    }
    if (to.elevation === 0) {
      assert.ok(Math.abs(basinIsland(to.x, to.y)) < 0.02);
      shorelineMouths++;
    }
  }
  assert.ok(shorelineMouths > 0);
  assert.ok([...upstreamCounts.values()].some((count) => count >= 2));
});

test('a natural basin fills below its spill level and stable geometry crosses chunk edges', () => {
  const hydrology = new AetherHydrology(SIDE, basinIsland, 45);
  const center = SIDE / 2;
  const basinFloor = basinIsland(center, center);
  const lake = hydrology.sample(center, center, basinFloor);
  assert.equal(lake.water, 'lake');
  assert.ok(lake.waterLevel > basinFloor + 100);
  assert.equal(hydrology.sample(0, 0, basinIsland(0, 0)).water, 'none');

  const river = hydrology.segments.find(({ from, to }) =>
    from.elevation > 0 && to.elevation > 0 &&
    Math.abs(from.x / STEP - Math.round(from.x / STEP)) < 1e-9 &&
    hydrology.sample(from.x, from.y, basinIsland(from.x, from.y)).water === 'river',
  );
  assert.ok(river);
  const { x, y } = river.from;
  const withinRiver = [-0.01, 0, 0.01].map((offset) => {
    const land = basinIsland(x + offset, y);
    const detailed = hydrology.sample(x + offset, y, land);
    const aggregate = hydrology.sample(x + offset, y, land, 40);
    assert.equal(detailed.water, 'river');
    assert.equal(detailed.elevation, aggregate.elevation);
    assert.equal(detailed.elevation, hydrology.elevationAt(x + offset, y, land));
    return detailed.elevation;
  });
  assert.ok(Math.max(...withinRiver) - Math.min(...withinRiver) < 0.02);
});

test('drainage is deterministic independent of which point is sampled first', () => {
  const a = new AetherHydrology(SIDE, basinIsland, 75);
  const b = new AetherHydrology(SIDE, basinIsland, 75);
  const center = SIDE / 2;
  a.sample(center, center, basinIsland(center, center));
  assert.deepEqual(a.segments, b.segments);
  assert.deepEqual(a.lakes, b.lakes);
});
