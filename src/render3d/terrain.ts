import {
  Group, Mesh, MeshBasicMaterial, Raycaster, type InstancedMesh, type Intersection,
  type Ray, type Scene, type Vector3,
} from 'three';
import type { RenderOrigin } from '../world/coordinates3d.ts';
import { STREAM_SETTINGS, type TerrainTile } from '../world/streaming.ts';
import { buildTerrainGeometry, type TerrainRenderOptions } from './terrain-mesh.ts';
import { TreeMeshes } from './trees.ts';

export type { TerrainRenderOptions } from './terrain-mesh.ts';

const MESH_BUDGET_MS = 5;
const MESHES_PER_FRAME = 4;
const MAX_RESOURCES = STREAM_SETTINGS.maxActiveTiles * 2;
const DEFAULT_OPTIONS = { colors: true, shading: true, water: true, classification: false } as const;

interface RenderTile {
  readonly tile: TerrainTile;
  readonly variant: number;
  readonly group: Group;
  readonly terrain: Mesh;
  readonly trees: readonly InstancedMesh[];
}

function spatialKey(tile: TerrainTile): string {
  return `${tile.spacing}/${tile.bounds.minX}/${tile.bounds.minY}`;
}

export class TerrainRenderer3D {
  private readonly root = new Group();
  private readonly material = new MeshBasicMaterial({ vertexColors: true });
  private readonly treeMeshes = new TreeMeshes();
  private readonly entries = new Map<string, RenderTile>();
  private readonly visible = new Set<RenderTile>();
  private readonly raycaster = new Raycaster();
  private readonly hits: Intersection[] = [];
  private options: TerrainRenderOptions = DEFAULT_OPTIONS;
  private displayed: readonly TerrainTile[] = [];
  private preparing = false;

  constructor(scene: Scene) {
    scene.add(this.root);
  }

  get resourceCount(): number {
    return this.entries.size;
  }

  get isPreparing(): boolean {
    return this.preparing;
  }

  setOptions(options: TerrainRenderOptions): void {
    this.options = { ...options };
  }

  /**
   * Budget CPU geometry work and keep the current sampling grid mounted when
   * exchanging different LODs or restyling. Each frame draws a single spacing.
   */
  render(
    tiles: readonly TerrainTile[], origin: RenderOrigin, pending: readonly TerrainTile[] = [],
  ): readonly TerrainTile[] {
    const variant = Number(this.options.colors) + 2 * Number(this.options.shading) + 4 * Number(this.options.classification);
    const desired = tiles.map((tile) => ({ tile, key: `${variant}/${tile.key}` }));
    const queue = [...desired, ...pending.map((tile) => ({ tile, key: `${variant}/${tile.key}` }))];
    const deadline = performance.now() + MESH_BUDGET_MS;
    let built = 0;
    this.preparing = false;
    for (const { tile, key } of queue) {
      const entry = this.entries.get(key);
      if (entry?.tile === tile) continue;
      if (built >= MESHES_PER_FRAME || (built > 0 && performance.now() >= deadline)) {
        this.preparing = true;
        break;
      }
      if (entry) this.dispose(entry);
      this.entries.set(key, this.create(tile, variant));
      built++;
    }

    const available = desired.flatMap(({ tile, key }) => {
      const entry = this.entries.get(key);
      return entry?.tile === tile ? [entry] : [];
    });
    const previous = this.visible.values().next().value;
    const incoming = desired[0]?.tile;
    const variantChanged = previous && previous.variant !== variant;
    const visibleKeys = new Map([...this.visible].map(({ tile }) => [spatialKey(tile), tile.key]));
    const revisionChanged = desired.some(({ tile }) => {
      const prior = visibleKeys.get(spatialKey(tile));
      return prior !== undefined && prior !== tile.key;
    });
    const changeLayout = previous && incoming &&
      (previous.tile.spacing !== incoming.spacing || revisionChanged || variantChanged);
    const keepPrevious = tiles.length > 0 && changeLayout && available.length < tiles.length;
    if (!keepPrevious) this.show(available);

    for (const entry of this.visible) this.rebase(entry, origin);

    // Touch reusable entries after creating and swapping meshes, then evict unmounted LRU entries.
    for (const { key, tile } of queue) {
      const entry = this.entries.get(key);
      if (entry?.tile !== tile) continue;
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    this.trim(new Set(available));
    return this.displayed;
  }

  pick(ray: Ray): Vector3 | null {
    this.raycaster.ray.copy(ray);
    this.hits.length = 0;
    let nearest: Intersection | undefined;
    for (const { terrain } of this.visible) {
      this.hits.length = 0;
      terrain.raycast(this.raycaster, this.hits);
      for (const hit of this.hits) {
        if (!nearest || hit.distance < nearest.distance) nearest = hit;
      }
    }
    return nearest?.point ?? null;
  }

  clear(): void {
    for (const entry of this.entries.values()) this.dispose(entry);
    this.entries.clear();
    this.visible.clear();
    this.displayed = [];
    this.preparing = false;
  }

  destroy(): void {
    this.clear();
    this.root.removeFromParent();
    this.material.dispose();
    this.treeMeshes.destroy();
  }

  private create(tile: TerrainTile, variant: number): RenderTile {
    const group = new Group();
    const terrain = new Mesh(buildTerrainGeometry(tile, this.options), this.material);
    group.add(terrain);
    const trees = tile.lod === 4 && tile.spacing <= 20 && this.options.colors && !this.options.classification
      ? this.treeMeshes.attach(group, tile)
      : [];
    return { tile, variant, group, terrain, trees };
  }

  private show(available: readonly RenderTile[]): void {
    const next = new Set(available);
    for (const entry of this.visible) {
      if (!next.has(entry)) {
        entry.group.removeFromParent();
        this.visible.delete(entry);
      }
    }
    for (const entry of available) {
      if (!this.visible.has(entry)) {
        this.root.add(entry.group);
        this.visible.add(entry);
      }
    }
    const unchanged = this.displayed.length === available.length &&
      this.displayed.every((tile, index) => tile === available[index].tile);
    if (!unchanged) this.displayed = available.map(({ tile }) => tile);
  }

  private rebase(entry: RenderTile, origin: RenderOrigin): void {
    const x = entry.tile.xs[0] - origin.x;
    const z = entry.tile.ys[0] - origin.y;
    if (entry.group.position.x === x && entry.group.position.z === z) return;
    entry.group.position.set(x, 0, z);
    entry.group.updateMatrixWorld(true);
  }

  private trim(prepared: ReadonlySet<RenderTile>): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= MAX_RESOURCES) break;
      if (this.visible.has(entry) || prepared.has(entry)) continue;
      this.dispose(entry);
      this.entries.delete(key);
    }
  }

  private dispose(entry: RenderTile): void {
    entry.group.removeFromParent();
    entry.terrain.geometry.dispose();
    for (const tree of entry.trees) tree.dispose();
    this.visible.delete(entry);
  }
}
