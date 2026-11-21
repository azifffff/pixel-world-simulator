import './style.css';
import { WORLD_SIDE_METERS } from './world/coordinates.ts';

export interface MapViewState {
  seed: string;
  lod: number;
  activeChunks: number;
  visibleTiles: number;
  worldX: number;
  worldY: number;
  hex: { q: number; r: number } | null;
  biome: string;
  elevation: number;
  zoom: number;
  scaleMeters: number;
  scalePixels: number;
  loading: boolean;
  worldSizeMeters?: number;
}

const terrainLabels: Record<string, string> = {
  ocean: 'Đại dương',
  plains: 'Đồng bằng',
  hills: 'Đồi',
  mountains: 'Núi',
  forest: 'Rừng',
  river: 'Sông',
};

const lodLabels = ['Toàn thế giới', 'Khu vực địa lý', 'Ô địa hình', 'Khu vực địa phương', 'Quan sát gần'];
const integer = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

export function createInterface(root: HTMLElement) {
  root.innerHTML = `
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <div>
          <strong class="brand-title">Bản đồ thế giới</strong>
          <span class="brand-project">Pixel World Simulator</span>
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
        </section>
        <section class="panel-section">
          <h2>Địa hình</h2>
          <ul class="terrain-legend">
            ${Object.entries(terrainLabels).map(([type, label]) =>
              `<li><span class="terrain-swatch terrain-${type}" aria-hidden="true"></span>${label}</li>`).join('')}
          </ul>
        </section>
        <section class="panel-section">
          <h2>Lớp hiển thị</h2>
          <label class="hex-toggle" for="show-hex">
            <span>Đường biên hex</span>
            <input id="show-hex" type="checkbox" />
            <span class="toggle-track" aria-hidden="true"></span>
          </label>
        </section>
        <div class="panel-help">
          <p><span class="mouse-icon" aria-hidden="true"></span>Kéo để di chuyển</p>
          <p><span class="scroll-icon" aria-hidden="true">↕</span>Cuộn để thu phóng</p>
        </div>
      </aside>
      <section class="map-frame" aria-label="Bản đồ địa hình">
        <div id="map-viewport" class="map-viewport"></div>
        <p class="map-loading" data-value="loading" role="status">
          <span class="loading-dot" aria-hidden="true"></span>Đang dựng địa hình
        </p>
        <p class="map-error" data-value="error" role="alert" hidden></p>
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
          <dl class="map-inspector" aria-label="Thông tin vị trí">
            <div class="inspector-coordinates">
              <dt>Tọa độ thế giới</dt>
              <dd><span class="coordinate-axis">X</span> <span data-value="world-x">—</span> m</dd>
              <dd><span class="coordinate-axis">Y</span> <span data-value="world-y">—</span> m</dd>
            </div>
            <div>
              <dt>Ô lục giác</dt>
              <dd data-value="hex">—</dd>
            </div>
            <div class="inspector-surface">
              <dt>Bề mặt</dt>
              <dd data-value="biome">—</dd>
              <dd class="inspector-altitude"><span data-value="elevation">—</span> m</dd>
            </div>
          </dl>
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
  const hexToggle = select<HTMLInputElement>('#show-hex');
  const zoomIn = select<HTMLButtonElement>('[data-action="zoom-in"]');
  const zoomOut = select<HTMLButtonElement>('[data-action="zoom-out"]');
  const home = select<HTMLButtonElement>('[data-action="home"]');
  const values = new Map(
    [...root.querySelectorAll<HTMLElement>('[data-value]')].map(element => [element.dataset.value, element]),
  );
  const loading = select<HTMLElement>('[data-value="loading"]');
  const error = select<HTMLElement>('[data-value="error"]');
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
    onHexToggle(handler: (show: boolean) => void): void {
      hexToggle.addEventListener('change', () => handler(hexToggle.checked));
    },
    onZoom(handler: (direction: number) => void): void {
      zoomIn.addEventListener('click', () => handler(1));
      zoomOut.addEventListener('click', () => handler(-1));
    },
    onHome(handler: () => void): void {
      home.addEventListener('click', handler);
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
      setValue('hex', state.hex ? `q ${integer.format(state.hex.q)} · r ${integer.format(state.hex.r)}` : '—');
      setValue('biome', terrainLabels[state.biome] ?? '—');
      setValue('elevation', integer.format(state.elevation));
      setValue('zoom', `${decimal.format(state.zoom)}×`);
      loading.hidden = !state.loading;
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
  };
}
