import { describe, expect, it } from 'vitest';
import { blockFlagsFor, collectSpecialTextureIds } from './resources';

describe('collectSpecialTextureIds', () => {
  it('incluye las texturas de agua que no están en el modelo del bloque', () => {
    expect(collectSpecialTextureIds(['minecraft:water[level=1]'])).toEqual([
      'minecraft:block/water_still',
      'minecraft:block/water_flow',
    ]);
  });

  it('incluye la textura de entidad de cada variante de cofre', () => {
    expect(collectSpecialTextureIds(['minecraft:chest[facing=north]'])).toEqual([
      'minecraft:entity/chest/normal',
    ]);
    expect(collectSpecialTextureIds(['minecraft:trapped_chest[facing=north]'])).toEqual([
      'minecraft:entity/chest/trapped',
    ]);
    expect(collectSpecialTextureIds(['minecraft:ender_chest[facing=north]'])).toEqual([
      'minecraft:entity/chest/ender',
    ]);
  });

  it('incluye agua también para bloques waterlogged', () => {
    expect(collectSpecialTextureIds(['minecraft:oak_stairs[waterlogged=true]'])).toEqual([
      'minecraft:block/water_still',
      'minecraft:block/water_flow',
    ]);
  });

  it('devuelve una lista vacía para bloques sin renderizador especial', () => {
    expect(collectSpecialTextureIds(['minecraft:stone'])).toEqual([]);
  });
});

describe('blockFlagsFor', () => {
  it('marca agua y lava como transparentes y con autoculling', () => {
    expect(blockFlagsFor('minecraft:water')).toEqual({ opaque: false, semi_transparent: true, self_culling: true });
    expect(blockFlagsFor('minecraft:lava')).toEqual({ opaque: false, semi_transparent: true, self_culling: true });
  });

  it('mantiene el resto sin culling agresivo', () => {
    expect(blockFlagsFor('minecraft:stone')).toEqual({ opaque: false });
  });
});
