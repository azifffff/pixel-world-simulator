import { Application } from 'pixi.js'
import { HexOverlay } from './render/hex-overlay.ts'
import { RiverOverlay, RIVER_LINE_SPACING } from './render/river-overlay.ts'
import { TerrainDebugOverlay } from './render/terrain-debug.ts'
import { TerrainRenderer } from './render/terrain-renderer.ts'
import {
  createWorldMetadata, DEFAULT_AETHER_CONFIG, loadActiveWorld, type WorldStorage,
} from './terrain/index.ts'
import { createInterface, type MapLayer } from './ui.ts'
import { CameraController } from './world/camera.ts'
import { clamp, worldToChunk, worldToHex, type Point } from './world/coordinates.ts'
import type { StreamFrame } from './world/streaming.ts'
import { TerrainSurface } from './world/surface.ts'
import { WorldManager } from './world/world.ts'

function browserStorage(): WorldStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function scaleBar(pixelsPerMeter: number): { scaleMeters: number; scalePixels: number } {
  const goal = 100 / pixelsPerMeter
  const unit = 10 ** Math.floor(Math.log10(goal))
  const multiplier = goal / unit >= 5 ? 5 : goal / unit >= 2 ? 2 : 1
  const scaleMeters = multiplier * unit
  return { scaleMeters, scalePixels: scaleMeters * pixelsPerMeter }
}

async function start(ui: ReturnType<typeof createInterface>): Promise<void> {
  const viewport = ui.viewport
  const storage = browserStorage()
  let world: WorldManager
  try {
    const { metadata, migrated } = loadActiveWorld(storage)
    world = new WorldManager(metadata, storage)
    if (migrated) {
      ui.showWarning('Đã mở Aetheria 2.0. Các bản vá của bộ sinh v1 được giữ lại riêng vì bố cục địa hình đã thay đổi.')
    }
  } catch (error) {
    console.warn('Cannot open the saved world', error)
    world = new WorldManager(createWorldMetadata())
    ui.showWarning('Không đọc được thế giới đã lưu. Đang hiển thị thế giới mặc định.')
  }

  const app = new Application()
  await app.init({
    autoStart: false,
    preference: 'webgl',
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    backgroundAlpha: 0,
    antialias: false,
  })
  app.canvas.setAttribute('aria-hidden', 'true')
  viewport.append(app.canvas)
  viewport.tabIndex = 0
  viewport.setAttribute('role', 'region')
  viewport.setAttribute('aria-label', 'Bản đồ tương tác. Dùng phím mũi tên để di chuyển, dấu cộng và dấu trừ để thu phóng.')

  const renderer = new TerrainRenderer(app.stage)
  const rivers = new RiverOverlay(app.stage)
  const overlay = new HexOverlay(app.stage)
  const debugOverlay = new TerrainDebugOverlay(app.stage)
  const surface = new TerrainSurface()
  const camera = new CameraController(world.terrain.metadata.worldSizeMeters)

  let frame: StreamFrame | undefined
  let pointer: Point | null = null
  let drag: { id: number; position: Point } | null = null
  const layers: Record<MapLayer, boolean> = {
    colors: true, shading: true, hex: false, chunks: false, contours: false,
    water: true, classification: false,
  }
  let mapDirty = true
  let overlayDirty = true
  let request: number | null = null
  let lastTime = performance.now()

  function schedule(): void {
    if (request === null) request = requestAnimationFrame(draw)
  }

  function invalidateMap(): void {
    mapDirty = true
    schedule()
  }

  function draw(now: number): void {
    request = null
    const cameraMoved = camera.step(clamp(now - lastTime, 8, 33))
    lastTime = now
    const view = camera.frame
    const updateMap = mapDirty || cameraMoved || !frame || frame.loading

    if (updateMap || !frame) {
      mapDirty = false
      frame = world.chunks.update({
        bounds: camera.viewBounds(),
        center: surface.pick(camera, { x: view.width / 2, y: view.height / 2 }) ?? view.center,
        pixelsPerMeter: view.pixelsPerMeter,
        intersects: (bounds) => camera.intersects(bounds),
      })
      surface.setTiles(frame.tiles)
      renderer.render(frame.tiles, view, frame.pendingTiles)
    }

    const position = surface.pick(camera, pointer ?? { x: view.width / 2, y: view.height / 2 }) ?? view.center
    const hex = worldToHex(position.x, position.y)
    const spacing = frame.tiles[0]?.spacing ?? 0
    const sample = world.terrain.sample(position.x, position.y, spacing)

    if (updateMap || overlayDirty || layers.hex) {
      overlay.render(layers.hex, hex, camera, surface, spacing || Infinity, updateMap || overlayDirty)
      if (updateMap || overlayDirty) {
        const flow = layers.water && spacing >= RIVER_LINE_SPACING ? world.terrain.riverSegments : []
        rivers.render(flow, camera, surface, spacing, layers.colors)
        debugOverlay.render(layers, camera, frame.tiles)
      }
      app.render()
      overlayDirty = false
    }

    ui.update({
      seed: world.terrain.metadata.seed,
      worldSizeMeters: camera.worldSize,
      lod: frame.lod,
      activeChunks: frame.loadedChunks,
      visibleTiles: frame.tiles.length,
      worldX: position.x,
      worldY: position.y,
      hex,
      biome: sample.biome,
      elevation: sample.elevation,
      chunk: worldToChunk(position.x, position.y, camera.worldSize),
      landform: sample.landform,
      surface: sample.surface,
      slope: sample.slope,
      ruggedness: sample.ruggedness,
      water: sample.water,
      zoom: camera.zoom,
      loading: frame.loading,
      ...scaleBar(view.pixelsPerMeter),
    })

    if (cameraMoved || frame.loading) schedule()
  }

  const resize = () => {
    const width = Math.max(1, viewport.clientWidth)
    const height = Math.max(1, viewport.clientHeight)
    if (width === camera.frame.width && height === camera.frame.height) return
    camera.resize(width, height)
    app.renderer.resize(width, height)
    invalidateMap()
  }
  new ResizeObserver(resize).observe(viewport)
  resize()
  schedule()

  function eventPoint(event: MouseEvent): Point {
    const rect = viewport.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  viewport.addEventListener('wheel', (event) => {
    event.preventDefault()
    const position = eventPoint(event)
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? camera.frame.height : 1
    camera.zoomAt(position.x, position.y, Math.exp(-clamp(event.deltaY * unit, -500, 500) * 0.0032))
    pointer = position
    schedule()
  }, { passive: false })

  viewport.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return
    viewport.focus({ preventScroll: true })
    viewport.setPointerCapture(event.pointerId)
    const position = eventPoint(event)
    drag = { id: event.pointerId, position }
    pointer = position
    schedule()
  })

  viewport.addEventListener('pointermove', (event) => {
    if (!event.isPrimary) return
    const position = eventPoint(event)
    pointer = position
    if (drag?.id === event.pointerId) {
      camera.panBy(position.x - drag.position.x, position.y - drag.position.y)
      drag.position = position
      invalidateMap()
    } else {
      schedule()
    }
  })

  function finishDrag(event: PointerEvent): void {
    if (drag?.id !== event.pointerId) return
    drag = null
    const { x, y } = eventPoint(event)
    const { width, height } = camera.frame
    if (event.pointerType !== 'mouse' || x < 0 || x > width || y < 0 || y > height) pointer = null
    schedule()
  }
  viewport.addEventListener('pointerup', finishDrag)
  viewport.addEventListener('pointercancel', finishDrag)
  viewport.addEventListener('lostpointercapture', finishDrag)
  viewport.addEventListener('pointerleave', () => {
    if (drag) return
    pointer = null
    schedule()
  })
  app.canvas.addEventListener('webglcontextrestored', invalidateMap)

  function zoomFromCenter(direction: number): void {
    const { width, height } = camera.frame
    camera.zoomAt(width / 2, height / 2, 2.25 ** direction)
    schedule()
  }

  function resetView(): void {
    camera.reset()
    pointer = null
    invalidateMap()
  }

  const panKeys: Record<string, Point> = {
    ArrowUp: { x: 0, y: 96 },
    ArrowDown: { x: 0, y: -96 },
    ArrowLeft: { x: 96, y: 0 },
    ArrowRight: { x: -96, y: 0 },
  }
  viewport.addEventListener('keydown', (event) => {
    const pan = panKeys[event.key]
    if (pan) {
      camera.panBy(pan.x, pan.y)
      pointer = null
      invalidateMap()
    } else if (event.key === '+' || event.key === '=') {
      zoomFromCenter(1)
    } else if (event.key === '-') {
      zoomFromCenter(-1)
    } else if (event.key === 'Home') {
      resetView()
    } else {
      return
    }
    event.preventDefault()
  })

  ui.onZoom(zoomFromCenter)
  ui.onHome(resetView)
  ui.onFocusContinent(() => {
    const metadata = world.terrain.metadata
    const outline = (metadata.layout ?? DEFAULT_AETHER_CONFIG).landmasses
      .filter(({ region }) => region === 'main')
      .flatMap(({ outline }) => outline.map(([x, y]) => ({ x: x * camera.worldSize, y: y * camera.worldSize })))
    camera.frameRegion(outline)
    pointer = null
    invalidateMap()
  })
  ui.onLayerChange((layer, enabled) => {
    layers[layer] = enabled
    if (layer !== 'hex' && layer !== 'chunks' && layer !== 'contours') {
      renderer.setOptions(layers)
      invalidateMap()
    }
    overlayDirty = true
    schedule()
  })
  ui.onSeedChange((seed) => {
    try {
      if (seed === world.terrain.metadata.seed) return
      const nextWorld = new WorldManager({ ...world.terrain.metadata, seed }, storage)
      world = nextWorld
      frame = undefined
      surface.setTiles([])
      renderer.render([], camera.frame)
      ui.showError('')
      resetView()
    } catch (error) {
      console.error('Cannot switch worlds', error)
      ui.showError('Không thể mở thế giới theo seed này. Hãy kiểm tra dữ liệu lưu trong trình duyệt.')
    }
  })
}

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing map container')
const ui = createInterface(root)
void start(ui).catch((error: unknown) => {
  console.error('Cannot initialize the world map', error)
  ui.showError('Không thể khởi động bản đồ. Hãy mở bằng trình duyệt có hỗ trợ WebGL.')
})
