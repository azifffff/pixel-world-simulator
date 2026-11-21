import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHUNK_SIZE_METERS,
  HEX_FLAT_WIDTH_METERS,
  WORLD_AREA_KM2,
  WORLD_SIDE_METERS,
  clippedHexPolygon,
  hexNeighbors,
  hexToWorld,
  pointInWorld,
  projectIsometric,
  unprojectIsometric,
  worldToChunk,
  worldToHex,
} from '../src/world/coordinates.ts';

function approximately(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

function area(polygon) {
  if (polygon.length < 3) return 0;

  const { x: originX, y: originY } = polygon[0];
  let twiceArea = 0;
  for (let index = 1; index + 1 < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[index + 1];
    twiceArea += (a.x - originX) * (b.y - originY) - (a.y - originY) * (b.x - originX);
  }
  return Math.abs(twiceArea) / 2;
}

test('world dimensions preserve the intended physical area and grid scale', () => {
  assert.equal(WORLD_AREA_KM2, 1_530_000_000);
  approximately((WORLD_SIDE_METERS / 1_000) ** 2, WORLD_AREA_KM2, 50);
  assert.equal(HEX_FLAT_WIDTH_METERS, 20_000);
  assert.equal(CHUNK_SIZE_METERS, 128 * 5);

  const fullHex = clippedHexPolygon(100, 100);
  assert.equal(fullHex.length, 6);
  approximately(area(fullHex) / 1_000_000, 346.410162, 0.000001);
  approximately(WORLD_AREA_KM2 / (area(fullHex) / 1_000_000), 4_420_000, 5_000);
});

test('hex centers round trip and all six neighbors share an edge', () => {
  const owner = { q: 150, r: 230 };
  const center = hexToWorld(owner.q, owner.r);
  const polygon = clippedHexPolygon(owner.q, owner.r);
  assert.deepEqual(worldToHex(center.x, center.y), owner);

  const neighbors = hexNeighbors(owner.q, owner.r);
  assert.equal(neighbors.length, 6);
  assert.equal(new Set(neighbors.map(({ q, r }) => `${q},${r}`)).size, 6);
  for (const neighbor of neighbors) {
    const neighborCenter = hexToWorld(neighbor.q, neighbor.r);
    const neighborPolygon = clippedHexPolygon(neighbor.q, neighbor.r);
    const dx = neighborCenter.x - center.x;
    const dy = neighborCenter.y - center.y;
    approximately(Math.hypot(dx, dy), HEX_FLAT_WIDTH_METERS, 0.000001);
    assert.equal(polygon.filter(({ x, y }) => neighborPolygon.some((point) => (
      Math.hypot(point.x - x, point.y - y) < 0.000001
    ))).length, 2);
    assert.deepEqual(worldToHex(center.x + dx * 0.49999, center.y + dy * 0.49999), owner);
    assert.deepEqual(worldToHex(center.x + dx * 0.50001, center.y + dy * 0.50001), neighbor);
  }
});

test('hex polygons cover a finite square including all clipped edges', () => {
  const side = 46_543;
  let totalArea = 0;
  for (let q = -6; q <= 6; q += 1) {
    for (let r = -6; r <= 6; r += 1) {
      const polygon = clippedHexPolygon(q, r, side);
      assert.ok(polygon.every(({ x, y }) => pointInWorld(x, y, side)));
      totalArea += area(polygon);
    }
  }
  approximately(totalArea, side ** 2, 0.001);

  for (const x of [0, WORLD_SIDE_METERS]) {
    for (const y of [0, WORLD_SIDE_METERS]) {
      const { q, r } = worldToHex(x, y);
      const polygon = clippedHexPolygon(q, r);
      assert.ok(area(polygon) > 0);
      assert.ok(polygon.every((point) => pointInWorld(point.x, point.y)));
    }
  }
});

test('chunk lookup clips the outermost partial chunk and preserves five-meter precision', () => {
  assert.deepEqual(worldToChunk(0, 0), { x: 0, y: 0 });
  assert.deepEqual(worldToChunk(640, 639.999), { x: 1, y: 0 });
  assert.equal(worldToChunk(-0.01, 0), null);
  assert.equal(worldToChunk(WORLD_SIDE_METERS + 0.01, 0), null);
  const outer = Math.ceil(WORLD_SIDE_METERS / CHUNK_SIZE_METERS) - 1;
  assert.deepEqual(worldToChunk(WORLD_SIDE_METERS, WORLD_SIDE_METERS), { x: outer, y: outer });

  const x = WORLD_SIDE_METERS - 11.125;
  const y = WORLD_SIDE_METERS - 66.875;
  const elevation = 1_234.5;
  const first = projectIsometric(x, y, elevation);
  const second = projectIsometric(x + 5, y, elevation);
  const recovered = unprojectIsometric(first.x, first.y, elevation);
  approximately(recovered.x, x, 0.000001);
  approximately(recovered.y, y, 0.000001);
  assert.ok(Math.hypot(second.x - first.x, second.y - first.y) >= 1);
});
