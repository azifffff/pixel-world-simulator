import { displayHeightAt, sampleTerrainFacet } from '../render3d/terrain-surface.ts'
import type { TerrainTile } from './streaming.ts'

export class TerrainSurface {
  private tiles: readonly TerrainTile[] = []

  setTiles(tiles: readonly TerrainTile[]): void {
    this.tiles = tiles
  }

  elevationAt(x: number, y: number): number | undefined {
    const tile = this.tileAt(x, y)
    return tile ? displayHeightAt(tile, x, y) : undefined
  }

  slopeAt(x: number, y: number): number | undefined {
    const tile = this.tileAt(x, y)
    if (!tile) return undefined
    const { elevation, slopeX, slopeY } = sampleTerrainFacet(tile, x, y)
    return elevation <= 0 ? 0 : Math.atan(Math.hypot(slopeX, slopeY)) * 180 / Math.PI
  }

  private tileAt(x: number, y: number): TerrainTile | undefined {
    return this.tiles.find(({ bounds }) =>
      x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY,
    )
  }
}
