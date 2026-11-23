import assert from 'node:assert/strict';
import test from 'node:test';
import { Object3D, Scene } from 'three';
import {
  buildTileContours, clipLine, drapeTileLine, drawChunkLines,
} from '../src/render3d/overlay-geometry.ts';
import { TerrainOverlays3D } from '../src/render3d/overlays.ts';
import { rawHeightAt } from '../src/render3d/terrain-surface.ts';
import { HEIGHT_SCALE } from '../src/world/coordinates3d.ts';

function tile(xs, ys, elevations, spacing = 10) {
  return {
    bounds: { minX: xs[0], minY: ys[0], maxX: xs.at(-1), maxY: ys.at(-1) },
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    elevations: Float32Array.from(elevations),
    spacing,
  };
}

function drape(terrain, from, to) {
  const points = [];
  assert.equal(drapeTileLine(terrain, from, to, (a, b) => {
    points.push([a.x, a.y, a.elevation, b.x, b.y, b.elevation]);
    return true;
  }), true);
  return points;
}

test('a draped line bends at the exact surface triangle and the signed sea crossing', () => {
  const ridge = tile([0, 10], [0, 10], [-10, 10, 80, 50]);
  assert.deepEqual(drape(ridge, { x: 0, y: 4 }, { x: 10, y: 4 }), [
    [0, 4, 26, 4, 4, 14], [4, 4, 14, 10, 4, 26],
  ]);

  const shore = tile([0, 10], [0, 10], [-20, 20, -20, 20]);
  const points = drape(shore, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.deepEqual(points, [[0, 0, 0, 5, 0, 0], [5, 0, 0, 10, 0, 20]]);
});

test('neighboring draped segments weld on a clipped tile edge at distant coordinates', () => {
  const origin = 31_940_502;
  const a = tile([origin, origin + 10], [origin, origin + 10], [1, 3, 5, 7]);
  const b = tile([origin + 10, origin + 17], [origin, origin + 10], [3, 6, 7, 10]);
  const from = { x: origin - 20, y: origin + 3 };
  const to = { x: origin + 30, y: origin + 3 };
  const left = drape(a, ...clipLine(from, to, a.bounds));
  const right = drape(b, ...clipLine(from, to, b.bounds));
  assert.deepEqual(left.at(-1).slice(3), right[0].slice(0, 3));
  assert.deepEqual(right.at(-1).slice(3), [origin + 17, origin + 3, 7.2]);
});

test('contours remain on the signed surface and respect their segment budget', () => {
  const origin = 5_000_000;
  const terrain = tile([origin, origin + 10], [origin, origin + 10], [-25, 30, 60, 99]);
  const segments = buildTileContours(terrain, 25, 12);
  assert.ok(segments.length >= 15);
  for (let i = 0; i < segments.length; i += 5) {
    const elevation = segments[i + 4];
    assert.ok(elevation >= 25 && elevation % 25 === 0);
    for (const endpoint of [0, 2]) {
      const actual = rawHeightAt(terrain, origin + segments[i + endpoint], origin + segments[i + endpoint + 1]);
      assert.ok(Math.abs(actual - elevation) < 0.00001, String(actual));
    }
  }
  assert.equal(buildTileContours(terrain, 1, 2), null);
});

test('chunk seams and the outside boundary have single line ownership', () => {
  const a = tile([0, 640], [0, 600], [0, 50, 10, 60], 640);
  const b = tile([640, 1_200], [0, 600], [50, 80, 60, 90], 640);
  const edges = [];
  assert.equal(drawChunkLines([a, b], 1_200, (from, to) => {
    if (from.x === to.x) edges.push(from.x);
    return true;
  }, 30), true);
  assert.deepEqual(edges, [0, 640, 1_200]);
  assert.equal(drawChunkLines([a, b], 1_200, () => true, 1), false);
});

test('overlay batches are reused when the camera rebases and freed on replacement', () => {
  const scene = new Scene();
  const overlay = new TerrainOverlays3D(scene);
  const terrain = tile([0, 10, 20], [0, 10, 20], [0, 40, 70, 0, 20, 60, 0, 40, 80]);
  const options = { hex: true, chunks: true, contours: true };
  const camera = {
    frame: { origin: { x: 0, y: 0 }, pixelsPerMeter: 0.5 },
    camera: { near: 1, far: 2_000 },
    worldSize: 20,
  };

  overlay.render(options, { q: 0, r: 0 }, camera, [terrain]);
  const contours = scene.getObjectByName('terrain-contours');
  assert.ok(contours instanceof Object3D && contours.visible);
  assert.equal(contours.material.depthTest, true);
  assert.equal(contours.material.depthWrite, false);
  const original = contours.geometry;
  const firstHeight = original.getAttribute('position').getY(0);
  assert.ok(Math.abs(firstHeight - HEIGHT_SCALE * 10) < 0.00001);

  camera.frame.origin = { x: 8192, y: 8192 };
  overlay.render(options, { q: 0, r: 0 }, camera, [terrain]);
  assert.equal(contours.geometry, original);
  assert.equal(contours.position.x, -8192);
  assert.equal(contours.position.z, -8192);

  let disposed = false;
  original.addEventListener('dispose', () => { disposed = true; });
  overlay.render(options, { q: 0, r: 0 }, camera, [{ ...terrain }]);
  assert.notEqual(contours.geometry, original);
  assert.equal(disposed, true);

  overlay.destroy();
  assert.equal(scene.children.length, 0);
});
