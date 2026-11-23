import assert from 'node:assert/strict';
import test from 'node:test';
import { Scene } from 'three';
import { buildWaterPositions, WaterRenderer3D } from '../src/render3d/water.ts';
import { HEIGHT_SCALE } from '../src/world/coordinates3d.ts';
import { WATER_KINDS } from '../src/world/streaming.ts';

function tile({ x = 0, y = 0, spacing = 10, key = `${x}/${y}`, elevations = [4, 4, 4, 4], level = NaN, kind = 0 } = {}) {
  return {
    key, spacing, bounds: { minX: x, minY: y, maxX: x + spacing, maxY: y + spacing },
    xs: Float64Array.from([x, x + spacing]),
    ys: Float64Array.from([y, y + spacing]),
    elevations: Float32Array.from(elevations),
    waterKinds: Uint8Array.of(kind),
    waterLevels: Float32Array.of(level),
  };
}

function vertices(positions) {
  return Array.from({ length: positions.length / 3 }, (_, index) => positions.slice(index * 3, index * 3 + 3));
}

function boundaryHeights(positions, x) {
  return [...new Set(vertices(positions).filter(([px]) => px === x).map(([, py]) => py))];
}

test('lake geometry is flat and clips its shoreline against the actual ground triangles', () => {
  const slope = tile({ elevations: [0, 20, 0, 20], level: 10, kind: WATER_KINDS.lake });
  const { lakes, rivers } = buildWaterPositions(slope, []);
  assert.ok(lakes.length > 0);
  assert.equal(rivers.length, 0);
  assert.ok(vertices(lakes).every(([x, y, z]) => x >= 0 && x <= 5 && y === 10 * HEIGHT_SCALE && z >= 0 && z <= 10));
  assert.equal(Math.max(...vertices(lakes).map(([x]) => x)), 5);
  const above = tile({ elevations: [12, 20, 12, 20], level: 10, kind: WATER_KINDS.lake });
  assert.equal(buildWaterPositions(above, []).lakes.length, 0);
});

test('adjacent local river tiles use the same segment water elevation along their shared edge', () => {
  const flow = [{ from: { x: 0, y: 5, elevation: 15 }, to: { x: 20, y: 5, elevation: 5 }, halfWidth: 8, discharge: 40 }];
  const west = tile({ level: 12.5, kind: WATER_KINDS.river });
  const east = tile({ x: 10, level: 7.5, kind: WATER_KINDS.river });
  const left = buildWaterPositions(west, flow);
  const right = buildWaterPositions(east, flow);
  assert.deepEqual(boundaryHeights(left.rivers, 10), [10 * HEIGHT_SCALE]);
  assert.deepEqual(boundaryHeights(right.rivers, 0), [10 * HEIGHT_SCALE]);
  assert.deepEqual(boundaryHeights(left.rivers, 0), [15 * HEIGHT_SCALE]);
  assert.deepEqual(boundaryHeights(right.rivers, 10), [5 * HEIGHT_SCALE]);
  assert.equal(buildWaterPositions({ ...east, waterKinds: Uint8Array.of(WATER_KINDS.none) }, flow).rivers.length, 0);
});

test('regional river ribbons cross tile borders even when a grid face misses the water mask', () => {
  const spacing = 40_960;
  const flow = [{
    from: { x: 100, y: 20_000, elevation: 110 }, to: { x: 50_000, y: 21_000, elevation: 70 },
    halfWidth: 1_200, discharge: 80,
  }];
  const west = buildWaterPositions(tile({ spacing }), flow);
  const east = buildWaterPositions(tile({ x: spacing, spacing }), flow);
  assert.ok(west.rivers.length > 0 && east.rivers.length > 0);
  assert.deepEqual(boundaryHeights(west.rivers, spacing), [4 * HEIGHT_SCALE]);
  assert.deepEqual(boundaryHeights(east.rivers, 0), [4 * HEIGHT_SCALE]);
  const deep = tile({ spacing, elevations: [-10, -10, -10, -10] });
  assert.equal(buildWaterPositions(deep, flow).rivers.length, 0);
});

test('an explicitly painted river surface follows the raised ground after a tile revision', () => {
  const patched = {
    ...tile({ elevations: [9, 11, 10, 12], level: 10.5, kind: WATER_KINDS.river }),
    surfaceElevations: Float32Array.of(10.5),
  };
  const { rivers } = buildWaterPositions(patched, []);
  const heights = [...new Set(vertices(rivers).map(([, y]) => y))].toSorted((a, b) => a - b);
  assert.deepEqual(heights, [9, 10, 11, 12].map((height) => height * HEIGHT_SCALE));
});

test('water mesh resources are rebased and disposed as their tiles leave or the layer hides', () => {
  const scene = new Scene();
  const water = new WaterRenderer3D(scene);
  const lake = tile({ x: 31_900_020, y: 31_900_100, level: 10, kind: WATER_KINDS.lake });
  const segments = [];
  const options = { water: true, colors: true };
  const origin = { x: 31_900_000, y: 31_900_000 };
  assert.equal(water.render([lake], origin, segments, 1, options), false);
  assert.equal(water.resourceCount, 1);
  const group = scene.children[0].children[0];
  const geometry = group.children[0].geometry;
  assert.deepEqual(group.position.toArray(), [20, 0, 100]);
  water.render([lake], { x: origin.x + 20, y: origin.y }, segments, 1, options);
  assert.equal(group.children[0].geometry, geometry);
  assert.deepEqual(group.position.toArray(), [0, 0, 100]);

  let released = false;
  geometry.addEventListener('dispose', () => { released = true; });
  water.render([lake], origin, segments, 1, { ...options, water: false });
  assert.ok(released);
  assert.equal(water.resourceCount, 0);
  water.destroy();
  assert.equal(scene.children.length, 0);
});
