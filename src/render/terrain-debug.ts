import { Graphics, type Container } from 'pixi.js'
import type { CameraController } from '../world/camera.ts'
import { CHUNK_SIZE_METERS, MAX_DISPLAY_ELEVATION, surfaceElevation, type Point } from '../world/coordinates.ts'
import type { TerrainTile } from '../world/streaming.ts'

const MIN_CHUNK_PIXELS = 18
const MAX_CHUNK_SEGMENTS = 18_000
const MAX_CONTOUR_SEGMENTS = 10_000
const CONTOUR_STRIDE = 5

interface DebugOptions {
  chunks: boolean
  contours: boolean
}

interface Vertex extends Point {
  elevation: number
}

interface CachedContours {
  interval: number
  segments: Float32Array | null
}

function segmentDrawer(graphics: Graphics, camera: CameraController) {
  const { width, height } = camera.frame
  return (from: Point, to: Point): void => {
    if (
      Math.max(from.x, to.x) < -1 || Math.min(from.x, to.x) > width + 1 ||
      Math.max(from.y, to.y) < -1 || Math.min(from.y, to.y) > height + 1
    ) return
    graphics.moveTo(from.x, from.y).lineTo(to.x, to.y)
  }
}

function chunkAxes(axis: Float64Array, worldSize: number): number[] {
  const last = axis.length - 1
  const result: number[] = []
  for (let i = 0; i <= last; i++) {
    if (i === last) {
      // The adjacent tile owns this edge unless it is the outer edge of the world.
      if (axis[i] === worldSize) result.push(i)
    } else if (axis[i] % CHUNK_SIZE_METERS === 0) {
      result.push(i)
    }
  }
  return result
}

function drawChunkBoundaries(graphics: Graphics, camera: CameraController, tiles: readonly TerrainTile[]): void {
  if (camera.frame.pixelsPerMeter * CHUNK_SIZE_METERS < MIN_CHUNK_PIXELS) return
  const boundaries = tiles.filter((tile) => tile.spacing <= CHUNK_SIZE_METERS).map((tile) => ({
    tile,
    columns: chunkAxes(tile.xs, camera.worldSize),
    rows: chunkAxes(tile.ys, camera.worldSize),
  }))
  const segmentCount = boundaries.reduce((sum, { tile, columns, rows }) =>
    sum + columns.length * (tile.ys.length - 1) + rows.length * (tile.xs.length - 1), 0)
  if (segmentCount > MAX_CHUNK_SEGMENTS) return

  const drawSegment = segmentDrawer(graphics, camera)
  for (const { tile, columns, rows } of boundaries) {
    const { xs, ys, elevations } = tile
    const project = (column: number, row: number) => camera.worldToScreen(
      xs[column], ys[row], surfaceElevation(elevations[row * xs.length + column]),
    )
    for (const column of columns) {
      let previous = project(column, 0)
      for (let row = 1; row < ys.length; row++) {
        const next = project(column, row)
        drawSegment(previous, next)
        previous = next
      }
    }
    for (const row of rows) {
      let previous = project(0, row)
      for (let column = 1; column < xs.length; column++) {
        const next = project(column, row)
        drawSegment(previous, next)
        previous = next
      }
    }
  }
  graphics.stroke({ color: 0xffe2aa, width: 1, alpha: 0.48, pixelLine: true })
}

function interpolateLevel(from: Vertex, to: Vertex, elevation: number): Point {
  const fraction = (elevation - from.elevation) / (to.elevation - from.elevation)
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction }
}

function appendContours(result: number[], a: Vertex, b: Vertex, c: Vertex, interval: number): void {
  const minimum = Math.min(a.elevation, b.elevation, c.elevation)
  const maximum = Math.max(a.elevation, b.elevation, c.elevation)
  const first = Math.max(interval, (Math.floor(minimum / interval) + 1) * interval)
  for (let elevation = first; elevation <= maximum; elevation += interval) {
    const aAbove = a.elevation >= elevation
    const bAbove = b.elevation >= elevation
    const cAbove = c.elevation >= elevation
    // Both crossings connect the vertex on its own side of the level to the other two.
    const [vertex, edgeA, edgeB] = bAbove === cAbove ? [a, b, c]
      : aAbove === cAbove ? [b, a, c] : [c, a, b]
    const from = interpolateLevel(vertex, edgeA, elevation)
    const to = interpolateLevel(vertex, edgeB, elevation)
    if (from.x !== to.x || from.y !== to.y) result.push(from.x, from.y, to.x, to.y, elevation)
  }
}

function buildTileContours(tile: TerrainTile, interval: number): Float32Array | null {
  const { xs, ys, elevations, bounds } = tile
  const segments: number[] = []
  const vertex = (column: number, row: number, elevation: number): Vertex => ({
    x: xs[column] - bounds.minX,
    y: ys[row] - bounds.minY,
    elevation,
  })
  for (let row = 0; row + 1 < ys.length; row++) {
    for (let column = 0; column + 1 < xs.length; column++) {
      const index = row * xs.length + column
      const znw = surfaceElevation(elevations[index])
      const zne = surfaceElevation(elevations[index + 1])
      const zsw = surfaceElevation(elevations[index + xs.length])
      const zse = surfaceElevation(elevations[index + xs.length + 1])
      const minimum = Math.min(znw, zne, zsw, zse)
      const maximum = Math.max(znw, zne, zsw, zse)
      if (Math.floor(minimum / interval) === Math.floor(maximum / interval)) continue
      const nw = vertex(column, row, znw)
      const ne = vertex(column + 1, row, zne)
      const sw = vertex(column, row + 1, zsw)
      const se = vertex(column + 1, row + 1, zse)
      appendContours(segments, nw, ne, se, interval)
      appendContours(segments, nw, se, sw, interval)
      if (segments.length / CONTOUR_STRIDE > MAX_CONTOUR_SEGMENTS) return null
    }
  }
  return Float32Array.from(segments)
}

function contourInterval(spacing: number): number {
  if (spacing >= 40_960) return 1_000
  if (spacing >= 5_120) return 500
  if (spacing >= 320) return 200
  if (spacing >= 40) return 50
  return 10
}

export class TerrainDebugOverlay {
  private readonly chunks = new Graphics()
  private readonly contours = new Graphics()
  private readonly contourCache = new WeakMap<TerrainTile, CachedContours>()

  constructor(parent: Container) {
    parent.addChild(this.contours, this.chunks)
  }

  render(options: DebugOptions, camera: CameraController, tiles: readonly TerrainTile[]): void {
    this.chunks.visible = options.chunks
    this.contours.visible = options.contours
    if (options.chunks) drawChunkBoundaries(this.chunks.clear(), camera, tiles)
    if (options.contours) this.drawContours(this.contours.clear(), camera, tiles)
  }

  destroy(): void {
    this.chunks.destroy()
    this.contours.destroy()
  }

  private drawContours(graphics: Graphics, camera: CameraController, tiles: readonly TerrainTile[]): void {
    if (tiles.length === 0) return
    let interval = contourInterval(tiles[0].spacing)
    const drawSegment = segmentDrawer(graphics, camera)
    while (interval <= MAX_DISPLAY_ELEVATION) {
      const prepared = this.prepareContours(tiles, interval)
      if (prepared) {
        for (const { tile, segments } of prepared) {
          const origin = tile.bounds
          for (let i = 0; i < segments.length; i += CONTOUR_STRIDE) {
            const elevation = segments[i + 4]
            const from = camera.worldToScreen(origin.minX + segments[i], origin.minY + segments[i + 1], elevation)
            const to = camera.worldToScreen(origin.minX + segments[i + 2], origin.minY + segments[i + 3], elevation)
            drawSegment(from, to)
          }
        }
        graphics.stroke({ color: 0x584633, width: 1, alpha: 0.62, pixelLine: true })
        return
      }
      // Keep the interval consistent across tile edges if the viewport needs fewer lines.
      interval *= 2
    }
  }

  private prepareContours(tiles: readonly TerrainTile[], interval: number) {
    const prepared: { tile: TerrainTile; segments: Float32Array }[] = []
    let count = 0
    for (const tile of tiles) {
      const cached = this.contourCache.get(tile)
      const segments = cached?.interval === interval ? cached.segments : buildTileContours(tile, interval)
      if (cached?.interval !== interval) this.contourCache.set(tile, { interval, segments })
      if (!segments) return null
      count += segments.length / CONTOUR_STRIDE
      if (count > MAX_CONTOUR_SEGMENTS) return null
      prepared.push({ tile, segments })
    }
    return prepared
  }
}
