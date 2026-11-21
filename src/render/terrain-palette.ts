import { BufferImageSource, Texture } from 'pixi.js';
import type { Biome } from '../terrain/index.ts';

const LEVELS = 24;
const SHADES = 20;
const COLOR_RAMPS = {
  ocean: [0x172e46, 0x21445e, 0x286079, 0x3e8190, 0x659d98],
  plains: [0xb9a97a, 0x9da474, 0x879c69, 0x778f5c, 0x678655],
  hills: [0x8e9866, 0x979567, 0x9b9064, 0x998663, 0x99866e],
  mountains: [0x938674, 0xa2917b, 0xab9d8b, 0xc5bea4, 0xe5e4d2],
  forest: [0x65825a, 0x507653, 0x436d50, 0x39624c, 0x305846],
  river: [0x40788c, 0x46879c, 0x5297a3, 0x63a5a5, 0x7bb8ad],
} satisfies Record<Biome, readonly number[]>;

const MATERIALS = Object.keys(COLOR_RAMPS) as Biome[];
const DECORATION = [0x564537, 0x27453d, 0x3d664d, 0x618552, 0x9aa965];
export const PALETTE_HEIGHT = MATERIALS.length * LEVELS + 1;
export const PALETTE_WIDTH = SHADES;

function colorChannel(color: number, shift: number): number {
  return (color >> shift) & 255;
}

function writeColor(data: Uint8Array, pixel: number, left: number, right: number, mix: number, shade: number): void {
  for (let channel = 0; channel < 3; channel++) {
    const shift = (2 - channel) * 8;
    const start = colorChannel(left, shift);
    const colored = start + (colorChannel(right, shift) - start) * mix;
    data[pixel * 4 + channel] = Math.min(255, Math.round(colored * shade));
  }
  data[pixel * 4 + 3] = 255;
}

export function createTerrainPalette(): Texture {
  const pixels = new Uint8Array(PALETTE_WIDTH * PALETTE_HEIGHT * 4);

  for (const [materialIndex, material] of MATERIALS.entries()) {
    const ramp = COLOR_RAMPS[material];
    for (let elevation = 0; elevation < LEVELS; elevation++) {
      const position = elevation / (LEVELS - 1) * (ramp.length - 1);
      const start = Math.floor(position);
      const row = materialIndex * LEVELS + elevation;
      for (let light = 0; light < SHADES; light++) {
        const shade = 0.61 + light / (SHADES - 1) * 0.67;
        writeColor(pixels, row * SHADES + light, ramp[start], ramp[Math.min(start + 1, ramp.length - 1)], position - start, shade);
      }
    }
  }

  for (const [index, color] of DECORATION.entries()) {
    writeColor(pixels, (PALETTE_HEIGHT - 1) * SHADES + index, color, color, 0, 1);
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

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function terrainTexel(biome: Biome, height: number, moisture: number, light: number): number {
  let level: number;
  switch (biome) {
    case 'ocean':
      level = 1 - Math.sqrt(clampUnit(-height / 4300));
      break;
    case 'plains':
      level = height < 120 ? 0.39 * clampUnit(height / 120) + 0.1 * moisture : 0.42 + moisture * 0.55;
      break;
    case 'hills':
      level = 0.14 + (height - 470) / 1250;
      break;
    case 'mountains':
      level = (height - 1100) / 3550;
      break;
    case 'forest':
      level = 0.3 + (moisture - 0.45) * 1.2 + height / 8500;
      break;
    case 'river':
      level = 0.34 + 0.32 * moisture;
      break;
  }

  const row = MATERIALS.indexOf(biome) * LEVELS + Math.round(clampUnit(level) * (LEVELS - 1));
  const column = Math.round(clampUnit((light - 0.61) / 0.67) * (SHADES - 1));
  return row * SHADES + column;
}

export function decorationTexel(index: number): number {
  return (PALETTE_HEIGHT - 1) * SHADES + index;
}
