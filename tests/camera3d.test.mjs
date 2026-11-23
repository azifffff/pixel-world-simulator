import assert from 'node:assert/strict';
import test from 'node:test';

import { Camera3D } from '../src/world/camera3d.ts';
import { worldToScene } from '../src/world/coordinates3d.ts';
import { MAX_DISPLAY_ELEVATION, WORLD_SIDE_METERS } from '../src/world/coordinates.ts';

function settle(camera) {
  for (let frame = 0; frame < 120 && camera.step(16); frame += 1) {}
}

function assertPixel(actual, expected, tolerance = 0.000001) {
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < tolerance);
}

function assertRenderedProjection(controller, x, y, elevation) {
  const { origin, width, height } = controller.frame;
  const scenePoint = worldToScene(x, y, elevation, origin);
  const ndc = scenePoint.clone().project(controller.camera);
  assert.ok(ndc.z >= -1 && ndc.z <= 1, 'geometry is inside the renderer depth range');
  const expected = { x: (1 + ndc.x) * width / 2, y: (1 - ndc.y) * height / 2 };
  const projected = controller.worldToScreen(x, y, elevation);
  assertPixel(projected, expected);
  assert.ok(controller.rayAt(projected.x, projected.y).distanceToPoint(scenePoint) < 0.000001);
}

test('orthographic overview contains all world corners and stays framed when tilted', () => {
  const camera = new Camera3D();
  camera.resize(1_280, 800);
  assert.ok(camera.camera.isOrthographicCamera);
  assert.equal(camera.bearing, Math.PI / 4);
  assert.equal(camera.pitch, Math.PI / 6);
  for (const [dragX, dragY] of [[0, 0], [220, 800], [-650, -1500]]) {
    camera.orbitBy(dragX, dragY);
    for (const x of [0, WORLD_SIDE_METERS]) {
      for (const y of [0, WORLD_SIDE_METERS]) {
        for (const elevation of [0, MAX_DISPLAY_ELEVATION]) {
          const point = camera.worldToScreen(x, y, elevation);
          assert.ok(point.x > 0 && point.x < 1_280 && point.y > 0 && point.y < 800);
          assertRenderedProjection(camera, x, y, elevation);
        }
      }
    }
  }
  camera.reset();
  assert.equal(camera.bearing, Math.PI / 4);
  assert.equal(camera.pitch, Math.PI / 6);
  assert.equal(camera.zoom, 1);
});

test('wheel zoom continuously anchors elevated terrain after orbiting', () => {
  const camera = new Camera3D();
  camera.resize(1_284, 824);
  const center = WORLD_SIDE_METERS / 2;
  camera.frameRegion([{ x: center - 2_000, y: center - 3_000 }, { x: center + 2_000, y: center + 3_000 }]);
  camera.orbitBy(201, 74);
  const screen = { x: 792, y: 444 };
  const elevation = 1_420;
  const anchor = { ...camera.screenToWorld(screen.x, screen.y, elevation), elevation };
  const initial = camera.frame.pixelsPerMeter;
  camera.zoomAt(screen.x, screen.y, 2, anchor);
  assert.ok(camera.step(16));
  assert.ok(camera.frame.pixelsPerMeter > initial && camera.frame.pixelsPerMeter < 2 * initial);
  assertPixel(camera.worldToScreen(anchor.x, anchor.y, elevation), screen);
  settle(camera);
  assert.equal(camera.frame.pixelsPerMeter, 2 * initial);
  assertPixel(camera.worldToScreen(anchor.x, anchor.y, elevation), screen);
  assertRenderedProjection(camera, anchor.x, anchor.y, elevation);
});

test('drag maps screen displacement to the ground and clamps at both world edges', () => {
  const camera = new Camera3D();
  camera.resize(1_200, 800);
  camera.zoomAt(600, 400, 10);
  settle(camera);
  camera.orbitBy(117, 67);
  const point = camera.screenToWorld(543, 465);
  camera.panBy(112, -91);
  assertPixel(camera.worldToScreen(point.x, point.y), { x: 655, y: 374 });

  camera.reset();
  camera.panBy(0, -100_000);
  assert.deepEqual(camera.frame.center, { x: WORLD_SIDE_METERS, y: WORLD_SIDE_METERS });
  camera.panBy(0, 100_000);
  assert.deepEqual(camera.frame.center, { x: 0, y: 0 });
});

test('close orbit keeps an elevated rock face centered', () => {
  const camera = new Camera3D();
  camera.resize(1_280, 800);
  const center = WORLD_SIDE_METERS / 2;
  camera.frameRegion([{ x: center - 100, y: center - 100 }, { x: center + 100, y: center + 100 }]);
  const pivot = { x: 640, y: 400 };
  const elevation = 2_400;
  const anchor = { ...camera.screenToWorld(pivot.x, pivot.y, elevation), elevation };
  camera.orbitBy(250, 220, anchor);
  assertPixel(camera.worldToScreen(anchor.x, anchor.y, elevation), pivot);
  assertRenderedProjection(camera, anchor.x, anchor.y, elevation);
});

test('setting an oblique view frames the same elevated point from the chosen orientation', () => {
  const camera = new Camera3D();
  camera.resize(1_280, 800);
  const anchor = { x: 12_696_300, y: 16_609_070, elevation: 2_045 };
  const pivot = { x: 640, y: 400 };
  camera.setView(anchor, 1.5, { bearing: Math.PI / 2, pitch: Math.PI / 5 });
  assert.equal(camera.bearing, Math.PI / 2);
  assert.equal(camera.pitch, Math.PI / 5);
  assert.equal(camera.frame.pixelsPerMeter, 1.5);
  assertPixel(camera.worldToScreen(anchor.x, anchor.y, anchor.elevation), pivot);
  assertRenderedProjection(camera, anchor.x, anchor.y, anchor.elevation);
});

test('floating origin keeps rays accurate at close zoom near the far world edge', () => {
  const camera = new Camera3D();
  camera.resize(1_200, 800);
  const originalOrigin = camera.frame.origin;
  const edge = WORLD_SIDE_METERS;
  camera.frameRegion([{ x: edge - 400, y: edge - 300 }, { x: edge - 200, y: edge - 100 }]);
  assert.notDeepEqual(camera.frame.origin, originalOrigin);
  assert.ok(camera.frame.pixelsPerMeter > 2);
  camera.orbitBy(-220, 32);

  const { center, origin } = camera.frame;
  assert.ok(Math.abs(center.x - origin.x) <= 4_096 && Math.abs(center.y - origin.y) <= 4_096);
  assertRenderedProjection(camera, center.x + 23.005, center.y + 34.011, 41);
  const before = camera.frame.origin;
  camera.panBy(1, -2);
  assert.equal(camera.frame.origin, before);
});

test('rotated viewport includes the highest visible tiles and culls distant ground', () => {
  const camera = new Camera3D();
  camera.resize(1_100, 700);
  const center = WORLD_SIDE_METERS / 2;
  camera.frameRegion([{ x: center - 100, y: center - 100 }, { x: center + 100, y: center + 100 }]);
  camera.orbitBy(321, -10_000);
  const box = camera.viewBounds();
  for (const elevation of [0, MAX_DISPLAY_ELEVATION]) {
    for (const x of [1, 1_099]) {
      for (const y of [1, 699]) {
        const point = camera.screenToWorld(x, y, elevation);
        assert.ok(box.minX <= point.x && point.x <= box.maxX);
        assert.ok(box.minY <= point.y && point.y <= box.maxY);
        assert.ok(camera.intersects({
          minX: point.x - 1, minY: point.y - 1, maxX: point.x + 1, maxY: point.y + 1,
        }, elevation, elevation));
        assertRenderedProjection(camera, point.x, point.y, elevation);
      }
    }
  }
  assert.equal(camera.intersects({ minX: 0, minY: 0, maxX: 640, maxY: 640 }), false);
});

test('zoom over off-map background uses a stable center fallback', () => {
  const camera = new Camera3D();
  camera.resize(1_200, 800);
  const { center } = camera.frame;
  camera.zoomAt(0, 0, 3);
  settle(camera);
  assert.deepEqual(camera.frame.center, center);
});
