import assert from 'node:assert/strict'
import test from 'node:test'
import { CameraController } from '../src/world/camera.ts'
import { Camera3D } from '../src/world/camera3d.ts'
import { WORLD_SIDE_METERS } from '../src/world/coordinates.ts'

test('switching maps keeps the elevated world focus and meters per pixel near the edge', () => {
  const ortho = new Camera3D()
  const iso = new CameraController()
  const anchor = { x: WORLD_SIDE_METERS - 691, y: WORLD_SIDE_METERS - 1339, elevation: 625 }
  for (const camera of [ortho, iso]) camera.resize(1300, 820)
  ortho.orbitBy(130, 50)
  ortho.setView(anchor, 1.2)
  iso.setView(anchor, ortho.frame.pixelsPerMeter)
  for (const camera of [ortho, iso]) {
    assert.equal(camera.frame.pixelsPerMeter, 1.2)
    const { x, y } = camera.worldToScreen(anchor.x, anchor.y, anchor.elevation)
    assert.ok(Math.abs(x - 650) < 0.0001 && Math.abs(y - 410) < 0.0001)
  }
  ortho.setView(anchor, iso.frame.pixelsPerMeter)
  assert.ok(Math.abs(ortho.worldToScreen(anchor.x, anchor.y, anchor.elevation).y - 410) < 0.0001)
  assert.ok(ortho.bearing > 1.5)
})
