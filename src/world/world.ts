import {
  TerrainData, saveWorldMetadata, type WorldMetadata, type WorldStorage,
} from '../terrain/index.ts'
import { ChunkManager } from './streaming.ts'

export class WorldManager {
  readonly terrain: TerrainData
  readonly chunks: ChunkManager

  constructor(metadata: WorldMetadata, storage?: WorldStorage) {
    this.terrain = new TerrainData(metadata, storage)
    this.chunks = new ChunkManager(this.terrain)
    saveWorldMetadata(this.terrain.metadata, storage)
  }
}
