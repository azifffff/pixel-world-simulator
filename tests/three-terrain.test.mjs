import assert from 'node:assert/strict';
import test from 'node:test';
import { Ray, Scene, Vector3 } from 'three';
import { buildTerrainGeometry } from '../src/render3d/terrain-mesh.ts';
import { TerrainRenderer3D } from '../src/render3d/terrain.ts';
import { collectTileTrees } from '../src/render3d/trees.ts';
import { FOREST_MATERIAL, materialForBiome } from '../src/terrain/aether-classification.ts';
import { HEIGHT_SCALE, worldToScene } from '../src/world/coordinates3d.ts';

const RELIEF = { colors: true, shading: true, water: true, classification: false };
const FAR_X = 31_939_990;
const FAR_Y = 31_939_901;

function tile({ x = FAR_X, y = FAR_Y, spacing = 10, cells = 1, elevation, material = FOREST_MATERIAL, revision = 0 }) {
  const xs = Float64Array.from({ length: cells + 1 }, (_, index) => x + index * spacing);
  const ys = Float64Array.from({ length: cells + 1 }, (_, index) => y + index * spacing);
  const elevations = Float32Array.from(
    { length: xs.length * ys.length }, (_, index) => elevation(xs[index % xs.length], ys[Math.floor(index / xs.length)]),
  );
  const faces = cells * cells;
  return {
    key: `${revision}/${spacing}/${x}/${y}`, lod: spacing > 20 ? 3 : 4, spacing, xs, ys, elevations,
    bounds: { minX: x, minY: y, maxX: xs.at(-1), maxY: ys.at(-1) },
    materials: new Uint8Array(faces).fill(material),
    dryMaterials: new Uint8Array(faces).fill(material),
    biomes: new Uint8Array(faces),
    moistures: new Uint8Array(faces).fill(255),
    surfaceElevations: new Float32Array(faces).fill(20),
  };
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} ≈ ${expected}`);
}

test('flat ocean and real land triangles share their coastline when raycast at large world coordinates', () => {
  const terrain = new TerrainRenderer3D(new Scene());
  const sample = tile({ elevation: (x) => 2 * (x - FAR_X) - 10, material: materialForBiome('plains') });
  try {
    for (const origin of [{ x: FAR_X - 128, y: FAR_Y - 222 }, { x: FAR_X + 2, y: FAR_Y + 11 }]) {
      terrain.render([sample], origin);
      assert.equal(terrain.resourceCount, 1);
      for (const [offset, elevation] of [[2, 0], [5, 0], [7, 4]]) {
        const ray = new Ray(worldToScene(FAR_X + offset, FAR_Y + 4, 100, origin), new Vector3(0, -1, 0));
        const point = terrain.pick(ray);
        assert.ok(point);
        near(point.x + origin.x, FAR_X + offset);
        near(point.z + origin.y, FAR_Y + 4);
        near(point.y, elevation * HEIGHT_SCALE);
      }
    }
  } finally {
    terrain.destroy();
  }
});

test('neighboring tile meshes use the same shared coastline endpoints', () => {
  const elevation = (x) => 2 * (x - FAR_X) - 10;
  const north = buildTerrainGeometry(tile({ elevation }), RELIEF);
  const south = buildTerrainGeometry(tile({ y: FAR_Y + 10, elevation }), RELIEF);
  function edge(geometry, z) {
    const positions = geometry.getAttribute('position');
    const coordinates = new Map();
    for (let i = 0; i < positions.count; i++) {
      if (positions.getZ(i) === z) coordinates.set(positions.getX(i), positions.getY(i));
    }
    return [...coordinates].sort((a, b) => a[0] - b[0]);
  }
  try {
    const seam = edge(north, 10);
    assert.deepEqual(seam, edge(south, 0));
    assert.deepEqual(seam.map(([x]) => x), [0, 5, 10]);
  } finally {
    north.dispose();
    south.dispose();
  }
});

test('opposing local slopes catch different light without changing the terrain geometry', () => {
  const material = materialForBiome('plains');
  const east = tile({ elevation: (x) => 30 - (x - FAR_X), material });
  const west = tile({ elevation: (x) => 20 + (x - FAR_X), material });
  const sunlit = buildTerrainGeometry(east, RELIEF);
  const shaded = buildTerrainGeometry(west, RELIEF);
  const unlit = buildTerrainGeometry(east, { ...RELIEF, shading: false });
  try {
    assert.ok(sunlit.getAttribute('color').getX(0) > shaded.getAttribute('color').getX(0));
    assert.deepEqual(sunlit.getAttribute('position').array, unlit.getAttribute('position').array);
  } finally {
    for (const geometry of [sunlit, shaded, unlit]) geometry.dispose();
  }
});

test('forest roots have a stable world grid and stay on the terrain plane across tile partitions', () => {
  const elevation = (x, y) => 190 + (x - FAR_X) * 0.125 - (y - FAR_Y) * 0.25;
  const full = collectTileTrees(tile({ cells: 16, elevation }));
  const parts = [];
  for (const x of [FAR_X, FAR_X + 80]) {
    for (const y of [FAR_Y, FAR_Y + 80]) parts.push(...collectTileTrees(tile({ x, y, cells: 8, elevation })));
  }
  function byPosition(a, b) { return a.x - b.x || a.y - b.y; }
  assert.ok(full.length > 10);
  assert.deepEqual(parts.sort(byPosition), full.sort(byPosition));
  assert.ok(full.every((tree) => tree.canopy >= 6 && tree.canopy <= 8 && tree.height >= 16 && tree.height <= 23));
  for (const tree of full) near(tree.elevation, elevation(tree.x, tree.y));
});

test('terrain renderer finishes all replacement meshes before discarding another LOD or patch revision', () => {
  const renderer = new TerrainRenderer3D(new Scene());
  const origin = { x: FAR_X, y: FAR_Y };
  const elevation = () => 30;
  const coarse = tile({ spacing: 80, elevation });
  const fine = Array.from({ length: 6 }, (_, index) => tile({ x: FAR_X + index * 10, elevation }));
  const patched = fine.map((original, index) => index === 0
    ? original
    : tile({ x: original.bounds.minX, elevation: () => 77, revision: 1 }));
  try {
    renderer.render([coarse], origin);
    let visible = renderer.render(fine, origin);
    assert.deepEqual(visible, [coarse]);
    assert.equal(renderer.isPreparing, true);
    for (let i = 0; renderer.isPreparing && i < 8; i++) visible = renderer.render(fine, origin);
    assert.deepEqual(visible, fine);

    visible = renderer.render(patched, origin);
    assert.deepEqual(visible, fine);
    for (let i = 0; renderer.isPreparing && i < 8; i++) visible = renderer.render(patched, origin);
    assert.deepEqual(visible, patched);
    const ray = new Ray(worldToScene(FAR_X + 15, FAR_Y + 5, 100, origin), new Vector3(0, -1, 0));
    near(renderer.pick(ray).y, 77 * HEIGHT_SCALE);
    renderer.clear();
    assert.equal(renderer.resourceCount, 0);
    assert.equal(renderer.pick(ray), null);
  } finally {
    renderer.destroy();
  }
});
