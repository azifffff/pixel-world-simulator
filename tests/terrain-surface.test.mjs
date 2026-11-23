import assert from 'node:assert/strict'
import test from 'node:test'
import { TerrainSurface } from '../src/world/surface.ts'

test('surface inspection follows the exact sea cut and reports the unscaled slope', () => {
  const surface = new TerrainSurface()
  surface.setTiles([{
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    xs: Float64Array.of(0, 10), ys: Float64Array.of(0, 10), spacing: 10,
    elevations: Float32Array.of(-5, 15, -5, 25),
  }])
  assert.equal(surface.elevationAt(2, 1), 0)
  assert.equal(surface.elevationAt(1, 1), 0)
  assert.equal(surface.slopeAt(1, 1), 0)
  assert.equal(surface.elevationAt(6, 2), 9)
  assert.equal(surface.slopeAt(6, 2), Math.atan(Math.hypot(2, 1)) * 180 / Math.PI)
  assert.equal(surface.elevationAt(11, 1), undefined)
})
