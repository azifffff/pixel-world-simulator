import {
  BoxGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, MeshBasicMaterial, Object3D,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FOREST_MATERIAL, materialForBiome } from '../terrain/aether-classification.ts';
import { pixelNoise, rootedTreeElevation, treeRoot, TREE_GRID_METERS, type TreeRoot } from '../render/terrain-detail.ts';
import { HEIGHT_SCALE } from '../world/coordinates3d.ts';
import { BIOMES, type TerrainTile } from '../world/streaming.ts';

export interface TileTree extends TreeRoot {
  readonly elevation: number;
}

export function collectTileTrees(tile: TerrainTile): TileTree[] {
  const { xs, ys, elevations, spacing, materials, biomes, moistures } = tile;
  const maxX = xs[xs.length - 1];
  const maxY = ys[ys.length - 1];
  const trees: TileTree[] = [];

  for (let gy = Math.floor(ys[0] / TREE_GRID_METERS); gy * TREE_GRID_METERS < maxY; gy++) {
    for (let gx = Math.floor(xs[0] / TREE_GRID_METERS); gx * TREE_GRID_METERS < maxX; gx++) {
      const tree = treeRoot(gx, gy);
      if (tree.x < xs[0] || tree.x >= maxX || tree.y < ys[0] || tree.y >= maxY) continue;
      const column = Math.floor((tree.x - xs[0]) / spacing);
      const row = Math.floor((tree.y - ys[0]) / spacing);
      const face = row * (xs.length - 1) + column;
      if ((materials?.[face] ?? materialForBiome(BIOMES[biomes[face]])) !== FOREST_MATERIAL) continue;
      if (pixelNoise(gx, gy) > 0.49 + moistures[face] / 255 * 0.26) continue;

      const index = row * xs.length + column;
      const width = xs[column + 1] - xs[column];
      const depth = ys[row + 1] - ys[row];
      const elevation = rootedTreeElevation(
        (tree.x - xs[column]) / width, (tree.y - ys[row]) / depth,
        elevations[index], elevations[index + 1],
        elevations[index + xs.length], elevations[index + xs.length + 1],
        width, depth,
      );
      if (elevation !== null) trees.push({ ...tree, elevation });
    }
  }
  return trees;
}

function solidBand(width: number, bottom: number, top: number, color: number): BoxGeometry {
  const mesh = new BoxGeometry(width, top - bottom, width);
  mesh.translate(0, (bottom + top) * 0.5, 0);
  const normal = mesh.getAttribute('normal');
  const colors = new Float32Array(normal.count * 3);
  const base = new Color(color);
  const shade = new Color();
  for (let i = 0; i < normal.count; i++) {
    const facingLight = normal.getX(i) * 0.46 + normal.getY(i) * 0.78 + normal.getZ(i) * 0.42;
    shade.copy(base).multiplyScalar(0.72 + Math.max(0, facingLight) * 0.40);
    shade.toArray(colors, i * 3);
  }
  mesh.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return mesh;
}

export class TreeMeshes {
  private readonly trunk = solidBand(1, -0.02, 0.43, 0x655140);
  private readonly crown: BufferGeometry;
  private readonly material = new MeshBasicMaterial({ vertexColors: true });
  private readonly transform = new Object3D();

  constructor() {
    const bands = [
      solidBand(1, 0.38, 0.65, 0x3d664d),
      solidBand(0.75, 0.65, 0.85, 0x618552),
      solidBand(0.41, 0.85, 1, 0x91a260),
    ];
    const crown = mergeGeometries(bands);
    for (const band of bands) band.dispose();
    if (!crown) throw new Error('Cannot combine the tree crown shapes');
    this.crown = crown;
  }

  attach(group: Group, tile: TerrainTile): InstancedMesh[] {
    const trees = collectTileTrees(tile);
    if (trees.length === 0) return [];
    const trunks = new InstancedMesh(this.trunk, this.material, trees.length);
    const crowns = new InstancedMesh(this.crown, this.material, trees.length);
    for (const [index, tree] of trees.entries()) {
      this.transform.position.set(tree.x - tile.xs[0], tree.elevation * HEIGHT_SCALE, tree.y - tile.ys[0]);
      const height = tree.height * HEIGHT_SCALE;
      this.transform.scale.set(tree.trunk, height, tree.trunk);
      this.transform.updateMatrix();
      trunks.setMatrixAt(index, this.transform.matrix);
      this.transform.scale.set(tree.canopy, height, tree.canopy);
      this.transform.updateMatrix();
      crowns.setMatrixAt(index, this.transform.matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    group.add(trunks, crowns);
    return [trunks, crowns];
  }

  destroy(): void {
    this.trunk.dispose();
    this.crown.dispose();
    this.material.dispose();
  }
}
