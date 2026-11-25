import { describe, expect, it } from 'vitest';
import type { ParsedBlock } from './parser/types';
import { baseBlockId, chunkCounts, chunkKeys, filterBlocks, isInvisibleBlock, measurePoints, pickableBlockKeys, rulerMarks, splitForDisplay } from './layers';

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

describe('splitForDisplay', () => {
  it('separa la capa activa del contexto y oculta las superiores', () => {
    const result = splitForDisplay(blocks, 0, null);
    expect(result.focus.map((item) => item.blockId)).toEqual([
      'minecraft:stone',
      'minecraft:redstone_wire[delay=2]',
    ]);
    expect(result.context).toEqual([]);
    expect(splitForDisplay(blocks, 1, null).context).toHaveLength(2);
  });

  it('con highlight deja coincidentes en foco y el resto en contexto', () => {
    const result = splitForDisplay(blocks, 0, 'minecraft:redstone_wire[delay=1]');
    expect(result.focus.map((item) => item.blockId)).toEqual(['minecraft:redstone_wire[delay=2]']);
    expect(result.context.map((item) => item.blockId)).toEqual(['minecraft:stone']);
  });

  it('aisla la capa cuando se pide', () => {
    const result = splitForDisplay(blocks, 1, null, true);
    expect(result.focus).toHaveLength(1);
    expect(result.context).toHaveLength(0);
  });

  it('sin capa respeta el highlight sobre todo el schematic', () => {
    const result = splitForDisplay(blocks, null, 'stone');
    expect(result.focus.map((item) => item.blockId)).toEqual(['minecraft:stone']);
    expect(result.context).toHaveLength(3);
  });
});

describe('isInvisibleBlock', () => {
  it('reconoce aire y estados con propiedades', () => {
    expect(isInvisibleBlock('minecraft:air')).toBe(true);
    expect(isInvisibleBlock('minecraft:cave_air')).toBe(true);
    expect(isInvisibleBlock('minecraft:stone')).toBe(false);
  });
});

describe('pickableBlockKeys', () => {
  const mixed = [
    block('minecraft:air', 0, 0, 0),
    block('minecraft:cave_air', 1, 0, 0),
    block('minecraft:structure_void', 2, 0, 0),
    block('minecraft:stone', 3, 0, 0),
    block('minecraft:stone', 4, 1, 0),
    block('minecraft:stone', 5, 2, 0),
  ];

  it('ignora el aire que no se dibuja', () => {
    expect([...pickableBlockKeys(mixed, null)]).toEqual(['3,0,0', '4,1,0', '5,2,0']);
  });

  it('solo incluye las capas visibles según el filtro Y', () => {
    expect([...pickableBlockKeys(mixed, 1)]).toEqual(['3,0,0', '4,1,0']);
    expect([...pickableBlockKeys(mixed, 1, true)]).toEqual(['4,1,0']);
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
