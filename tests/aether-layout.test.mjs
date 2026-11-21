import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_AETHER_CONFIG, validateAetherConfig } from '../src/terrain/aether-config.ts';
import { AetherLayout } from '../src/terrain/aether-layout.ts';
import { createWorldMetadata } from '../src/terrain/metadata.ts';
import { TerrainGenerator } from '../src/terrain/generator.ts';

const metadata = createWorldMetadata();
const side = metadata.worldSizeMeters;
const layout = new AetherLayout(metadata);
const sample = (x, y) => layout.sample(x * side, y * side);

function landComponents(cells, size) {
  const seen = new Uint8Array(cells.length);
  const components = [];
  for (let start = 0; start < cells.length; start += 1) {
    if (!cells[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    const regions = new Map();
    for (let index = 0; index < queue.length; index += 1) {
      const cell = queue[index];
      const region = cells[cell];
      regions.set(region, (regions.get(region) ?? 0) + 1);
      const neighbors = [
        cell % size > 0 ? cell - 1 : -1,
        cell % size < size - 1 ? cell + 1 : -1,
        cell >= size ? cell - size : -1,
        cell + size < cells.length ? cell + size : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && cells[neighbor] && !seen[neighbor]) {
          seen[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    components.push(regions);
  }
  return components;
}

test('the default continents and southern archipelago are separated by ocean', () => {
  const size = 200;
  const cells = [];
  let mainlandCells = 0;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const { elevation, coast, region } = sample((column + 0.5) / size, (row + 0.5) / size);
      assert.equal(elevation > 0, coast > 0);
      cells.push(elevation > 0 ? region : null);
      if (elevation > 0 && region === 'main') mainlandCells += 1;
    }
  }
  const mainlandArea = (side / 1_000) ** 2 * mainlandCells / cells.length;
  assert.ok(mainlandArea >= 65_000_000 && mainlandArea <= 75_000_000,
    `mainland rasters to ${Math.round(mainlandArea / 1e6)} million km²`);

  const components = landComponents(cells, size);
  const main = components.find((component) => component.get('main') > mainlandCells * 0.95);
  assert.ok(main, 'the main continent has one connected core');
  assert.equal(main.has('remote'), false);
  const remote = components.find((component) => (component.get('remote') ?? 0) > 100);
  assert.ok(remote, 'the remote continent forms a distinct landmass');
  assert.ok(components.filter((component) => component.size === 1 && component.has('island')).length >= 6);
  for (let y = 0.25; y <= 0.75; y += 0.025) {
    assert.ok(sample(0.60, y).elevation < 0, 'the mid-ocean gap remains open');
  }
});

test('coastal and ocean height stay continuous across sea level', () => {
  let inland = 0.27;
  let offshore = 0.05;
  const y = 0.49;
  assert.ok(sample(inland, y).elevation > 0);
  assert.ok(sample(offshore, y).elevation < 0);

  for (let iteration = 0; iteration < 48; iteration += 1) {
    const x = (inland + offshore) / 2;
    if (sample(x, y).elevation > 0) inland = x;
    else offshore = x;
  }

  const shore = (inland + offshore) / 2;
  const halfMeter = 0.5 / side;
  const land = sample(shore + halfMeter, y);
  const water = sample(shore - halfMeter, y);
  assert.ok(land.elevation >= 0 && water.elevation <= 0);
  assert.ok(land.elevation - water.elevation < 1);
  assert.ok(sample(0.54, 0.49).elevation < sample(shore - 5_000 / side, y).elevation);
});

test('layout validation preserves authored structure IDs and isolates caller mutations', () => {
  const edited = structuredClone(DEFAULT_AETHER_CONFIG);
  const ridge = edited.mountainSystems.find(({ id }) => id === 'central-cordillera');
  ridge.height -= 1_000;
  const normalized = validateAetherConfig(edited);
  assert.equal(normalized.mountainSystems.find(({ id }) => id === ridge.id).height, ridge.height);

  const [x, y] = ridge.paths[0][2];
  const modified = new AetherLayout({ ...metadata, layout: normalized });
  assert.ok(modified.elevationAt(x * side, y * side) < layout.elevationAt(x * side, y * side));
  ridge.height += 1_000;
  assert.notEqual(normalized.mountainSystems.find(({ id }) => id === ridge.id).height, ridge.height);
  edited.mountainSystems.push(structuredClone(ridge));
  assert.throws(() => validateAetherConfig(edited), /Duplicate layout feature ID/);
});

test('cordillera branches stay high along their axes and grade toward lowlands', () => {
  const ridge = DEFAULT_AETHER_CONFIG.mountainSystems.find(({ id }) => id === 'central-cordillera');
  assert.ok(ridge.paths.length >= 3);
  for (const axis of ridge.paths) {
    const observations = [];
    for (let index = 1; index < axis.length; index += 1) {
      const [x0, y0] = axis[index - 1];
      const [x1, y1] = axis[index];
      for (let i = 0; i <= 4; i += 1) {
        const point = sample(x0 + (x1 - x0) * i / 4, y0 + (y1 - y0) * i / 4);
        observations.push(point.ridge >= 0.55 && point.elevation > 1_800);
      }
    }
    assert.ok(observations.filter(Boolean).length >= observations.length * 0.85);
  }

  const [x, y] = ridge.paths[0][1];
  const crest = sample(x, y);
  const slope = sample(x - ridge.width * 0.6, y);
  const lowland = sample(x - ridge.width * 1.25, y);
  assert.ok(crest.elevation > slope.elevation && slope.elevation > lowland.elevation);
  assert.ok(lowland.elevation > 0 && lowland.elevation < 650);
});

test('a broad plain varies gently and an authored basin excavates lower ground', () => {
  const plain = DEFAULT_AETHER_CONFIG.majorPlains.find(({ id }) => id === 'western-lowplain');
  const elevations = Array.from({ length: 11 }, (_, index) =>
    sample(plain.center[0] + (index - 5) * plain.radii[0] * 0.05, plain.center[1]).elevation);
  const variation = Math.max(...elevations) - Math.min(...elevations);
  assert.ok(elevations.every((elevation) => elevation > 0 && elevation < 350));
  assert.ok(variation > 1 && variation < 120);

  const basin = DEFAULT_AETHER_CONFIG.basins.find(({ id }) => id === 'central-basin');
  const withoutBasin = new AetherLayout({
    ...metadata,
    layout: { ...DEFAULT_AETHER_CONFIG, basins: DEFAULT_AETHER_CONFIG.basins.filter(({ id }) => id !== basin.id) },
  });
  const center = sample(...basin.center);
  assert.ok(center.basin > 0.8 && center.elevation > 0);
  assert.ok(withoutBasin.elevationAt(basin.center[0] * side, basin.center[1] * side) > center.elevation + 80);
  const rim = [
    sample(basin.center[0] + basin.radii[0], basin.center[1]).elevation,
    sample(basin.center[0] - basin.radii[0], basin.center[1]).elevation,
    sample(basin.center[0], basin.center[1] + basin.radii[1]).elevation,
    sample(basin.center[0], basin.center[1] - basin.radii[1]).elevation,
  ];
  assert.ok(rim.filter((elevation) => elevation > center.elevation + 25).length >= 3);
});


test('a high tableland has a relatively flat core and a lower rim', () => {
  const tableland = DEFAULT_AETHER_CONFIG.plateaus.find(({ id }) => id === 'cold-tableland');
  const [x, y] = tableland.center;
  const [width, depth] = tableland.radii;
  const terrain = new TerrainGenerator(metadata);
  const core = [];
  for (let row = -2; row <= 2; row += 1) {
    for (let column = -2; column <= 2; column += 1) {
      core.push(terrain.sample((x + column * width * 0.06) * side, (y + row * depth * 0.06) * side));
    }
  }
  const heights = core.map(({ elevation }) => elevation);
  assert.ok(Math.min(...heights) > 1_250 && Math.max(...heights) - Math.min(...heights) < 550);
  assert.ok(core.filter(({ landform }) => landform.includes('plateau')).length >= 20);
  assert.ok(core.every(({ slope }) => slope < 10));
  // The western rim drops toward the lowlands; the southern side joins a cordillera.
  const rim = sample(x - width * 1.04, y);
  assert.ok(rim.elevation > 0 && rim.elevation < Math.min(...heights) - 450);
});
