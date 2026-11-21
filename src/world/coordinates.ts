export const WORLD_AREA_KM2 = 1_530_000_000
export const WORLD_SIDE_METERS = Math.sqrt(WORLD_AREA_KM2) * 1_000
export const HEX_FLAT_WIDTH_METERS = 20_000
export const HEX_RADIUS_METERS = HEX_FLAT_WIDTH_METERS / Math.sqrt(3)
export const HEX_AREA_KM2 = Math.sqrt(3) * HEX_FLAT_WIDTH_METERS ** 2 / 2_000_000
export const CELL_SIZE_METERS = 5
export const CHUNK_SIZE_METERS = CELL_SIZE_METERS * 128
export const MAX_DISPLAY_ELEVATION = 5_000

const HEX_HALF_WIDTH = HEX_FLAT_WIDTH_METERS / 2
const HEX_HALF_RADIUS = HEX_RADIUS_METERS / 2
const HEX_ROW_HEIGHT = HEX_RADIUS_METERS * 1.5
const ISO_X = Math.SQRT1_2
const ISO_Y = Math.SQRT1_2 * 0.5
const ISO_HEIGHT = 0.45

export interface Point {
  x: number
  y: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface Hex {
  q: number
  r: number
}

const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
]
const HEX_CORNERS: readonly Point[] = [
  { x: 0, y: -2 }, { x: 1, y: -1 }, { x: 1, y: 1 },
  { x: 0, y: 2 }, { x: -1, y: 1 }, { x: -1, y: -1 },
]

export function pointInWorld(x: number, y: number, worldSize = WORLD_SIDE_METERS): boolean {
  return x >= 0 && x <= worldSize && y >= 0 && y <= worldSize
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function hexToWorld(q: number, r: number): Point {
  return { x: (2 * q + r) * HEX_HALF_WIDTH, y: 3 * r * HEX_HALF_RADIUS }
}

export function worldToHex(x: number, y: number): Hex {
  const r = y / HEX_ROW_HEIGHT
  const q = x / HEX_FLAT_WIDTH_METERS - r / 2
  const s = -q - r
  let nearestQ = Math.round(q)
  let nearestR = Math.round(r)
  const nearestS = Math.round(s)
  const qError = Math.abs(nearestQ - q)
  const rError = Math.abs(nearestR - r)
  const sError = Math.abs(nearestS - s)

  if (qError > rError && qError > sError) {
    nearestQ = -nearestR - nearestS
  } else if (rError > sError) {
    nearestR = -nearestQ - nearestS
  }

  return { q: nearestQ || 0, r: nearestR || 0 }
}

export function hexNeighbors(q: number, r: number): Hex[] {
  return HEX_DIRECTIONS.map((direction) => ({ q: q + direction.q, r: r + direction.r }))
}

function clipAxis(polygon: Point[], axis: 'x' | 'y', boundary: number, side: number): Point[] {
  const clipped: Point[] = []
  if (polygon.length === 0) return clipped
  let previous = polygon[polygon.length - 1]
  let previousInside = (previous[axis] - boundary) * side >= 0

  for (const point of polygon) {
    const inside = (point[axis] - boundary) * side >= 0
    if (inside !== previousInside) {
      const t = (boundary - previous[axis]) / (point[axis] - previous[axis])
      const other = axis === 'x' ? 'y' : 'x'
      clipped.push({ ...previous, [axis]: boundary, [other]: previous[other] + t * (point[other] - previous[other]) })
    }
    if (inside) clipped.push(point)
    previous = point
    previousInside = inside
  }

  return clipped.filter((point, index) => {
    const neighbor = clipped[(index + 1) % clipped.length]
    return point.x !== neighbor.x || point.y !== neighbor.y
  })
}

export function clippedHexPolygon(q: number, r: number, worldSize = WORLD_SIDE_METERS): Point[] {
  let polygon = HEX_CORNERS.map((corner) => ({
    x: (2 * q + r + corner.x) * HEX_HALF_WIDTH,
    y: (3 * r + corner.y) * HEX_HALF_RADIUS,
  }))
  polygon = clipAxis(polygon, 'x', 0, 1)
  polygon = clipAxis(polygon, 'x', worldSize, -1)
  polygon = clipAxis(polygon, 'y', 0, 1)
  polygon = clipAxis(polygon, 'y', worldSize, -1)
  return polygon.length >= 3 ? polygon : []
}

export function hexesInBounds(bounds: Bounds, limit: number): Hex[] | null {
  const firstR = Math.ceil((bounds.minY - HEX_RADIUS_METERS) / HEX_ROW_HEIGHT)
  const lastR = Math.floor((bounds.maxY + HEX_RADIUS_METERS) / HEX_ROW_HEIGHT)
  const hexes: Hex[] = []

  for (let r = firstR; r <= lastR; r++) {
    const firstQ = Math.ceil((bounds.minX - HEX_HALF_WIDTH) / HEX_FLAT_WIDTH_METERS - r / 2)
    const lastQ = Math.floor((bounds.maxX + HEX_HALF_WIDTH) / HEX_FLAT_WIDTH_METERS - r / 2)
    if (hexes.length + lastQ - firstQ + 1 > limit) return null
    for (let q = firstQ; q <= lastQ; q++) hexes.push({ q, r })
  }
  return hexes
}

function worldToGrid(x: number, y: number, size: number, worldSize: number): Point | null {
  if (!pointInWorld(x, y, worldSize)) return null
  const last = Math.ceil(worldSize / size) - 1
  return { x: Math.min(last, Math.floor(x / size)), y: Math.min(last, Math.floor(y / size)) }
}

export function worldToChunk(x: number, y: number, worldSize = WORLD_SIDE_METERS): Point | null {
  return worldToGrid(x, y, CHUNK_SIZE_METERS, worldSize)
}

export function worldToCell(x: number, y: number, worldSize = WORLD_SIDE_METERS): Point | null {
  return worldToGrid(x, y, CELL_SIZE_METERS, worldSize)
}

export function surfaceElevation(elevation: number): number {
  return clamp(elevation, 0, MAX_DISPLAY_ELEVATION)
}

export function projectIsometric(x: number, y: number, elevation = 0): Point {
  return { x: (x - y) * ISO_X, y: (x + y) * ISO_Y - elevation * ISO_HEIGHT }
}

export function unprojectIsometric(x: number, y: number, elevation = 0): Point {
  const difference = x / ISO_X
  const sum = (y + elevation * ISO_HEIGHT) / ISO_Y
  return { x: (sum + difference) / 2, y: (sum - difference) / 2 }
}
