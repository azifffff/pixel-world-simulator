import { Vector3 } from 'three'
import type { Point } from './coordinates.ts'

export const HEIGHT_SCALE = 0.77
export type RenderOrigin = Point

export interface WorldPosition extends Point {
  elevation: number
}

export function worldToScene(
  x: number, y: number, elevation: number, origin: RenderOrigin, target = new Vector3(),
): Vector3 {
  return target.set(x - origin.x, elevation * HEIGHT_SCALE, y - origin.y)
}

export function sceneToWorld(point: Vector3, origin: RenderOrigin): WorldPosition {
  return { x: point.x + origin.x, y: point.z + origin.y, elevation: point.y / HEIGHT_SCALE }
}
