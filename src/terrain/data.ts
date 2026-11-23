import { morphologyDistances, TerrainGenerator, type TerrainSample } from './generator.ts';
import { validateWorldMetadata, type WorldMetadata, type WorldStorage } from './metadata.ts';
import { TerrainPatchManager, type TerrainPatch } from './patches.ts';
import type { Bounds } from '../world/coordinates.ts';

// Morphology samples the elevation at points offset along both axes. A height
// edit can affect their classification even outside the edited rectangle.
function shiftedBounds(bounds: Bounds, x: number, y: number, side: number): Bounds {
  return {
    minX: bounds.minX === 0 ? 0 : bounds.minX + x,
    minY: bounds.minY === 0 ? 0 : bounds.minY + y,
    maxX: bounds.maxX === side ? side : bounds.maxX + x,
    maxY: bounds.maxY === side ? side : bounds.maxY + y,
  };
}

export class TerrainData {
  readonly metadata: WorldMetadata;
  private readonly generator: TerrainGenerator;
  private readonly edits: TerrainPatchManager;
  private readonly events = new EventTarget();

  constructor(metadata: WorldMetadata, storage?: WorldStorage) {
    this.metadata = validateWorldMetadata(metadata);
    this.generator = new TerrainGenerator(this.metadata);
    this.edits = new TerrainPatchManager(this.metadata, storage);
  }

  get riverSegments() {
    return this.generator.hydrology.segments;
  }

  get revision(): number {
    return this.edits.revision;
  }

  onChange(listener: () => void): () => void {
    this.events.addEventListener('change', listener);
    return () => this.events.removeEventListener('change', listener);
  }

  changedBoundsSince(revision: number): readonly Bounds[] | undefined {
    const regions = this.edits.changesSince(revision);
    if (!regions) return undefined;
    const side = this.metadata.worldSizeMeters;
    const distances = morphologyDistances(side);
    const bounds: Bounds[] = [];
    for (const { affectsElevation, ...region } of regions) {
      bounds.push(region);
      if (!affectsElevation) continue;
      for (const distance of distances) {
        bounds.push(shiftedBounds(region, distance, 0, side), shiftedBounds(region, -distance, 0, side),
          shiftedBounds(region, 0, distance, side), shiftedBounds(region, 0, -distance, side));
      }
    }
    return bounds;
  }

  sample(x: number, y: number, spacing = 0): TerrainSample {
    const elevation = this.edits.elevationOverrideAt(x, y, () => this.generator.elevationAt(x, y));
    return this.edits.apply(x, y, this.generator.sample(x, y, spacing, elevation, this.elevationAt), true);
  }

  elevationAt = (x: number, y: number): number =>
    this.edits.elevationOverrideAt(x, y, () => this.generator.elevationAt(x, y)) ?? this.generator.elevationAt(x, y);

  setAuthoredTerrain(patch: TerrainPatch): void {
    this.edits.set('authored', patch);
    this.events.dispatchEvent(new Event('change'));
  }

  removeAuthoredTerrain(id: string): boolean {
    const removed = this.edits.remove('authored', id);
    if (removed) this.events.dispatchEvent(new Event('change'));
    return removed;
  }

  setPatch(patch: TerrainPatch): void {
    this.edits.set('patches', patch);
    this.events.dispatchEvent(new Event('change'));
  }

  removePatch(id: string): boolean {
    const removed = this.edits.remove('patches', id);
    if (removed) this.events.dispatchEvent(new Event('change'));
    return removed;
  }
}
