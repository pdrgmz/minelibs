import { describe, expect, it } from 'vitest';
import type { BlockState } from './types';
import { buildMaterials, EXCLUDED_BLOCKS, isIncluded, PARSER_VERSION, toItem } from './materials';

const block = (blockId: string, properties: Record<string, string> = {}): BlockState => ({ blockId, properties });

describe('materiales (AGENTS.md §4.2)', () => {
  it('la versión del parser se incrementa al cambiar las reglas', () => {
    expect(PARSER_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('excluye aire y bloques técnicos', () => {
    for (const id of EXCLUDED_BLOCKS) expect(isIncluded(id)).toBe(false);
    expect(isIncluded('minecraft:stone')).toBe(true);
  });

  it('aplica la tabla bloque→ítem y separa el ID base de las propiedades', () => {
    expect(toItem(block('minecraft:redstone_wire', { power: '15' }))).toEqual({ itemId: 'minecraft:redstone', stackSize: 64 });
    expect(toItem(block('minecraft:wall_torch', { facing: 'north' }))).toEqual({ itemId: 'minecraft:torch', stackSize: 64 });
    expect(toItem(block('minecraft:oak_wall_sign', { facing: 'south' }))).toEqual({ itemId: 'minecraft:oak_sign', stackSize: 16 });
    expect(toItem(block('minecraft:oak_stairs', { waterlogged: 'true', facing: 'north' }))).toEqual({
      itemId: 'minecraft:oak_stairs',
      stackSize: 64,
    });
  });

  it('cuenta bloques dobles como un solo ítem', () => {
    expect(toItem(block('minecraft:oak_door', { half: 'upper' }))).toBeNull();
    expect(toItem(block('minecraft:red_bed', { part: 'head' }))).toBeNull();
    expect(toItem(block('minecraft:sunflower', { half: 'upper' }))).toBeNull();
    expect(toItem(block('minecraft:oak_door', { half: 'lower' }))).toEqual({ itemId: 'minecraft:oak_door', stackSize: 64 });
    expect(toItem(block('minecraft:red_bed', { part: 'foot' }))).toEqual({ itemId: 'minecraft:red_bed', stackSize: 1 });
  });

  it('totalBlocks cuenta bloques físicos y materials cuenta ítems, ordenados por cantidad', () => {
    const blocks = [
      block('minecraft:water'),
      block('minecraft:stone'),
      block('minecraft:stone', { snowy: 'true' }),
      block('minecraft:oak_door', { half: 'lower' }),
      block('minecraft:oak_door', { half: 'upper' }),
      block('minecraft:red_bed', { part: 'foot' }),
      block('minecraft:red_bed', { part: 'head' }),
      block('minecraft:redstone_wire', { power: '2' }),
    ];

    const result = buildMaterials(blocks);
    expect(result.totalBlocks).toBe(7);
    expect(result.materials).toEqual([
      { blockId: 'minecraft:stone', displayName: 'Stone', count: 2, stackSize: 64 },
      { blockId: 'minecraft:oak_door', displayName: 'Oak Door', count: 1, stackSize: 64 },
      { blockId: 'minecraft:red_bed', displayName: 'Red Bed', count: 1, stackSize: 1 },
      { blockId: 'minecraft:redstone', displayName: 'Redstone', count: 1, stackSize: 64 },
    ]);
  });
});
