import { clamp } from '../world/coordinates.ts';
import { AetherLayout } from './aether-layout.ts';
import { AetherHydrology } from './aether-hydrology.ts';
import { classifyTerrain, type Morphology, type TerrainAttributes } from './aether-classification.ts';
import type { WorldMetadata } from './metadata.ts';

export const BIOMES = ['ocean', 'plains', 'hills', 'mountains', 'forest', 'river'] as const;
export type Biome = typeof BIOMES[number];

export interface TerrainSample extends TerrainAttributes {
  readonly elevation: number;
  readonly biome: Biome;
  readonly moisture: number;
  readonly waterLevel: number | null;
}

const FLAT_MORPHOLOGY: Morphology = Object.freeze({
  slope: 0, ruggedness: 0, localRelief: 0, curvature: 0,
});

export function morphologyDistances(worldSize: number): readonly [local: number, regional: number] {
  return [Math.min(750, worldSize / 64), Math.min(12_000, worldSize / 32)];
}

export class TerrainGenerator {
  readonly layout: AetherLayout;
  readonly hydrology: AetherHydrology;
  private readonly side: number;

  constructor(metadata: WorldMetadata) {
    this.side = metadata.worldSizeMeters;
    this.layout = new AetherLayout(metadata);
    this.hydrology = new AetherHydrology(
      this.side, (x, y) => this.layout.elevationAt(x, y), metadata.terrain.riverWidthMeters,
    );
  }

  elevationAt(x: number, y: number): number {
    return this.hydrology.elevationAt(x, y, this.layout.elevationAt(x, y));
  }

  sample(
    x: number, y: number, spacing = 0,
    elevationOverride?: number, elevationAt = (px: number, py: number) => this.elevationAt(px, py),
  ): TerrainSample {
    const layout = this.layout.sample(x, y);
    const runoff = layout.elevation > 0
      ? this.hydrology.sample(x, y, layout.elevation, spacing)
      : { elevation: layout.elevation, water: 'none' as const, waterLevel: null };
    const elevation = elevationOverride ?? runoff.elevation;
    const inlandWater = elevationOverride === undefined ? runoff.water : 'none';
    const morphology = elevation <= 0
      ? FLAT_MORPHOLOGY
      : this.morphology(x, y, elevation, elevationAt);
    const attributes = classifyTerrain(elevation, morphology, layout, inlandWater);
    const { water } = attributes;
    let biome: Biome = 'plains';
    if (water === 'ocean') biome = 'ocean';
    else if (water !== 'none') biome = 'river';
    else if (attributes.landform.endsWith('-mountain') || attributes.landform === 'volcano') biome = 'mountains';
    else if (attributes.surface === 'forest') biome = 'forest';
    else if (attributes.landform.endsWith('-hill') || attributes.landform === 'foothills') biome = 'hills';
    const waterLevel = water === 'ocean' ? 0 : water === 'none' ? null : runoff.waterLevel;
    return { ...attributes, elevation, biome, moisture: layout.moisture, waterLevel };
  }

  private morphology(
    x: number, y: number, elevation: number, elevationAt: (x: number, y: number) => number,
  ): Morphology {
    const [spacing, contourSpacing] = morphologyDistances(this.side);
    const neighbors = (distance: number) => [
      elevationAt(clamp(x - distance, 0, this.side), y),
      elevationAt(clamp(x + distance, 0, this.side), y),
      elevationAt(x, clamp(y - distance, 0, this.side)),
      elevationAt(x, clamp(y + distance, 0, this.side)),
    ];
    const [left, right, top, bottom] = neighbors(spacing);
    const regional = neighbors(contourSpacing);
    const slopeX = (right - left) / (Math.min(x + spacing, this.side) - Math.max(x - spacing, 0));
    const slopeY = (bottom - top) / (Math.min(y + spacing, this.side) - Math.max(y - spacing, 0));
    return {
      slope: Math.atan(Math.hypot(slopeX, slopeY)) * 180 / Math.PI,
      ruggedness: Math.tanh(Math.hypot(left - elevation, right - elevation, top - elevation, bottom - elevation) / spacing),
      localRelief: Math.max(elevation, ...regional) - Math.min(elevation, ...regional),
      curvature: Math.tanh((left + right + top + bottom - elevation * 4) / (0.2 * spacing)),
    };
  }
}
