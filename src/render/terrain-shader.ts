import {
  compileHighShaderGlProgram, compileHighShaderGpuProgram, localUniformBit, localUniformBitGl,
  roundPixelsBit, roundPixelsBitGl, Shader, textureBit, textureBitGl, type Texture,
} from 'pixi.js';

export function createTerrainShader(palette: Texture): Shader {
  return new Shader({
    glProgram: compileHighShaderGlProgram({
      name: 'terrain-depth',
      bits: [localUniformBitGl, textureBitGl, roundPixelsBitGl, {
        name: 'terrain-depth-gl',
        vertex: { header: 'in float aDepth;', end: 'gl_Position.z = aDepth * 2.0 - 1.0;' },
      }],
    }),
    gpuProgram: compileHighShaderGpuProgram({
      name: 'terrain-depth',
      bits: [localUniformBit, textureBit, roundPixelsBit, {
        name: 'terrain-depth-gpu',
        vertex: { header: '@in aDepth: f32;', end: 'vPosition.z = aDepth;' },
      }],
    }),
    resources: {
      uTexture: palette.source,
      uSampler: palette.source.style,
      textureUniforms: {
        uTextureMatrix: { type: 'mat3x3<f32>', value: palette.textureMatrix.mapCoord },
      },
    },
  });
}
