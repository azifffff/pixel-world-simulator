import assert from 'node:assert/strict';
import test from 'node:test';

import { CameraController } from '../src/world/camera.ts';
import { WORLD_SIDE_METERS, pointInWorld } from '../src/world/coordinates.ts';
import { TerrainSurface } from '../src/world/surface.ts';

function settle(camera) {
  for (let frame = 0; frame < 120; frame += 1) {
    if (!camera.step(16)) break;
  }
}

test('camera zoom preserves the world point under the cursor as it interpolates', () => {
  const camera = new CameraController();
  camera.resize(1280, 800);
  const cursor = { x: 730, y: 435 };
  const before = camera.screenToWorld(cursor.x, cursor.y);
  const initialZoom = camera.frame.pixelsPerMeter;
  camera.zoomAt(cursor.x, cursor.y, 8);
  camera.step(16);
  assert.ok(camera.frame.pixelsPerMeter > initialZoom && camera.frame.pixelsPerMeter < initialZoom * 8);
  const during = camera.screenToWorld(cursor.x, cursor.y);
  assert.ok(Math.hypot(during.x - before.x, during.y - before.y) < 0.001);

  settle(camera);
  const after = camera.screenToWorld(cursor.x, cursor.y);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 0.001);
  assert.ok(Math.abs(camera.frame.pixelsPerMeter / initialZoom - 8) < 0.001);
});

test('camera drag follows the pointer and clamps its center at the distant world edge', () => {
  const camera = new CameraController();
  camera.resize(1300, 820);
  camera.zoomAt(650, 410, 20);
  settle(camera);
  const tracked = camera.screenToWorld(650, 410);
  camera.panBy(125, -85);
  settle(camera);
  const moved = camera.worldToScreen(tracked.x, tracked.y);
  assert.ok(Math.hypot(moved.x - 775, moved.y - 325) < 0.001);

  camera.panBy(0, -100_000_000);
  settle(camera);
  const { x, y } = camera.frame.center;
  assert.ok(pointInWorld(x, y));
  assert.ok(x > WORLD_SIDE_METERS * 0.95 && y > WORLD_SIDE_METERS * 0.95);
  const viewport = camera.viewBounds();
  assert.ok(viewport.minX >= 0 && viewport.minY >= 0);
  assert.ok(viewport.maxX <= WORLD_SIDE_METERS && viewport.maxY <= WORLD_SIDE_METERS);
});

test('screen picking resolves the rendered relief in a partial tile at the far corner', () => {
  const camera = new CameraController();
  camera.resize(1280, 800);
  camera.panBy(0, -100_000_000);
  camera.zoomAt(640, 400, 1_000_000);
  settle(camera);

  const origin = WORLD_SIDE_METERS - 95;
  const axis = new Float64Array([origin, origin + 60, WORLD_SIDE_METERS]);
  const elevations = Float32Array.from([260, 277, 295, 280, 300, 312, 305, 310, 319]);
  const surface = new TerrainSurface();
  surface.setTiles([{
    bounds: { minX: origin, minY: origin, maxX: WORLD_SIDE_METERS, maxY: WORLD_SIDE_METERS },
    xs: axis,
    ys: axis,
    spacing: 60,
    elevations,
  }]);

  for (const [dx, dy, elevation] of [[45, 15, 278.5], [15, 45, 280], [74, 81, 309.6]]) {
    const x = origin + dx;
    const y = origin + dy;
    assert.ok(Math.abs(surface.elevationAt(x, y) - elevation) < 0.01);
    const screen = camera.worldToScreen(x, y, elevation);
    const selected = surface.pick(camera, screen);
    assert.ok(selected && Math.hypot(selected.x - x, selected.y - y) < 0.001);
  }
  assert.equal(surface.pick(camera, { x: 10, y: 795 }), null);
});
