import { describe, expect, it } from 'vitest';
import type { ParsedBlock } from './parser/types';
import { baseBlockId, chunkCounts, chunkKeys, filterBlocks, measurePoints, rulerMarks } from './layers';

const block = (
  blockId: string,
  x: number,
  y: number,
  z: number,
  properties: Record<string, string> = {},
): ParsedBlock => ({ blockId, x, y, z, properties });

const blocks: ParsedBlock[] = [
  block('minecraft:stone', 0, 0, 0),
  block('minecraft:redstone_wire[delay=2]', 1, 0, 0),
  block('minecraft:redstone_wire[delay=1]', 2, 1, 0),
  block('minecraft:oak_log[axis=y]', 17, 16, 31),
];

describe('filterBlocks', () => {
  it('filtra por capa Y sin mutar el original', () => {
    const snapshot = blocks.map((item) => ({ ...item }));
    const result = filterBlocks(blocks, 1, null);
    expect(result.map((item) => item.blockId)).toEqual(['minecraft:redstone_wire[delay=1]']);
    expect(blocks).toEqual(snapshot);
    expect(result).not.toBe(blocks);
  });

  it('compara el highlight con el ID base sin propiedades ni namespace', () => {
    const result = filterBlocks(blocks, null, 'minecraft:redstone_wire');
    expect(result).toHaveLength(2);
    expect(baseBlockId('minecraft:oak_log[axis=y]')).toBe('oak_log');
    expect(filterBlocks(blocks, null, 'oak_log')).toHaveLength(1);
  });

  it('combina capa y highlight', () => {
    expect(filterBlocks(blocks, 1, 'redstone_wire')).toEqual([blocks[2]]);
    expect(filterBlocks(blocks, 5, null)).toEqual([]);
  });

  it('sin filtros devuelve todos los bloques en una copia', () => {
    const result = filterBlocks(blocks, null, null);
    expect(result).toHaveLength(blocks.length);
    expect(result).not.toBe(blocks);
  });
});

describe('chunkKeys', () => {
  it('agrupa en secciones 16³ y elimina duplicados', () => {
    const many = [
      block('minecraft:stone', 0, 0, 0),
      block('minecraft:stone', 15, 15, 15),
      block('minecraft:stone', 16, 16, 16),
      block('minecraft:stone', 17, 16, 31),
    ];
    expect(chunkKeys(many)).toEqual(['0,0,0', '1,1,1']);
  });

  it('respeta un chunkSize personalizado y valores inválidos', () => {
    expect(chunkKeys([block('minecraft:stone', 31, 0, 0)], 32)).toEqual(['0,0,0']);
    expect(chunkKeys([block('minecraft:stone', -1, 0, 0)])).toEqual(['-1,0,0']);
    expect(chunkKeys([block('minecraft:stone', 5, 0, 0)], 0)).toEqual(['0,0,0']);
  });
});

describe('measurePoints', () => {
  it('calcula deltas por eje y distancia euclídea', () => {
    expect(measurePoints([1, 2, 3], [4, 6, 3])).toMatchObject({
      dx: 3,
      dy: 4,
      dz: 0,
      distance: 5,
    });
  });

  it('devuelve copias de los puntos de entrada', () => {
    const a: [number, number, number] = [0, 0, 0];
    const result = measurePoints(a, [1, 1, 1]);
    expect(result.a).not.toBe(a);
    expect(result.distance).toBeCloseTo(1.73, 2);
  });
});

describe('chunkCounts', () => {
  it('cuenta bloques por sección 16³', () => {
    const many = [
      block('minecraft:stone', 0, 0, 0),
      block('minecraft:stone', 15, 15, 15),
      block('minecraft:stone', 16, 0, 0),
    ];
    expect(chunkCounts(many)).toEqual([
      { key: '0,0,0', count: 2 },
      { key: '1,0,0', count: 1 },
    ]);
  });
});

describe('rulerMarks', () => {
  it('genera marcas desde 0 hasta el máximo incluyéndolo', () => {
    expect(rulerMarks({ widthX: 40, heightY: 10, lengthZ: 20 })).toEqual([0, 16, 32, 40]);
  });

  it('incluye el 0 cuando el máximo es menor que el paso', () => {
    expect(rulerMarks({ widthX: 4, heightY: 8, lengthZ: 2 })).toEqual([0, 8]);
    expect(rulerMarks({ widthX: 16, heightY: 16, lengthZ: 16 })).toEqual([0, 16]);
  });
});
