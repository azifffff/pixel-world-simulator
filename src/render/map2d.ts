import { Application } from 'pixi.js'
import type { RiverSegment } from '../terrain/aether-hydrology.ts'
import { CameraController } from '../world/camera.ts'
import type { Hex, Point } from '../world/coordinates.ts'
import type { WorldPosition } from '../world/coordinates3d.ts'
import type { TerrainTile } from '../world/streaming.ts'
import { TerrainSurface2D } from '../world/surface2d.ts'
import { HexOverlay } from './hex-overlay.ts'
import { RiverOverlay, RIVER_LINE_SPACING } from './river-overlay.ts'
import { TerrainDebugOverlay } from './terrain-debug.ts'
import { TerrainRenderer, type TerrainRenderOptions } from './terrain-renderer.ts'

export interface Map2DOptions extends TerrainRenderOptions {
  readonly hex: boolean
  readonly chunks: boolean
  readonly contours: boolean
}

export class Map2D {
  readonly camera: CameraController
  readonly canvas: HTMLCanvasElement
  private readonly app: Application
  private readonly renderer: TerrainRenderer
  private readonly rivers: RiverOverlay
  private readonly hex: HexOverlay
  private readonly debug: TerrainDebugOverlay
  private readonly surface = new TerrainSurface2D()

  private constructor(app: Application, worldSize: number) {
    this.app = app
    this.camera = new CameraController(worldSize)
    this.canvas = app.canvas
    this.canvas.setAttribute('aria-hidden', 'true')
    this.renderer = new TerrainRenderer(app.stage)
    this.rivers = new RiverOverlay(app.stage)
    this.hex = new HexOverlay(app.stage)
    this.debug = new TerrainDebugOverlay(app.stage)
  }

  static async create(worldSize: number): Promise<Map2D> {
    const app = new Application()
    await app.init({
      autoStart: false,
      preference: 'webgl',
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      backgroundAlpha: 0,
      antialias: false,
      depth: true,
    })
    return new Map2D(app, worldSize)
  }

  resize(width: number, height: number): void {
    if (width === this.camera.frame.width && height === this.camera.frame.height) return
    this.camera.resize(width, height)
    this.app.renderer.resize(width, height)
  }

  pick(screen: Point): WorldPosition | null {
    const position = this.surface.pick(this.camera, screen)
    if (!position) return null
    return { ...position, elevation: this.surface.elevationAt(position.x, position.y) ?? 0 }
  }

  slopeAt(x: number, y: number): number | undefined {
    return this.surface.slopeAt(x, y)
  }

  setTiles(tiles: readonly TerrainTile[]): void {
    this.surface.setTiles(tiles)
  }

  get resourceCount(): number {
    return this.renderer.resourceCount
  }

  draw(
    tiles: readonly TerrainTile[],
    pending: readonly TerrainTile[],
    options: Map2DOptions,
    riverSegments: readonly RiverSegment[],
    selected: Hex | null,
    gridDirty: boolean,
  ): void {
    const spacing = tiles[0]?.spacing ?? Infinity
    if (gridDirty) {
      this.surface.setTiles(tiles)
      this.renderer.setOptions(options)
      this.renderer.render(tiles, this.camera.frame, pending)
      const rivers = options.water && spacing >= RIVER_LINE_SPACING ? riverSegments : []
      this.rivers.render(rivers, this.camera, this.surface, spacing, options.colors)
      this.debug.render(options, this.camera, tiles)
    }
    this.hex.render(options.hex, selected, this.camera, this.surface, spacing, gridDirty)
    this.app.render()
  }

  clear(): void {
    this.surface.setTiles([])
    this.renderer.render([], this.camera.frame)
    this.rivers.clear()
    this.hex.clear()
    this.debug.clear()
    this.app.render()
  }

  destroy(): void {
    this.renderer.destroy()
    this.rivers.destroy()
    this.hex.destroy()
    this.debug.destroy()
    this.app.destroy(true, { children: true })
  }
}
