import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rootedTreeElevation, terrainFacet, treeRoot, TREE_GRID_METERS,
} from '../src/render/terrain-detail.ts';
import { WORLD_SIDE_METERS } from '../src/world/coordinates.ts';

test('rock faces follow the measurements of steep native terrain triangles', () => {
  const rise = [120, 121, 122];
  const gentle = terrainFacet(...rise, 1 / 5, 1 / 5, 5);
  const nearVertical = terrainFacet(240, 120, 125, -120 / 20, 5 / 20, 20);
  const broadlySampled = terrainFacet(240, 120, 125, -120 / 640, 5 / 640, 640);
  const tiny = terrainFacet(124, 120, 122, -4 / 2, 2 / 2, 2);
  assert.equal(gentle.cliff, false);
  assert.equal(nearVertical.cliff, true);
  assert.equal(broadlySampled.cliff, false);
  assert.equal(tiny.cliff, false);
  assert.ok(nearVertical.light < gentle.light);
});

test('forest placements remain metric and deterministic near the world edge', () => {
  const row = Math.floor(WORLD_SIDE_METERS / TREE_GRID_METERS) - 2;
  const first = treeRoot(row, row);
  const adjacent = treeRoot(row + 1, row);
  assert.deepEqual(first, treeRoot(row, row));
  assert.ok(first.canopy >= 6 && first.canopy < 8);
  assert.ok(first.trunk >= 0.75 && first.trunk < 1.2);
  assert.ok(first.height >= 16 && first.height < 23);
  assert.ok(TREE_GRID_METERS >= 16 && TREE_GRID_METERS <= 22);
  assert.ok(adjacent.x - first.x > first.canopy);
});

test('tree roots lie on the same NW–SE triangle as the terrain, above sea and off cliffs', () => {
  assert.equal(rootedTreeElevation(0.75, 0.25, 20, 22, 21, 22, 5, 5), 21.5);
  assert.equal(rootedTreeElevation(0.25, 0.75, 20, 22, 21, 22, 5, 5), 21);
  assert.equal(rootedTreeElevation(0.75, 0.25, 0, 0, 0, 0, 5, 5), null);
  assert.equal(rootedTreeElevation(0.75, 0.25, 100, 160, 100, 160, 5, 5), null);
});
