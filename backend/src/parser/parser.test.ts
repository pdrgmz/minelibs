import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SchematicFormat } from '../utils/upload';
import { parseSchematic } from './index';
import { summarize } from './types';

const samples = path.resolve(__dirname, '../../../samples');
const fixtureFile = (name: string) => readFile(path.join(samples, name));
const fixtureExpected = async (name: string) => JSON.parse(await readFile(path.join(samples, `${name}.expected.json`), 'utf8')) as unknown;

const cases: Array<[string, SchematicFormat]> = [
  // Fixtures reales (regla crítica 5 de AGENTS.md).
  ['granja-de-cooblestone-rapida.litematic', 'LITEMATIC'],
  ['granja-de-cooblestone-rapida.schem', 'SCHEM'],
  ['granja-de-cooblestone-rapida.nbt', 'NBT'],
  ['bamboo-farm-720k-bamboo-per-hour-bonemeal-dependent.litematic', 'LITEMATIC'],
  ['bamboo-farm-720k-bamboo-per-hour-bonemeal-dependent.schem', 'SCHEM'],
  ['bamboo-farm-720k-bamboo-per-hour-bonemeal-dependent.nbt', 'NBT'],
  // Fixtures sintéticos de casos borde.
  ['basic.litematic', 'LITEMATIC'],
  ['multi_region.litematic', 'LITEMATIC'],
  ['bit_boundary.litematic', 'LITEMATIC'],
  ['schem_v2.schem', 'SCHEM'],
  ['schem_v3.schem', 'SCHEM'],
  ['structure.nbt', 'NBT'],
  ['waterlogged.nbt', 'NBT'],
  ['double_blocks.nbt', 'NBT'],
];

describe('parser NBT contra fixtures', () => {
  for (const [name, format] of cases) {
    it(`${name} coincide con su .expected.json`, async () => {
      const parsed = await parseSchematic(await fixtureFile(name), format);
      expect(summarize(parsed)).toEqual(await fixtureExpected(name));
    });
  }

  it('rechaza archivos corruptos con HttpError 400', async () => {
    for (const [name, format] of [
      ['corrupt.litematic', 'LITEMATIC'],
      ['fake_extension.schem', 'SCHEM'],
    ] as Array<[string, SchematicFormat]>) {
      await expect(parseSchematic(await fixtureFile(name), format)).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('los tres formatos de cada granja real producen exactamente el mismo resumen', async () => {
    for (const name of ['granja-de-cooblestone-rapida', 'bamboo-farm-720k-bamboo-per-hour-bonemeal-dependent']) {
      const summaries = await Promise.all(
        (['litematic', 'schem', 'nbt'] as const).map(async (ext) => {
          const parsed = await parseSchematic(await fixtureFile(`${name}.${ext}`), ext.toUpperCase() as SchematicFormat);
          return JSON.stringify(summarize(parsed));
        }),
      );
      expect(new Set(summaries).size).toBe(1);
    }
  });

  it('cada bloque devuelto tiene coordenadas dentro de las dimensiones', async () => {
    const parsed = await parseSchematic(await fixtureFile('multi_region.litematic'), 'LITEMATIC');
    expect(parsed.blocks.every((block) => block.x >= 0 && block.x < parsed.dimensions.widthX)).toBe(true);
    expect(parsed.blocks.every((block) => block.y >= 0 && block.y < parsed.dimensions.heightY)).toBe(true);
    expect(parsed.blocks.every((block) => block.z >= 0 && block.z < parsed.dimensions.lengthZ)).toBe(true);
  });
});
