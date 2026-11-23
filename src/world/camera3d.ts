import { Box3, Frustum, Matrix4, OrthographicCamera, Ray, Vector3 } from 'three'
import {
  clamp, MAX_DISPLAY_ELEVATION, pointInWorld, WORLD_SIDE_METERS, type Bounds, type Point,
} from './coordinates.ts'
import { HEIGHT_SCALE, worldToScene, type RenderOrigin } from './coordinates3d.ts'

export interface Camera3DFrame {
  center: Point
  width: number
  height: number
  pixelsPerMeter: number
  origin: RenderOrigin
}

export interface CameraAnchor extends Point {
  elevation: number
}

interface CameraOrientation {
  bearing: number
  pitch: number
}

const DEFAULT_BEARING = Math.PI / 4
const DEFAULT_PITCH = Math.PI / 6
const MIN_PITCH = 22 * Math.PI / 180
const MAX_PITCH = 76 * Math.PI / 180
const ORBIT_RADIANS_PER_PIXEL = 0.006
const WORLD_FRAME_PADDING = 0.86
const MAX_PIXELS_PER_METER = 2.56
const ORIGIN_INTERVAL = 8_192
const MAX_VISIBLE_ELEVATION = MAX_DISPLAY_ELEVATION + 32

export class Camera3D {
  readonly camera = new OrthographicCamera()
  readonly worldSize: number

  private center: Point
  private origin: RenderOrigin = { x: 0, y: 0 }
  private width = 1
  private height = 1
  private scale = 1
  private minimumScale = 1
  private targetScale = 1
  private yaw = DEFAULT_BEARING
  private tilt = DEFAULT_PITCH
  private zoomAnchor: { screen: Point; world: CameraAnchor } | null = null

  private readonly right = new Vector3()
  private readonly up = new Vector3()
  private readonly outward = new Vector3()
  private readonly target = new Vector3()
  private readonly frustum = new Frustum()
  private readonly viewProjection = new Matrix4()
  private readonly tileBox = new Box3()

  constructor(worldSize = WORLD_SIDE_METERS) {
    this.worldSize = worldSize
    this.center = { x: worldSize / 2, y: worldSize / 2 }
    this.setBasis()
    this.resize(1, 1)
  }

  get frame(): Camera3DFrame {
    return { center: this.center, origin: this.origin, width: this.width, height: this.height, pixelsPerMeter: this.scale }
  }

  get zoom(): number {
    return this.scale / this.minimumScale
  }

  get bearing(): number {
    return this.yaw
  }

  get pitch(): number {
    return this.tilt
  }

  resize(width: number, height: number): void {
    const zoom = this.zoom
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.updateMinimumScale()
    this.scale = clamp(this.minimumScale * zoom, this.minimumScale, this.maximumScale())
    this.stopZoom()
    this.updateCamera()
  }

  reset(): void {
    this.restoreOrientation()
    this.center = { x: this.worldSize / 2, y: this.worldSize / 2 }
    this.scale = this.minimumScale
    this.stopZoom()
    this.updateCamera()
  }

  setView(anchor: CameraAnchor, pixelsPerMeter: number, orientation?: CameraOrientation): void {
    if (orientation) this.setOrientation(orientation.bearing, orientation.pitch)
    this.scale = clamp(pixelsPerMeter, this.minimumScale, this.maximumScale())
    this.anchorAt({ x: this.width / 2, y: this.height / 2 }, anchor)
    this.stopZoom()
    this.updateCamera()
  }

  frameRegion(outline: readonly Point[]): void {
    if (outline.length === 0) return
    this.restoreOrientation()

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const { x, y } of outline) {
      const horizontal = x * this.right.x + y * this.right.z
      const vertical = x * this.up.x + y * this.up.z
      minX = Math.min(minX, horizontal)
      maxX = Math.max(maxX, horizontal)
      minY = Math.min(minY, vertical)
      maxY = Math.max(maxY, vertical)
    }

    const center = this.groundOffset((minX + maxX) / 2, (minY + maxY) / 2, 0)
    this.setCenter(center.x, center.y)
    this.scale = clamp(
      WORLD_FRAME_PADDING * Math.min(this.width / (maxX - minX), this.height / (maxY - minY)),
      this.minimumScale,
      this.maximumScale(),
    )
    this.stopZoom()
    this.updateCamera()
  }

  panBy(deltaScreenX: number, deltaScreenY: number): void {
    this.stopZoom()
    const offset = this.groundOffset(deltaScreenX / this.scale, -deltaScreenY / this.scale, 0)
    this.setCenter(this.center.x - offset.x, this.center.y - offset.y)
    this.updateCamera()
  }

  orbitBy(deltaScreenX: number, deltaScreenY: number, anchor?: CameraAnchor): void {
    const pivot = anchor ? this.worldToScreen(anchor.x, anchor.y, anchor.elevation) : undefined
    const atOverview = this.scale === this.minimumScale
    this.setOrientation(this.yaw + deltaScreenX * ORBIT_RADIANS_PER_PIXEL,
      this.tilt + deltaScreenY * ORBIT_RADIANS_PER_PIXEL)
    this.scale = atOverview ? this.minimumScale : clamp(this.scale, this.minimumScale, this.maximumScale())
    if (anchor && pivot) this.anchorAt(pivot, anchor)
    this.stopZoom()
    this.updateCamera()
  }

  zoomAt(screenX: number, screenY: number, factor: number, anchor?: CameraAnchor): void {
    if (!(factor > 0) || !Number.isFinite(factor)) return
    const target = clamp(this.targetScale * factor, this.minimumScale, this.maximumScale())
    if (target === this.targetScale) return
    this.targetScale = target

    const world = anchor && pointInWorld(anchor.x, anchor.y, this.worldSize) && Number.isFinite(anchor.elevation)
      ? anchor
      : { ...this.screenToWorld(screenX, screenY), elevation: 0 }

    this.zoomAnchor = pointInWorld(world.x, world.y, this.worldSize)
      ? { screen: { x: screenX, y: screenY }, world }
      : { screen: { x: this.width / 2, y: this.height / 2 }, world: { ...this.center, elevation: 0 } }
  }

  step(elapsedMs: number): boolean {
    if (!this.zoomAnchor || !(elapsedMs > 0)) return false
    const progress = 1 - Math.exp(-elapsedMs / 85)
    const distance = Math.log(this.targetScale / this.scale)
    this.scale = Math.abs(distance) < 0.001 ? this.targetScale : this.scale * Math.exp(distance * progress)
    this.anchorAt(this.zoomAnchor.screen, this.zoomAnchor.world)
    if (this.scale === this.targetScale) this.zoomAnchor = null
    this.updateCamera()
    return true
  }

  worldToScreen(x: number, y: number, elevation = 0): Point {
    const east = x - this.center.x
    const south = y - this.center.y
    return {
      x: this.width / 2 + (east * this.right.x + south * this.right.z) * this.scale,
      y: this.height / 2 - (east * this.up.x + south * this.up.z + elevation * HEIGHT_SCALE * this.up.y) * this.scale,
    }
  }

  screenToWorld(screenX: number, screenY: number, elevation = 0): Point {
    const offset = this.groundOffset(
      (screenX - this.width / 2) / this.scale, (this.height / 2 - screenY) / this.scale, elevation,
    )
    return { x: this.center.x + offset.x, y: this.center.y + offset.y }
  }

  rayAt(screenX: number, screenY: number, ray = new Ray()): Ray {
    ray.direction.copy(this.outward).negate()
    ray.origin.copy(this.camera.position)
      .addScaledVector(this.right, (screenX - this.width / 2) / this.scale)
      .addScaledVector(this.up, (this.height / 2 - screenY) / this.scale)
      .addScaledVector(ray.direction, this.camera.near)
    return ray
  }

  viewBounds(): Bounds {
    const halfWidth = this.width / (2 * this.scale)
    const halfHeight = this.height / (2 * this.scale)
    const right = this.groundOffset(halfWidth, 0, 0)
    const top = this.groundOffset(0, halfHeight, 0)
    const high = this.groundOffset(0, 0, MAX_VISIBLE_ELEVATION)
    const extentX = Math.abs(right.x) + Math.abs(top.x)
    const extentY = Math.abs(right.y) + Math.abs(top.y)
    return {
      minX: clamp(this.center.x - extentX + Math.min(0, high.x), 0, this.worldSize),
      minY: clamp(this.center.y - extentY + Math.min(0, high.y), 0, this.worldSize),
      maxX: clamp(this.center.x + extentX + Math.max(0, high.x), 0, this.worldSize),
      maxY: clamp(this.center.y + extentY + Math.max(0, high.y), 0, this.worldSize),
    }
  }

  intersects(bounds: Bounds, minElevation = 0, maxElevation = MAX_VISIBLE_ELEVATION): boolean {
    this.tileBox.min.set(bounds.minX - this.origin.x, minElevation * HEIGHT_SCALE, bounds.minY - this.origin.y)
    this.tileBox.max.set(bounds.maxX - this.origin.x, maxElevation * HEIGHT_SCALE, bounds.maxY - this.origin.y)
    return this.frustum.intersectsBox(this.tileBox)
  }

  private restoreOrientation(): void {
    this.setOrientation(DEFAULT_BEARING, DEFAULT_PITCH)
  }

  private setOrientation(bearing: number, pitch: number): void {
    this.yaw = Math.atan2(Math.sin(bearing), Math.cos(bearing))
    this.tilt = clamp(pitch, MIN_PITCH, MAX_PITCH)
    this.setBasis()
    this.updateMinimumScale()
  }

  private setBasis(): void {
    const east = Math.sin(this.yaw)
    const south = Math.cos(this.yaw)
    const horizontal = Math.cos(this.tilt)
    this.outward.set(east * horizontal, Math.sin(this.tilt), south * horizontal)
    this.right.set(south, 0, -east)
    this.up.crossVectors(this.outward, this.right)
  }

  private updateMinimumScale(): void {
    const horizontal = this.worldSize * (Math.abs(this.right.x) + Math.abs(this.right.z))
    const vertical = this.worldSize * (Math.abs(this.up.x) + Math.abs(this.up.z)) +
      2 * MAX_VISIBLE_ELEVATION * HEIGHT_SCALE * this.up.y
    this.minimumScale = WORLD_FRAME_PADDING * Math.min(this.width / horizontal, this.height / vertical)
  }

  private updateCamera(): void {
    const x = Math.round(this.center.x / ORIGIN_INTERVAL) * ORIGIN_INTERVAL
    const y = Math.round(this.center.y / ORIGIN_INTERVAL) * ORIGIN_INTERVAL
    if (x !== this.origin.x || y !== this.origin.y) this.origin = { x, y }

    const halfWidth = this.width / (2 * this.scale)
    const halfHeight = this.height / (2 * this.scale)
    // At the top and bottom of the viewport, the view ray reaches sea level
    // at different depths. Include the same interval at maximum terrain height.
    const groundReach = halfHeight * this.up.y / this.outward.y
    const highReach = MAX_VISIBLE_ELEVATION * HEIGHT_SCALE / this.outward.y
    const distance = groundReach + highReach + 2
    const camera = this.camera
    camera.left = -halfWidth
    camera.right = halfWidth
    camera.bottom = -halfHeight
    camera.top = halfHeight
    camera.near = 1
    camera.far = distance + groundReach + 1
    worldToScene(this.center.x, this.center.y, 0, this.origin, this.target)
    camera.position.copy(this.target).addScaledVector(this.outward, distance)
    camera.lookAt(this.target)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    this.frustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
  }

  private maximumScale(): number {
    return Math.max(this.minimumScale, MAX_PIXELS_PER_METER)
  }

  private groundOffset(horizontal: number, vertical: number, elevation: number): Point {
    // Offset along the orthographic view plane, then follow its ray to the height plane.
    const distance = (elevation * HEIGHT_SCALE - vertical * this.up.y) / this.outward.y
    return {
      x: horizontal * this.right.x + vertical * this.up.x + distance * this.outward.x,
      y: horizontal * this.right.z + vertical * this.up.z + distance * this.outward.z,
    }
  }

  private anchorAt(screen: Point, world: CameraAnchor): void {
    const offset = this.groundOffset(
      (screen.x - this.width / 2) / this.scale, (this.height / 2 - screen.y) / this.scale, world.elevation,
    )
    this.setCenter(world.x - offset.x, world.y - offset.y)
  }

  private setCenter(x: number, y: number): void {
    this.center = { x: clamp(x, 0, this.worldSize), y: clamp(y, 0, this.worldSize) }
  }

  private stopZoom(): void {
    this.targetScale = this.scale
    this.zoomAnchor = null
  }
}
