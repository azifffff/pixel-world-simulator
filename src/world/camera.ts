import {
  clamp, MAX_DISPLAY_ELEVATION, projectIsometric, unprojectIsometric, WORLD_SIDE_METERS,
  type Bounds, type Point,
} from './coordinates.ts'

export interface CameraFrame {
  center: Point
  width: number
  height: number
  pixelsPerMeter: number
}

const MAX_PIXELS_PER_METER = 2.56
const WORLD_FRAME_PADDING = 0.86
const RELIEF_OFFSET = unprojectIsometric(0, 0, MAX_DISPLAY_ELEVATION).x

export class CameraController {
  readonly worldSize: number
  private center: Point
  private width = 1
  private height = 1
  private scale = 1
  private minimumScale = 1
  private targetScale = 1
  private zoomAnchor: { screen: Point; world: Point } | null = null

  constructor(worldSize = WORLD_SIDE_METERS) {
    this.worldSize = worldSize
    this.center = { x: worldSize / 2, y: worldSize / 2 }
    this.resize(1, 1)
  }

  get frame(): CameraFrame {
    return { center: this.center, width: this.width, height: this.height, pixelsPerMeter: this.scale }
  }

  get zoom(): number {
    return this.scale / this.minimumScale
  }

  resize(width: number, height: number): void {
    const zoom = this.zoom
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    const horizontalSize = projectIsometric(this.worldSize, 0).x * 2
    const verticalSize = projectIsometric(this.worldSize, this.worldSize).y
    this.minimumScale = WORLD_FRAME_PADDING * Math.min(this.width / horizontalSize, this.height / verticalSize)
    this.scale = clamp(this.minimumScale * zoom, this.minimumScale, this.maximumScale())
    this.stopZoom()
  }

  reset(): void {
    this.center = { x: this.worldSize / 2, y: this.worldSize / 2 }
    this.scale = this.minimumScale
    this.stopZoom()
  }

  frameRegion(outline: readonly Point[]): void {
    if (outline.length === 0) return
    const projected = outline.map(({ x, y }) => projectIsometric(x, y))
    const minX = Math.min(...projected.map(({ x }) => x))
    const maxX = Math.max(...projected.map(({ x }) => x))
    const minY = Math.min(...projected.map(({ y }) => y))
    const maxY = Math.max(...projected.map(({ y }) => y))
    const center = unprojectIsometric((minX + maxX) / 2, (minY + maxY) / 2)
    const scale = WORLD_FRAME_PADDING * Math.min(this.width / (maxX - minX), this.height / (maxY - minY))
    this.setCenter(center.x, center.y)
    this.scale = clamp(scale, this.minimumScale, this.maximumScale())
    this.stopZoom()
  }

  panBy(deltaScreenX: number, deltaScreenY: number): void {
    this.stopZoom()
    const offset = unprojectIsometric(deltaScreenX / this.scale, deltaScreenY / this.scale)
    this.setCenter(this.center.x - offset.x, this.center.y - offset.y)
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    const target = clamp(this.targetScale * factor, this.minimumScale, this.maximumScale())
    if (!Number.isFinite(target) || target === this.targetScale) return
    this.targetScale = target
    this.zoomAnchor = {
      screen: { x: screenX, y: screenY },
      world: this.screenToWorld(screenX, screenY),
    }
  }

  step(elapsedMs: number): boolean {
    if (!this.zoomAnchor || elapsedMs <= 0) return false
    const progress = 1 - Math.exp(-elapsedMs / 85)
    const distance = Math.log(this.targetScale / this.scale)
    this.scale = Math.abs(distance) < 0.001 ? this.targetScale : this.scale * Math.exp(distance * progress)
    const { screen, world } = this.zoomAnchor
    const offset = this.screenOffset(screen.x, screen.y)
    this.setCenter(world.x - offset.x, world.y - offset.y)
    if (this.zoom === 1) this.reset()
    else if (this.scale === this.targetScale) this.zoomAnchor = null
    return true
  }

  worldToScreen(x: number, y: number, elevation = 0): Point {
    const relative = projectIsometric(x - this.center.x, y - this.center.y, elevation)
    return {
      x: this.width / 2 + relative.x * this.scale,
      y: this.height / 2 + relative.y * this.scale,
    }
  }

  screenToWorld(x: number, y: number, elevation = 0): Point {
    const relative = this.screenOffset(x, y, elevation)
    return { x: this.center.x + relative.x, y: this.center.y + relative.y }
  }

  viewBounds(): Bounds {
    const horizontal = this.width / (2 * this.scale)
    const vertical = this.height / (2 * this.scale)
    const radius = unprojectIsometric(horizontal, vertical).x
    return {
      minX: clamp(this.center.x - radius, 0, this.worldSize),
      minY: clamp(this.center.y - radius, 0, this.worldSize),
      maxX: clamp(this.center.x + radius + RELIEF_OFFSET, 0, this.worldSize),
      maxY: clamp(this.center.y + radius + RELIEF_OFFSET, 0, this.worldSize),
    }
  }

  intersects(bounds: Bounds, minElevation = 0, maxElevation = MAX_DISPLAY_ELEVATION): boolean {
    const left = this.worldToScreen(bounds.minX, bounds.maxY).x
    const right = this.worldToScreen(bounds.maxX, bounds.minY).x
    const top = this.worldToScreen(bounds.minX, bounds.minY, maxElevation).y
    const bottom = this.worldToScreen(bounds.maxX, bounds.maxY, minElevation).y
    return right >= -1 && left <= this.width + 1 && bottom >= -1 && top <= this.height + 1
  }

  private maximumScale(): number {
    return Math.max(this.minimumScale, MAX_PIXELS_PER_METER)
  }

  private screenOffset(x: number, y: number, elevation = 0): Point {
    return unprojectIsometric(
      (x - this.width / 2) / this.scale, (y - this.height / 2) / this.scale, elevation,
    )
  }

  private setCenter(x: number, y: number): void {
    this.center = { x: clamp(x, 0, this.worldSize), y: clamp(y, 0, this.worldSize) }
  }

  private stopZoom(): void {
    this.targetScale = this.scale
    this.zoomAnchor = null
  }
}
