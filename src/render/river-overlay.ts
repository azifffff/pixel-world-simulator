import { Graphics, type Container } from 'pixi.js'
import type { RiverSegment } from '../terrain/aether-hydrology.ts'
import type { CameraController } from '../world/camera.ts'
import type { TerrainSurface } from '../world/surface.ts'

export const RIVER_LINE_SPACING = 2_560

/** At broad scales, trace narrow channels instead of coloring disconnected sample cells. */
export class RiverOverlay {
  private readonly graphics = new Graphics()

  constructor(parent: Container) {
    parent.addChild(this.graphics)
  }

  render(
    segments: readonly RiverSegment[], camera: CameraController, surface: TerrainSurface,
    spacing: number, colors: boolean,
  ): void {
    const graphics = this.graphics.clear()
    const { pixelsPerMeter } = camera.frame
    const minFlow = spacing >= 163_840 ? 70 : spacing >= 40_960 ? 18 : 6
    for (const { from, to, discharge, halfWidth } of segments) {
      if (discharge < minFlow || !camera.intersects({
        minX: Math.min(from.x, to.x), maxX: Math.max(from.x, to.x),
        minY: Math.min(from.y, to.y), maxY: Math.max(from.y, to.y),
      })) continue

      const count = Math.max(1, Math.min(24, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / spacing)))
      let connected = false
      for (let i = 0; i <= count; i++) {
        const t = i / count
        const x = from.x + (to.x - from.x) * t
        const y = from.y + (to.y - from.y) * t
        const height = surface.elevationAt(x, y)
        if (height === undefined) {
          connected = false
          continue
        }
        const screen = camera.worldToScreen(x, y, height)
        if (connected) graphics.lineTo(screen.x, screen.y)
        else graphics.moveTo(screen.x, screen.y)
        connected = true
      }
      const width = Math.max(discharge >= 100 ? 1.45 : 1, Math.min(5, halfWidth * pixelsPerMeter * 2))
      graphics.stroke({ width, color: colors ? 0x579cae : 0x7d8c98, alpha: 0.92, cap: 'round', join: 'round' })
    }
  }
}
