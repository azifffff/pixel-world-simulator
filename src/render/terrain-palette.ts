import { BufferImageSource, Texture } from 'pixi.js';
import { BATHYMETRY_MATERIALS, MATERIALS } from '../terrain/aether-classification.ts';

const DECORATION = [0x564537, 0x27453d, 0x3d664d, 0x618552, 0x9aa965];
const SHADE_STEP = 0.018;
const DEPTH_LEVELS = 96;
const MAX_DEPTH = 7_000;
const DEPTH_RAMP = [
  [0, BATHYMETRY_MATERIALS.shallow],
  [620, BATHYMETRY_MATERIALS.shelf],
  [3_950, BATHYMETRY_MATERIALS.deep],
  [MAX_DEPTH, BATHYMETRY_MATERIALS.trench],
] as const;
export const PALETTE_WIDTH = 49;
export const PALETTE_HEIGHT = MATERIALS.length + DEPTH_LEVELS + 1;
const NEUTRAL_COLUMN = (PALETTE_WIDTH - 1) / 2;

function writeColor(data: Uint8Array, pixel: number, color: number, shade: number, target = color, mix = 0): void {
  const offset = pixel * 4;
  for (let channel = 0; channel < 3; channel++) {
    const shift = (2 - channel) * 8;
    const rgb = (color >> shift) & 255;
    const end = (target >> shift) & 255;
    data[offset + channel] = Math.min(255, Math.round((rgb + (end - rgb) * mix) * shade));
  }
  data[offset + 3] = 255;
}

export function createTerrainPalette(): Texture {
  const pixels = new Uint8Array(PALETTE_WIDTH * PALETTE_HEIGHT * 4);

  for (const [index, color] of MATERIALS.entries()) {
    for (let column = 0; column < PALETTE_WIDTH; column++) {
      const shade = 1 + (column - NEUTRAL_COLUMN) * SHADE_STEP;
      writeColor(pixels, index * PALETTE_WIDTH + column, color, shade);
    }
  }

  for (let level = 0; level < DEPTH_LEVELS; level++) {
    const depth = level / (DEPTH_LEVELS - 1) * MAX_DEPTH;
    const end = DEPTH_RAMP.findIndex(([height]) => depth <= height && height > 0);
    const [startDepth, startColor] = DEPTH_RAMP[end - 1];
    const [endDepth, endColor] = DEPTH_RAMP[end];
    const mix = (depth - startDepth) / (endDepth - startDepth);
    const row = MATERIALS.length + level;
    for (let column = 0; column < PALETTE_WIDTH; column++) {
      const shade = 1 + (column - NEUTRAL_COLUMN) * SHADE_STEP;
      writeColor(pixels, row * PALETTE_WIDTH + column, MATERIALS[startColor], shade, MATERIALS[endColor], mix);
    }
  }

  for (const [index, color] of DECORATION.entries()) {
    writeColor(pixels, (PALETTE_HEIGHT - 1) * PALETTE_WIDTH + index, color, 1);
  }

  const source = new BufferImageSource({
    resource: pixels,
    width: PALETTE_WIDTH,
    height: PALETTE_HEIGHT,
    format: 'rgba8unorm',
    scaleMode: 'nearest',
    autoGenerateMipmaps: false,
  });

  return new Texture({ source });
}

export function terrainTexel(material: number, light: number, bathymetry?: number): number {
  const column = Math.round(NEUTRAL_COLUMN + (light - 1) / SHADE_STEP);
  const row = bathymetry === undefined
    ? material
    : MATERIALS.length + Math.round(Math.max(0, Math.min(1, -bathymetry / MAX_DEPTH)) * (DEPTH_LEVELS - 1));
  return row * PALETTE_WIDTH + Math.max(0, Math.min(PALETTE_WIDTH - 1, column));
}

export function decorationTexel(index: number): number {
  return (PALETTE_HEIGHT - 1) * PALETTE_WIDTH + index;
}
