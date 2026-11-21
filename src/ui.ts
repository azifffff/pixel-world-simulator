import './style.css';
import { SURFACE_LABELS, TERRAIN_LABELS, WATER_LABELS } from './terrain/aether-classification.ts';
import { WORLD_SIDE_METERS } from './world/coordinates.ts';

export type MapLayer = 'colors' | 'shading' | 'hex' | 'chunks' | 'contours' | 'water' | 'classification';

export interface MapViewState {
  seed: string;
  lod: number;
  activeChunks: number;
  visibleTiles: number;
  worldX: number;
  worldY: number;
  hex: { q: number; r: number } | null;
  chunk: { x: number; y: number } | null;
  biome: string;
  landform: string;
  surface: string;
  slope: number;
  ruggedness: number;
  water: string;
  elevation: number;
  zoom: number;
  scaleMeters: number;
  scalePixels: number;
  loading: boolean;
  worldSizeMeters?: number;
}

const legend = [
  ['#DCE8B5', 'Đồng bằng'],
  ['#94AD78', 'Đồi'],
  ['#C6AD82', 'Cao nguyên'],
  ['#777C70', 'Núi'],
  ['#F1F3F0', 'Tuyết phủ'],
  ['#B9B48C', 'Bồn địa'],
  ['#E8CC8C', 'Sa mạc cát'],
  ['#725E5C', 'Địa hình núi lửa'],
  ['#A9D3DF', 'Biển nông'],
  ['#3D789F', 'Biển sâu'],
] as const;

const layerControls = [
  { layer: 'colors', label: 'Màu địa hình', enabled: true },
  { layer: 'shading', label: 'Đổ bóng cao độ', enabled: true },
  { layer: 'water', label: 'Sông và hồ', enabled: true },
  { layer: 'hex', label: 'Đường biên hex', enabled: false },
  { layer: 'chunks', label: 'Đường biên chunk', enabled: false },
  { layer: 'contours', label: 'Đường đồng mức', enabled: false },
] as const satisfies readonly { layer: MapLayer; label: string; enabled: boolean }[];

const lodLabels = ['Toàn thế giới', 'Khu vực địa lý', 'Ô địa hình', 'Khu vực địa phương', 'Quan sát gần'];
const integer = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

function labelFor(labels: Readonly<Record<string, string>>, key: string): string {
  return Object.hasOwn(labels, key) ? labels[key] : '—';
}

export function createInterface(root: HTMLElement) {
  root.innerHTML = `
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <div>
          <strong class="brand-title">Aetheria 2.1</strong>
          <span class="brand-project">Bản đồ địa hình</span>
        </div>
      </div>
      <dl class="map-metrics">
        <div>
          <dt>LOD <span data-value="lod">0</span></dt>
          <dd data-value="lod-name">Toàn thế giới</dd>
        </div>
        <div>
          <dt title="Số chunk 640 m được dữ liệu địa hình đang vẽ bao phủ">Chunk có mẫu</dt>
          <dd class="metric-number" data-value="chunks">0</dd>
        </div>
        <div class="metric-tiles">
          <dt>Mảnh đang vẽ</dt>
          <dd class="metric-number" data-value="tiles">0</dd>
        </div>
      </dl>
      <button class="panel-button" type="button" aria-expanded="false" aria-controls="world-panel">
        <span class="panel-icon" aria-hidden="true"></span>
        <span class="visually-hidden">Tùy chọn bản đồ</span>
      </button>
    </header>
    <div class="app-body">
      <aside class="world-panel" id="world-panel" aria-label="Tùy chọn bản đồ">
        <section class="panel-section">
          <h2>Thế giới</h2>
          <p class="world-dimensions"><span data-value="world-side">—</span> km mỗi cạnh</p>
          <p class="world-area"><span data-value="world-area">—</span> km²</p>
          <form id="seed-form" class="seed-form">
            <label for="world-seed">Seed thế giới</label>
            <div class="seed-fields">
              <input id="world-seed" name="seed" type="text" maxlength="128" autocomplete="off" spellcheck="false" required />
              <button type="submit">Tạo</button>
            </div>
          </form>
          <button class="continent-focus" data-action="focus-continent" type="button">Đến siêu lục địa</button>
        </section>
        <section class="panel-section">
          <fieldset class="view-modes">
            <legend>Chế độ bản đồ</legend>
            <div class="mode-options">
              <label><input id="mode-relief" type="radio" name="map-mode" checked /><span>Địa hình nổi</span></label>
              <label><input id="mode-classification" type="radio" name="map-mode" /><span>Phân loại</span></label>
            </div>
          </fieldset>
          <h2>Lớp hiển thị</h2>
          <div class="layer-controls">
            ${layerControls.map(({ layer, label, enabled }) => `
              <label class="layer-toggle" for="show-${layer}">
                <span>${label}</span>
                <input id="show-${layer}" type="checkbox" ${enabled ? 'checked' : ''} />
                <span class="toggle-track" aria-hidden="true"></span>
              </label>`).join('')}
          </div>
        </section>
        <details class="panel-section legend-panel">
          <summary>Chú giải địa hình</summary>
          <ul class="terrain-legend">
            ${legend.map(([color, label]) =>
              `<li><span class="terrain-swatch" style="background-color: ${color}" aria-hidden="true"></span>${label}</li>`).join('')}
          </ul>
        </details>
        <div class="panel-help">
          <p><span class="mouse-icon" aria-hidden="true"></span>Kéo để di chuyển</p>
          <p><span class="scroll-icon" aria-hidden="true">↕</span>Cuộn để thu phóng</p>
        </div>
      </aside>
      <section class="map-frame" aria-label="Bản đồ địa hình">
        <div id="map-viewport" class="map-viewport"></div>
        <div class="map-notices">
          <p class="map-loading" data-value="loading" role="status">
            <span class="loading-dot" aria-hidden="true"></span>Đang dựng địa hình
          </p>
          <p class="map-error" data-value="error" role="alert" hidden></p>
          <div class="map-warning" hidden>
            <p data-value="warning" role="status"></p>
            <button type="button" aria-label="Đóng cảnh báo">×</button>
          </div>
        </div>
        <div class="map-compass" aria-label="Hướng bắc">
          <span class="compass-needle" aria-hidden="true"></span>
          <span aria-hidden="true">B</span>
        </div>
        <div class="map-tools" aria-label="Điều khiển bản đồ">
          <div class="zoom-buttons">
            <button data-action="zoom-in" type="button" title="Phóng to" aria-label="Phóng to">+</button>
            <button data-action="zoom-out" type="button" title="Thu nhỏ" aria-label="Thu nhỏ">−</button>
          </div>
          <button data-action="home" class="map-home" type="button" title="Về toàn cảnh" aria-label="Về toàn cảnh">
            <span aria-hidden="true"></span>
          </button>
          <span class="map-zoom" data-value="zoom">1×</span>
        </div>
        <div class="map-readouts">
          <div class="map-scale" data-value="scale" hidden>
            <span data-value="scale-distance">—</span>
          </div>
          <details class="map-inspector">
            <summary>
              <span>Thông tin địa hình</span>
              <span class="inspector-preview"><span data-value="landform-preview">—</span><span data-value="altitude-preview">—</span></span>
            </summary>
            <dl aria-label="Thông tin vị trí">
              <div class="inspector-coordinates">
                <dt>Tọa độ thế giới</dt>
                <dd><span class="coordinate-axis">X</span> <span data-value="world-x">—</span> m</dd>
                <dd><span class="coordinate-axis">Y</span> <span data-value="world-y">—</span> m</dd>
              </div>
              <div>
                <dt>Ô lục giác</dt>
                <dd class="inspector-grid-id" data-value="hex">
                  <span><span class="coordinate-axis">q</span> <span data-value="hex-q">—</span></span>
                  <span><span class="coordinate-axis">r</span> <span data-value="hex-r">—</span></span>
                </dd>
              </div>
              <div>
                <dt>Chunk</dt>
                <dd class="inspector-grid-id" data-value="chunk">
                  <span><span class="coordinate-axis">X</span> <span data-value="chunk-x">—</span></span>
                  <span><span class="coordinate-axis">Y</span> <span data-value="chunk-y">—</span></span>
                </dd>
              </div>
              <div><dt>Cao độ</dt><dd data-value="elevation">—</dd></div>
              <div><dt>Địa hình nền</dt><dd data-value="landform">—</dd></div>
              <div><dt>Bề mặt</dt><dd data-value="surface">—</dd></div>
              <div><dt>Độ dốc</dt><dd data-value="slope">—</dd></div>
              <div><dt>Độ gồ ghề</dt><dd data-value="ruggedness">—</dd></div>
              <div><dt>Nước</dt><dd data-value="water">—</dd></div>
              <div><dt>LOD</dt><dd data-value="inspector-lod">—</dd></div>
            </dl>
          </details>
        </div>
      </section>
    </div>`;

  function select<T extends HTMLElement>(selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing map interface element: ${selector}`);
    return element;
  }

  const viewport = select<HTMLDivElement>('#map-viewport');
  const panel = select<HTMLElement>('#world-panel');
  const panelButton = select<HTMLButtonElement>('.panel-button');
  const seedForm = select<HTMLFormElement>('#seed-form');
  const seedInput = select<HTMLInputElement>('#world-seed');
  const reliefMode = select<HTMLInputElement>('#mode-relief');
  const classificationMode = select<HTMLInputElement>('#mode-classification');
  const zoomIn = select<HTMLButtonElement>('[data-action="zoom-in"]');
  const zoomOut = select<HTMLButtonElement>('[data-action="zoom-out"]');
  const home = select<HTMLButtonElement>('[data-action="home"]');
  const focusContinent = select<HTMLButtonElement>('[data-action="focus-continent"]');
  const values = new Map(
    [...root.querySelectorAll<HTMLElement>('[data-value]')].map(element => [element.dataset.value, element]),
  );
  const loading = select<HTMLElement>('[data-value="loading"]');
  const error = select<HTMLElement>('[data-value="error"]');
  const warning = select<HTMLElement>('.map-warning');
  const inspector = select<HTMLDetailsElement>('.map-inspector');
  const scale = select<HTMLElement>('[data-value="scale"]');
  let renderedSeed = '';
  let renderedSide = 0;

  function setValue(name: string, text: string): void {
    const element = values.get(name);
    if (element && element.textContent !== text) element.textContent = text;
  }

  function setPanelOpen(open: boolean): void {
    panel.classList.toggle('is-open', open);
    panelButton.setAttribute('aria-expanded', String(open));
  }

  panelButton.addEventListener('click', () => setPanelOpen(!panel.classList.contains('is-open')));
  viewport.addEventListener('pointerdown', () => setPanelOpen(false));
  select<HTMLButtonElement>('.map-warning button').addEventListener('click', () => { warning.hidden = true; });
  inspector.open = window.matchMedia('(min-width: 1050px)').matches;
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel.classList.contains('is-open')) {
      setPanelOpen(false);
      panelButton.focus();
    }
  });

  return {
    viewport,
    onSeedChange(handler: (seed: string) => void): void {
      seedForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const seed = seedInput.value.trim();
        if (seed) {
          handler(seed);
          setPanelOpen(false);
        } else {
          seedInput.value = renderedSeed;
        }
      });
    },
    onLayerChange(handler: (layer: MapLayer, enabled: boolean) => void): void {
      for (const { layer } of layerControls) {
        const toggle = select<HTMLInputElement>(`#show-${layer}`);
        toggle.addEventListener('change', () => handler(layer, toggle.checked));
      }
      reliefMode.addEventListener('change', () => {
        if (reliefMode.checked) handler('classification', false);
      });
      classificationMode.addEventListener('change', () => {
        if (classificationMode.checked) handler('classification', true);
      });
    },
    onZoom(handler: (direction: number) => void): void {
      zoomIn.addEventListener('click', () => handler(1));
      zoomOut.addEventListener('click', () => handler(-1));
    },
    onHome(handler: () => void): void {
      home.addEventListener('click', handler);
    },
    onFocusContinent(handler: () => void): void {
      focusContinent.addEventListener('click', () => {
        setPanelOpen(false);
        handler();
        viewport.focus();
      });
    },
    update(state: MapViewState): void {
      if (state.seed !== renderedSeed) {
        renderedSeed = state.seed;
        seedInput.value = state.seed;
      }
      const worldSide = state.worldSizeMeters ?? WORLD_SIDE_METERS;
      if (worldSide !== renderedSide) {
        renderedSide = worldSide;
        const sideKm = worldSide / 1000;
        setValue('world-side', integer.format(sideKm));
        setValue('world-area', integer.format(sideKm ** 2));
      }
      setValue('lod', String(state.lod));
      setValue('lod-name', lodLabels[state.lod] ?? '—');
      setValue('chunks', integer.format(state.activeChunks));
      setValue('tiles', integer.format(state.visibleTiles));
      setValue('world-x', integer.format(state.worldX));
      setValue('world-y', integer.format(state.worldY));
      setValue('hex-q', state.hex ? integer.format(state.hex.q) : '—');
      setValue('hex-r', state.hex ? integer.format(state.hex.r) : '—');
      setValue('chunk-x', state.chunk ? integer.format(state.chunk.x) : '—');
      setValue('chunk-y', state.chunk ? integer.format(state.chunk.y) : '—');
      const landform = labelFor(TERRAIN_LABELS, state.landform);
      const elevation = `${integer.format(state.elevation)} m`;
      setValue('landform', landform);
      setValue('landform-preview', landform);
      setValue('surface', labelFor(SURFACE_LABELS, state.surface));
      setValue('elevation', elevation);
      setValue('altitude-preview', elevation);
      setValue('slope', Number.isFinite(state.slope) ? `${decimal.format(state.slope)}°` : '—');
      setValue('ruggedness', Number.isFinite(state.ruggedness) ? `${integer.format(state.ruggedness * 100)}%` : '—');
      setValue('water', labelFor(WATER_LABELS, state.water));
      setValue('inspector-lod', String(state.lod));
      setValue('zoom', `${decimal.format(state.zoom)}×`);
      loading.hidden = !state.loading || !error.hidden;
      scale.hidden = state.scaleMeters <= 0 || state.scalePixels <= 0;
      if (!scale.hidden) {
        const kilometers = state.scaleMeters / 1000;
        const distance = kilometers >= 1 ? `${decimal.format(kilometers)} km` : `${decimal.format(state.scaleMeters)} m`;
        setValue('scale-distance', distance);
        scale.style.width = `${state.scalePixels}px`;
      }
    },
    showError(message: string): void {
      error.textContent = message;
      error.hidden = !message;
      if (message) loading.hidden = true;
    },
    showWarning(message: string): void {
      setValue('warning', message);
      warning.hidden = !message;
    },
  };
}
