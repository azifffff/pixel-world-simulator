import { TerrainGenerator, type TerrainSample } from './generator.ts';
import { validateWorldMetadata, type WorldMetadata, type WorldStorage } from './metadata.ts';
import { TerrainPatchManager, type TerrainPatch } from './patches.ts';

export class TerrainData {
  readonly metadata: WorldMetadata;
  private readonly generator: TerrainGenerator;
  private readonly edits: TerrainPatchManager;

  constructor(metadata: WorldMetadata, storage?: WorldStorage) {
    this.metadata = validateWorldMetadata(metadata);
    this.generator = new TerrainGenerator(this.metadata);
    this.edits = new TerrainPatchManager(this.metadata, storage);
  }

  get revision(): number {
    return this.edits.revision;
  }

  sample(x: number, y: number, spacing = 0): TerrainSample {
    return this.edits.apply(x, y, this.generator.sample(x, y, spacing));
  }

  elevationAt(x: number, y: number): number {
    return this.edits.elevationOverrideAt(x, y) ?? this.generator.elevationAt(x, y);
  }

  setAuthoredTerrain(patch: TerrainPatch): void {
    this.edits.set('authored', patch);
  }

  removeAuthoredTerrain(id: string): boolean {
    return this.edits.remove('authored', id);
  }

  setPatch(patch: TerrainPatch): void {
    this.edits.set('patches', patch);
  }

  removePatch(id: string): boolean {
    return this.edits.remove('patches', id);
  }
}
