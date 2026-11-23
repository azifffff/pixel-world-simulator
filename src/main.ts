import { Ray, Scene, WebGLRenderer } from 'three'
import type { Map2D } from './render/map2d.ts'
import { TerrainOverlays3D } from './render3d/overlays.ts'
import { TerrainRenderer3D } from './render3d/terrain.ts'
import { WaterRenderer3D } from './render3d/water.ts'
import {
  createWorldMetadata, DEFAULT_AETHER_CONFIG, loadActiveWorld, type WorldStorage,
} from './terrain/index.ts'
import { createInterface, type MapLayer, type MapViewMode } from './ui.ts'
import { Camera3D } from './world/camera3d.ts'
import { sceneToWorld, type RenderOrigin, type WorldPosition } from './world/coordinates3d.ts'
import { clamp, worldToChunk, worldToHex, type Point } from './world/coordinates.ts'
import { countPhysicalChunks, type StreamFrame, type TerrainTile } from './world/streaming.ts'
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

function start(ui: ReturnType<typeof createInterface>): void {
  const viewport = ui.viewport
  let storage = browserStorage()
  let world: WorldManager
  try {
    const { metadata, migrated } = loadActiveWorld(storage)
    world = new WorldManager(metadata, storage)
    if (migrated) {
      ui.showWarning('Đã mở Aetheria 2.1 với quy mô và đường bờ mới. Bản lưu và Terrain Patch cũ vẫn được giữ riêng theo tọa độ gốc.')
    }
  } catch (error) {
    console.warn('Cannot open the saved world', error)
    storage = undefined
    world = new WorldManager(createWorldMetadata())
    ui.showWarning('Không đọc được thế giới đã lưu. Đang hiển thị thế giới mặc định.')
  }

  const webgl = new WebGLRenderer({ antialias: false, alpha: true })
  webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  webgl.setClearColor(0x000000, 0)
  webgl.domElement.setAttribute('aria-hidden', 'true')
  webgl.domElement.dataset.viewMode = '3d'
  webgl.domElement.classList.add('is-visible')
  viewport.append(webgl.domElement)
  viewport.tabIndex = 0
  viewport.setAttribute('role', 'region')
  viewport.setAttribute('aria-label', 'Bản đồ 3D. Dùng phím mũi tên để di chuyển, Shift và phím mũi tên để xoay, dấu cộng và dấu trừ để thu phóng.')

  const scene = new Scene()
  const renderer = new TerrainRenderer3D(scene)
  const water = new WaterRenderer3D(scene)
  const overlays = new TerrainOverlays3D(scene)
  const surface = new TerrainSurface()
  const camera = new Camera3D(world.terrain.metadata.worldSizeMeters)
  const pickingRay = new Ray()

  let map2D: Map2D | undefined
  let map2DLoading: Promise<Map2D> | undefined
  let viewMode: MapViewMode = '3d'
  let shownMode: MapViewMode = '3d'
  let switchVersion = 0
  let eraseTimer: number | undefined

  let frame: StreamFrame | undefined
  let displayedTiles: readonly TerrainTile[] = []
  let displayedOrigin = camera.frame.origin
  let waterPreparing = false
  let pointer: Point | null = null
  let drag: { id: number; position: Point; orbit: boolean; anchor?: WorldPosition } | null = null
  const touches = new Map<number, Point>()
  const layers: Record<MapLayer, boolean> = {
    colors: true, shading: true, hex: false, chunks: false, contours: false,
    water: true, classification: false,
  }
  let mapDirty = true
  let overlayDirty = true
  let request: number | null = null
  let lastTime = performance.now()
  let patchView: ReturnType<typeof activeCamera>['frame'] | undefined

  function schedule(): void {
    if (request === null) request = requestAnimationFrame(draw)
  }

  function invalidateMap(): void {
    mapDirty = true
    schedule()
  }

  function getHit(screen: Point, origin: RenderOrigin = camera.frame.origin): WorldPosition | null {
    const ray = camera.rayAt(screen.x, screen.y, pickingRay)
    ray.origin.x += origin.x - displayedOrigin.x
    ray.origin.z += origin.y - displayedOrigin.y
    const intersection = renderer.pick(ray)
    if (!intersection) return null
    const position = sceneToWorld(intersection, displayedOrigin)
    return {
      x: clamp(position.x, 0, camera.worldSize),
      y: clamp(position.y, 0, camera.worldSize),
      elevation: position.elevation,
    }
  }

  function activeCamera() {
    return viewMode === '2d' && map2D ? map2D.camera : camera
  }

  function activeHit(screen: Point): WorldPosition | null {
    return viewMode === '2d' && map2D ? map2D.pick(screen) : getHit(screen)
  }

  function terrainChanged(): void {
    patchView = activeCamera().frame
    invalidateMap()
  }

  function clearThree(): void {
    renderer.clear()
    water.render([], camera.frame.origin, [], camera.frame.pixelsPerMeter, { water: false, colors: false })
    overlays.render({ hex: false, chunks: false, contours: false }, null, camera, [])
    waterPreparing = false
  }

  function revealView(): void {
    const canvas = viewMode === '2d' ? map2D?.canvas : webgl.domElement
    const previous = shownMode === '2d' ? map2D?.canvas : webgl.domElement
    if (!canvas || shownMode === viewMode) return

    window.clearTimeout(eraseTimer)
    if (previous) {
      previous.style.zIndex = '0'
      previous.classList.remove('is-visible')
    }
    canvas.style.zIndex = '1'
    canvas.classList.add('is-visible')
    shownMode = viewMode
    viewport.setAttribute('aria-label', viewMode === '2d'
      ? 'Bản đồ 2D isometric. Dùng phím mũi tên để di chuyển và dấu cộng, dấu trừ để thu phóng.'
      : 'Bản đồ 3D. Dùng phím mũi tên để di chuyển, Shift và phím mũi tên để xoay, dấu cộng và dấu trừ để thu phóng.')
    eraseTimer = window.setTimeout(() => {
      if (shownMode === '3d' && viewMode === '3d') {
        map2D?.canvas.classList.remove('is-visible')
        map2D?.clear()
      } else if (shownMode === '2d' && viewMode === '2d') {
        webgl.domElement.classList.remove('is-visible')
        clearThree()
      }
    }, 170)
  }

  async function changeView(mode: MapViewMode): Promise<void> {
    const version = ++switchVersion
    if (mode === viewMode) return
    try {
      if (mode === '2d' && !map2D) {
        map2DLoading ??= import('./render/map2d.ts').then(({ Map2D }) => Map2D.create(camera.worldSize))
        map2D = await map2DLoading
        if (!map2D.canvas.isConnected) {
          map2D.canvas.dataset.viewMode = '2d'
          map2D.canvas.addEventListener('webglcontextrestored', invalidateMap)
          viewport.append(map2D.canvas)
        }
      }
      if (version !== switchVersion) return

      const original = activeCamera().frame
      const anchor = activeHit({ x: original.width / 2, y: original.height / 2 }) ??
        { ...original.center, elevation: 0 }
      const target = mode === '2d' ? map2D?.camera : camera
      if (!target) return
      viewMode = mode
      resize()
      target.setView(anchor, original.pixelsPerMeter)
      displayedTiles = []
      patchView = undefined
      pointer = null
      drag = null
      touches.clear()
      overlayDirty = true
      invalidateMap()
    } catch (error) {
      map2DLoading = undefined
      if (version !== switchVersion) return
      console.error('Cannot switch map view', error)
      ui.setViewMode(viewMode)
      ui.showWarning('Không thể mở góc nhìn này trên trình duyệt hiện tại.')
    }
  }

  function draw(now: number): void {
    request = null
    const active = activeCamera()
    const cameraMoved = active.step(clamp(now - lastTime, 8, 50))
    lastTime = now
    const view = active.frame
    const updateMap = mapDirty || cameraMoved || !frame || frame.loading
    const legacy = viewMode === '2d' ? map2D : undefined

    if (updateMap || !frame) {
      mapDirty = false
      frame = world.chunks.update({
        bounds: active.viewBounds(),
        center: activeHit({ x: view.width / 2, y: view.height / 2 }) ?? view.center,
        pixelsPerMeter: view.pixelsPerMeter,
        intersects: (bounds) => active.intersects(bounds),
      })
    }

    if (patchView && (!frame.loading || patchView.center !== view.center ||
        patchView.pixelsPerMeter !== view.pixelsPerMeter ||
        patchView.width !== view.width || patchView.height !== view.height)) patchView = undefined
    const holdPatch = patchView !== undefined && displayedTiles.length > 0
    const tiles = holdPatch ? displayedTiles : frame.tiles
    const pending = holdPatch ? frame.tiles : frame.pendingTiles
    const rebuildView = updateMap || (!legacy && (renderer.isPreparing || waterPreparing)) || overlayDirty

    if (rebuildView) {
      if (legacy) {
        displayedTiles = tiles
        legacy.setTiles(tiles)
      } else {
        displayedTiles = renderer.render(tiles, camera.frame.origin, pending)
        displayedOrigin = camera.frame.origin
        surface.setTiles(displayedTiles)
        waterPreparing = water.render(
          displayedTiles, displayedOrigin, layers.water && displayedTiles.length ? world.terrain.riverSegments : [],
          view.pixelsPerMeter, layers,
        )
      }
    }

    const position = activeHit(pointer ?? { x: view.width / 2, y: view.height / 2 }) ?? view.center
    const hex = worldToHex(position.x, position.y)
    const lod = displayedTiles[0]?.lod ?? frame.lod
    const spacing = displayedTiles[0]?.spacing ?? 0
    const sample = world.terrain.sample(position.x, position.y, spacing)

    if (rebuildView || layers.hex) {
      if (legacy) {
        const rivers = rebuildView && layers.water && displayedTiles.length ? world.terrain.riverSegments : []
        legacy.draw(displayedTiles, pending, layers, rivers, hex, rebuildView)
      } else {
        overlays.render(layers, hex, camera, displayedTiles)
        webgl.render(scene, camera.camera)
      }
      overlayDirty = false
    }

    const north = active.worldToScreen(view.center.x, view.center.y - 1_000)
    const northAngle = Math.atan2(north.x - view.width / 2, view.height / 2 - north.y) * 180 / Math.PI
    const loading = frame.loading || (!legacy && (renderer.isPreparing || waterPreparing))
    if (!loading && displayedTiles.length) revealView()
    ui.update({
      seed: world.terrain.metadata.seed,
      worldSizeMeters: active.worldSize,
      lod,
      activeChunks: countPhysicalChunks(displayedTiles, lod),
      visibleTiles: displayedTiles.length,
      worldX: position.x,
      worldY: position.y,
      hex,
      biome: sample.biome,
      elevation: sample.elevation,
      chunk: worldToChunk(position.x, position.y, active.worldSize),
      landform: sample.landform,
      surface: sample.surface,
      slope: lod >= 3 && sample.water !== 'ocean'
        ? (legacy ? legacy.slopeAt(position.x, position.y) : surface.slopeAt(position.x, position.y)) ?? sample.slope
        : sample.slope,
      ruggedness: sample.ruggedness,
      water: sample.water,
      zoom: active.zoom,
      loading,
      northAngle,
      ...scaleBar(view.pixelsPerMeter),
    })

    if (cameraMoved || loading) schedule()
  }

  const resize = () => {
    const width = Math.max(1, viewport.clientWidth)
    const height = Math.max(1, viewport.clientHeight)
    map2D?.resize(width, height)
    if (width !== camera.frame.width || height !== camera.frame.height) {
      camera.resize(width, height)
      webgl.setSize(width, height, false)
    }
    invalidateMap()
  }
  new ResizeObserver(resize).observe(viewport)
  resize()
  schedule()

  function eventPoint(event: MouseEvent): Point {
    const rect = viewport.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function zoomAt(position: Point, factor: number): void {
    if (viewMode === '2d' && map2D) map2D.camera.zoomAt(position.x, position.y, factor, map2D.pick(position) ?? undefined)
    else camera.zoomAt(position.x, position.y, factor, getHit(position) ?? undefined)
    schedule()
  }

  function centerAnchor(): WorldPosition | undefined {
    const { width, height } = activeCamera().frame
    return activeHit({ x: width / 2, y: height / 2 }) ?? undefined
  }

  viewport.addEventListener('wheel', (event) => {
    event.preventDefault()
    const position = eventPoint(event)
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? camera.frame.height : 1
    zoomAt(position, Math.exp(-clamp(event.deltaY * unit, -500, 500) * 0.0032))
    pointer = position
  }, { passive: false })
  viewport.addEventListener('contextmenu', (event) => event.preventDefault())

  viewport.addEventListener('pointerdown', (event) => {
    const isTouch = event.pointerType === 'touch'
    if (isTouch ? touches.size >= 2 : drag || (event.button !== 0 && event.button !== 2)) return
    viewport.focus({ preventScroll: true })
    viewport.setPointerCapture(event.pointerId)
    const position = eventPoint(event)
    if (isTouch) touches.set(event.pointerId, position)
    else {
      const orbit = event.button === 2 || event.shiftKey
      drag = { id: event.pointerId, position, orbit, anchor: orbit ? centerAnchor() : undefined }
    }
    pointer = position
    schedule()
  })

  function touchMove(id: number, position: Point): void {
    const old = touches.get(id)
    if (!old) return
    touches.set(id, position)
    if (touches.size === 1) {
      activeCamera().panBy(position.x - old.x, position.y - old.y)
    } else {
      const other = [...touches].find(([key]) => key !== id)?.[1]
      if (!other) return
      const distance = Math.hypot(position.x - other.x, position.y - other.y)
      const previousDistance = Math.hypot(old.x - other.x, old.y - other.y)
      const midpoint = { x: (position.x + other.x) / 2, y: (position.y + other.y) / 2 }
      const dx = (position.x - old.x) / 2
      const dy = (position.y - old.y) / 2
      if (viewMode === '3d') camera.orbitBy(dx, dy, getHit(midpoint) ?? undefined)
      else activeCamera().panBy(dx, dy)
      if (distance >= 8 && previousDistance >= 8) {
        zoomAt(midpoint, distance / previousDistance)
        activeCamera().step(1_000)
      }
    }
    pointer = position
    invalidateMap()
  }

  viewport.addEventListener('pointermove', (event) => {
    const position = eventPoint(event)
    if (event.pointerType === 'touch') {
      touchMove(event.pointerId, position)
      return
    }
    pointer = position
    if (drag?.id === event.pointerId) {
      const dx = position.x - drag.position.x
      const dy = position.y - drag.position.y
      if (drag.orbit && viewMode === '3d') camera.orbitBy(dx, dy, drag.anchor)
      else activeCamera().panBy(dx, dy)
      drag.position = position
      invalidateMap()
    } else {
      schedule()
    }
  })

  function finishDrag(event: PointerEvent): void {
    if (touches.delete(event.pointerId)) {
      pointer = null
      schedule()
      return
    }
    if (drag?.id !== event.pointerId) return
    drag = null
    const { x, y } = eventPoint(event)
    const { width, height } = camera.frame
    if (x < 0 || x > width || y < 0 || y > height) pointer = null
    schedule()
  }

  viewport.addEventListener('pointerup', finishDrag)
  viewport.addEventListener('pointercancel', finishDrag)
  viewport.addEventListener('lostpointercapture', finishDrag)
  viewport.addEventListener('pointerleave', () => {
    if (drag || touches.size) return
    pointer = null
    schedule()
  })
  webgl.domElement.addEventListener('webglcontextrestored', invalidateMap)

  function zoomFromCenter(direction: number): void {
    const { width, height } = activeCamera().frame
    zoomAt({ x: width / 2, y: height / 2 }, 2.25 ** direction)
  }

  function resetView(): void {
    activeCamera().reset()
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
      if (event.shiftKey && viewMode === '3d') camera.orbitBy(-pan.x / 3, pan.y / 3, centerAnchor())
      else activeCamera().panBy(pan.x, pan.y)
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

  let stopTerrainSubscription = world.terrain.onChange(terrainChanged)
  ui.onZoom(zoomFromCenter)
  ui.onViewModeChange((mode) => void changeView(mode))
  ui.onHome(resetView)
  ui.onFocusContinent(() => {
    const metadata = world.terrain.metadata
    const outline = (metadata.layout ?? DEFAULT_AETHER_CONFIG).landmasses
      .filter(({ region }) => region === 'main')
      .flatMap(({ outline }) => outline.map(([x, y]) => ({ x: x * camera.worldSize, y: y * camera.worldSize })))
    activeCamera().frameRegion(outline)
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
      stopTerrainSubscription()
      world = nextWorld
      stopTerrainSubscription = world.terrain.onChange(terrainChanged)
      frame = undefined
      displayedTiles = []
      surface.setTiles([])
      clearThree()
      map2D?.clear()
      patchView = undefined
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
try {
  start(ui)
} catch (error) {
  console.error('Cannot initialize the world map', error)
  ui.showError('Không thể khởi động bản đồ. Hãy mở bằng trình duyệt có hỗ trợ WebGL 2.')
}
