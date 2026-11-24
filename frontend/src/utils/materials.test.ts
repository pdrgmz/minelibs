import { describe, expect, it } from 'vitest';
import {
  filterMaterials,
  materialsForLayer,
  materialsToCsv,
  materialsToText,
  presentMaterials,
  type MaterialRow,
} from './materials';

describe('presentMaterials', () => {
  it('calcula stacks y shulkers con redondeo hacia arriba', () => {
    const cases = [
      { count: 1, stackSize: 64, stacks: 1, shulkers: 1 },
      { count: 64, stackSize: 64, stacks: 1, shulkers: 1 },
      { count: 65, stackSize: 64, stacks: 2, shulkers: 1 },
      { count: 27 * 64, stackSize: 64, stacks: 27, shulkers: 1 },
      { count: 27 * 64 + 1, stackSize: 64, stacks: 28, shulkers: 2 },
      // Camas: stackSize 1 → N camas = N stacks, ceil(N / 27) shulkers.
      { count: 3, stackSize: 1, stacks: 3, shulkers: 1 },
      { count: 28, stackSize: 1, stacks: 28, shulkers: 2 },
    ];

    for (const testCase of cases) {
      const rows = presentMaterials([
        {
          blockId: 'minecraft:test',
          displayName: 'Test',
          count: testCase.count,
          stackSize: testCase.stackSize,
        },
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ stacks: testCase.stacks, shulkers: testCase.shulkers });
    }
  });

  it('ordena por count DESC y blockId ASC sin mutar la entrada', () => {
    const input = [
      { blockId: 'minecraft:torch', displayName: 'Torch', count: 1, stackSize: 64 },
      { blockId: 'minecraft:oak_log', displayName: 'Oak Log', count: 10, stackSize: 64 },
      { blockId: 'minecraft:redstone', displayName: 'Redstone', count: 1, stackSize: 64 },
      { blockId: 'minecraft:dirt', displayName: 'Dirt', count: 10, stackSize: 64 },
    ];

    const rows = presentMaterials(input);

    expect(rows.map((row) => row.blockId)).toEqual([
      'minecraft:dirt',
      'minecraft:oak_log',
      'minecraft:redstone',
      'minecraft:torch',
    ]);
    expect(input[0].blockId).toBe('minecraft:torch');
  });
});

describe('materialsForLayer', () => {
  it('aplica exclusiones, mapeo y stackSize del backend a una sola capa', () => {
    const blocks = [
      { x: 0, y: 4, z: 0, blockId: 'minecraft:air', properties: {} },
      { x: 1, y: 4, z: 0, blockId: 'minecraft:water[level=1]', properties: {} },
      { x: 2, y: 4, z: 0, blockId: 'minecraft:lava', properties: {} },
      { x: 3, y: 4, z: 0, blockId: 'minecraft:redstone_wire[power=3]', properties: {} },
      { x: 4, y: 4, z: 0, blockId: 'minecraft:wall_torch[facing=east]', properties: {} },
      { x: 5, y: 4, z: 0, blockId: 'minecraft:oak_sign[rotation=8]', properties: {} },
      { x: 6, y: 4, z: 0, blockId: 'minecraft:oak_stairs[facing=east]', properties: {} },
      { x: 7, y: 4, z: 0, blockId: 'minecraft:oak_stairs[facing=west]', properties: {} },
      { x: 8, y: 5, z: 0, blockId: 'minecraft:dirt', properties: {} },
    ];

    expect(materialsForLayer(blocks, 4)).toEqual([
      { blockId: 'minecraft:oak_stairs', displayName: 'Oak Stairs', count: 2, stackSize: 64 },
      { blockId: 'minecraft:oak_sign', displayName: 'Oak Sign', count: 1, stackSize: 16 },
      { blockId: 'minecraft:redstone', displayName: 'Redstone', count: 1, stackSize: 64 },
      { blockId: 'minecraft:torch', displayName: 'Torch', count: 1, stackSize: 64 },
    ]);
  });

  it('cuenta las puertas dobles como un solo ítem, igual que el backend', () => {
    const blocks = [
      { x: 0, y: 1, z: 0, blockId: 'minecraft:oak_door', properties: { half: 'lower' } },
      { x: 0, y: 2, z: 0, blockId: 'minecraft:oak_door', properties: { half: 'upper' } },
    ];

    expect(materialsForLayer(blocks, 1)).toEqual([
      { blockId: 'minecraft:oak_door', displayName: 'Oak Door', count: 1, stackSize: 64 },
    ]);
    expect(materialsForLayer(blocks, 2)).toEqual([]);
  });
});

describe('exportación y filtrado', () => {
  const rows: MaterialRow[] = presentMaterials([
    { blockId: 'minecraft:redstone', displayName: 'Redstone', count: 65, stackSize: 64 },
  ]);

  it('genera texto plano terminado en salto de línea', () => {
    expect(materialsToText(rows)).toBe(
      '65 × Redstone (minecraft:redstone) — 2 stacks / 1 shulkers\n',
    );
    expect(materialsToText([])).toBe('');
  });

  it('escapa comillas y comas en CSV', () => {
    const quoted = presentMaterials([
      {
        blockId: 'minecraft:redstone',
        displayName: 'Redstone, "polvo"',
        count: 65,
        stackSize: 64,
      },
    ]);

    expect(materialsToCsv(quoted)).toBe(
      'blockId,displayName,count,stackSize,stacks,shulkers\n' +
        'minecraft:redstone,"Redstone, ""polvo""",65,64,2,1\n',
    );
    expect(materialsToCsv([])).toBe('blockId,displayName,count,stackSize,stacks,shulkers\n');
  });

  it('filtra por displayName o blockId sin distinguir mayúsculas', () => {
    const several = presentMaterials([
      { blockId: 'minecraft:oak_sign', displayName: 'Oak Sign', count: 3, stackSize: 16 },
      { blockId: 'minecraft:redstone', displayName: 'Redstone', count: 2, stackSize: 64 },
    ]);

    expect(filterMaterials(several, 'OAK sign').map((row) => row.blockId)).toEqual([
      'minecraft:oak_sign',
    ]);
    expect(filterMaterials(several, 'REDSTONE').map((row) => row.blockId)).toEqual([
      'minecraft:redstone',
    ]);
    expect(filterMaterials(several, '')).toHaveLength(2);
    expect(filterMaterials(several, 'nada')).toEqual([]);
  });
});
