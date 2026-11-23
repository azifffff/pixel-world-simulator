import { clamp, MAX_DISPLAY_ELEVATION, surfaceElevation, unprojectIsometric, type Point } from './coordinates.ts'
import type { CameraController } from './camera.ts'
import type { TerrainTile } from './streaming.ts'

const RAY_METERS_PER_HEIGHT = unprojectIsometric(0, 0, 1).x
const RAY_LIMIT = MAX_DISPLAY_ELEVATION * RAY_METERS_PER_HEIGHT

function cellIndex(coordinate: number, axis: Float64Array, spacing: number): number {
  return clamp(Math.floor((coordinate - axis[0]) / spacing), 0, axis.length - 2)
}

function getCell(tile: TerrainTile, column: number, row: number) {
  const index = row * tile.xs.length + column
  return {
    x: tile.xs[column],
    y: tile.ys[row],
    width: tile.xs[column + 1] - tile.xs[column],
    height: tile.ys[row + 1] - tile.ys[row],
    nw: surfaceElevation(tile.elevations[index]),
    ne: surfaceElevation(tile.elevations[index + 1]),
    sw: surfaceElevation(tile.elevations[index + tile.xs.length]),
    se: surfaceElevation(tile.elevations[index + tile.xs.length + 1]),
  }
}

function hitCell(
  cell: ReturnType<typeof getCell>, base: Point, start: number, end: number,
): number {
  const dx = (base.x + start - cell.x) / cell.width
  const dy = (base.y + start - cell.y) / cell.height
  const rayElevation = start / RAY_METERS_PER_HEIGHT
  let nearest = -1

  // Two planes per grid cell, split along the same NW–SE diagonal as the mesh.
  for (const upper of [true, false]) {
    const slopeX = upper ? cell.ne - cell.nw : cell.se - cell.sw
    const slopeY = upper ? cell.se - cell.ne : cell.sw - cell.nw
    const elevation = cell.nw + slopeX * dx + slopeY * dy
    const derivative = 1 / RAY_METERS_PER_HEIGHT - slopeX / cell.width - slopeY / cell.height
    if (Math.abs(derivative) < 1e-10) continue

    const distance = (elevation - rayElevation) / derivative
    if (distance < -1e-7 || distance > end - start + 1e-7) continue

    const finalX = dx + distance / cell.width
    const finalY = dy + distance / cell.height
    if (upper ? finalX >= finalY - 1e-7 : finalX <= finalY + 1e-7) {
      nearest = Math.max(nearest, clamp(start + distance, start, end))
    }
  }
  return nearest
}

export class TerrainSurface2D {
  private tiles: readonly TerrainTile[] = []

  setTiles(tiles: readonly TerrainTile[]): void {
    this.tiles = tiles
  }

  elevationAt(x: number, y: number): number | undefined {
    const cell = this.cellAt(x, y)
    if (!cell) return undefined
    const fx = (x - cell.x) / cell.width
    const fy = (y - cell.y) / cell.height
    return fx >= fy
      ? cell.nw + (cell.ne - cell.nw) * fx + (cell.se - cell.ne) * fy
      : cell.nw + (cell.se - cell.sw) * fx + (cell.sw - cell.nw) * fy
  }

  slopeAt(x: number, y: number): number | undefined {
    const cell = this.cellAt(x, y)
    if (!cell) return undefined
    const upper = (x - cell.x) / cell.width >= (y - cell.y) / cell.height
    const riseX = (upper ? cell.ne - cell.nw : cell.se - cell.sw) / cell.width
    const riseY = (upper ? cell.se - cell.ne : cell.sw - cell.nw) / cell.height
    return Math.atan(Math.hypot(riseX, riseY)) * 180 / Math.PI
  }

  private cellAt(x: number, y: number): ReturnType<typeof getCell> | undefined {
    const tile = this.tiles.find(({ bounds }) =>
      x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY,
    )
    if (!tile) return undefined
    return getCell(tile, cellIndex(x, tile.xs, tile.spacing), cellIndex(y, tile.ys, tile.spacing))
  }

  pick(camera: CameraController, screen: Point): Point | null {
    const base = camera.screenToWorld(screen.x, screen.y)
    let nearest = -1
    for (const tile of this.tiles) {
      const { bounds, xs, ys, spacing } = tile
      let entry = Math.max(0, bounds.minX - base.x, bounds.minY - base.y)
      const exit = Math.min(RAY_LIMIT, bounds.maxX - base.x, bounds.maxY - base.y)
      if (exit < entry || exit < nearest) continue

      let column = cellIndex(base.x + entry, xs, spacing)
      let row = cellIndex(base.y + entry, ys, spacing)
      while (entry <= exit && column < xs.length - 1 && row < ys.length - 1) {
        const edgeX = xs[column + 1] - base.x
        const edgeY = ys[row + 1] - base.y
        const next = Math.max(entry, Math.min(edgeX, edgeY, exit))
        const hit = hitCell(getCell(tile, column, row), base, entry, next)
        nearest = Math.max(nearest, hit)
        if (next === exit) break
        if (edgeX <= next) column++
        if (edgeY <= next) row++
        entry = next
      }
    }
    if (nearest < 0) return null
    return {
      x: clamp(base.x + nearest, 0, camera.worldSize),
      y: clamp(base.y + nearest, 0, camera.worldSize),
    }
  }
}
