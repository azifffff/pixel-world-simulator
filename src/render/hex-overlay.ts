import { Graphics, type Container } from 'pixi.js'
import type { CameraController } from '../world/camera.ts'
import {
  clippedHexPolygon, HEX_FLAT_WIDTH_METERS, hexesInBounds, type Bounds, type Hex, type Point,
} from '../world/coordinates.ts'
import type { TerrainSurface } from '../world/surface.ts'

const MAX_GRID_HEXES = 650

function clipSegment(from: Point, to: Point, bounds: Bounds): [Point, Point] | null {
  let start = 0
  let end = 1
  for (const axis of ['x', 'y'] as const) {
    const min = axis === 'x' ? bounds.minX : bounds.minY
    const max = axis === 'x' ? bounds.maxX : bounds.maxY
    const delta = to[axis] - from[axis]
    if (delta === 0) {
      if (from[axis] < min || from[axis] > max) return null
      continue
    }
    const near = (min - from[axis]) / delta
    const far = (max - from[axis]) / delta
    start = Math.max(start, Math.min(near, far))
    end = Math.min(end, Math.max(near, far))
  }
  if (start > end) return null
  const pointAt = (t: number) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
  return [pointAt(start), pointAt(end)]
}

export class HexOverlay {
  private readonly grid = new Graphics()
  private readonly highlight = new Graphics()

  constructor(parent: Container) {
    parent.addChild(this.grid, this.highlight)
  }

  render(
    enabled: boolean, selected: Hex | null, camera: CameraController, surface: TerrainSurface, spacing: number,
    gridDirty: boolean,
  ): void {
    const visible = enabled && Number.isFinite(spacing)
    this.grid.visible = visible
    this.highlight.visible = visible
    if (!visible) return

    this.highlight.clear()
    const bounds = camera.viewBounds()
    const drawn = new Set<string>()
    const sampleStep = Math.min(2_000, spacing * 0.5)

    const drawHex = (graphics: Graphics, { q, r }: Hex, deduplicate: boolean) => {
      const polygon = clippedHexPolygon(q, r, camera.worldSize)
      for (let i = 0; i < polygon.length; i++) {
        const from = polygon[i]
        const to = polygon[(i + 1) % polygon.length]
        if (deduplicate) {
          const edge = [`${from.x},${from.y}`, `${to.x},${to.y}`].sort().join('/')
          if (drawn.has(edge)) continue
          drawn.add(edge)
        }
        const segment = clipSegment(from, to, bounds)
        if (!segment) continue
        const [start, end] = segment
        const dx = end.x - start.x
        const dy = end.y - start.y
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / sampleStep))
        let hasPrevious = false
        for (let index = 0; index <= steps; index++) {
          const x = start.x + dx * index / steps
          const y = start.y + dy * index / steps
          const height = surface.elevationAt(x, y)
          if (height === undefined) {
            hasPrevious = false
            continue
          }
          const point = camera.worldToScreen(x, y, height)
          if (hasPrevious) graphics.lineTo(point.x, point.y)
          else graphics.moveTo(point.x, point.y)
          hasPrevious = true
        }
      }
    }

    const hexPixels = camera.frame.pixelsPerMeter * HEX_FLAT_WIDTH_METERS
    if (gridDirty) {
      this.grid.clear()
      const hexes = hexPixels >= 20 ? hexesInBounds(bounds, MAX_GRID_HEXES) : null
      if (hexes) {
        for (const hex of hexes) drawHex(this.grid, hex, true)
        this.grid.stroke({ color: 0xebeece, width: 1, alpha: 0.44, pixelLine: true })
      }
    }
    if (selected) {
      drawHex(this.highlight, selected, false)
      this.highlight.stroke({ color: 0xffd48b, width: hexPixels >= 5 ? 1.5 : 3, alpha: 0.9 })
    }
  }

  destroy(): void {
    this.grid.destroy()
    this.highlight.destroy()
  }
}
