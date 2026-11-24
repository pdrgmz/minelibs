import { readFileSync } from 'node:fs';
import { cwd } from 'node:process';
import { describe, expect, it } from 'vitest';
import { ParserError } from './errors';
import { parseSchematic } from './index';
import type { Dimensions, Material } from './types';

interface ExpectedFixture {
  dimensions: Dimensions;
  totalBlocks: number;
  materials: Material[];
  expectError?: boolean;
}

// Vitest ejecuta los tests desde frontend/: equivale a ../../../../samples/ desde src/viewer/parser/.
// import.meta.url no sirve aquí: con jsdom Vite le da esquema http en lugar de file.
const samplesDir = `${cwd()}/../samples/`;
const fixture = (name: string): Uint8Array => readFileSync(`${samplesDir}${name}`);
const fixtureExpected = (name: string): ExpectedFixture =>
  JSON.parse(readFileSync(`${samplesDir}${name}.expected.json`, 'utf8')) as ExpectedFixture;

const validFixtures = [
  'basic.litematic',
  'schem_v2.schem',
  'schem_v3.schem',
  'structure.nbt',
  'multi_region.litematic',
  'double_blocks.nbt',
  'waterlogged.nbt',
];

describe('parser NBT del visor contra fixtures', () => {
  for (const name of validFixtures) {
    it(`${name} coincide con su .expected.json`, async () => {
      const parsed = await parseSchematic(fixture(name));
      expect({
        dimensions: parsed.dimensions,
        totalBlocks: parsed.totalBlocks,
        materials: parsed.materials,
      }).toEqual(fixtureExpected(name));

      expect(parsed.blocks.length).toBeGreaterThan(0);
      for (const block of parsed.blocks) {
        expect(block.x).toBeGreaterThanOrEqual(0);
        expect(block.x).toBeLessThan(parsed.dimensions.widthX);
        expect(block.y).toBeGreaterThanOrEqual(0);
        expect(block.y).toBeLessThan(parsed.dimensions.heightY);
        expect(block.z).toBeGreaterThanOrEqual(0);
        expect(block.z).toBeLessThan(parsed.dimensions.lengthZ);
        expect(block.blockId).toMatch(/^minecraft:/);
      }
    });
  }

  it('rechaza archivos corruptos con ParserError 400', async () => {
    for (const name of ['corrupt.litematic', 'fake_extension.schem']) {
      await expect(parseSchematic(fixture(name))).rejects.toBeInstanceOf(ParserError);
      await expect(parseSchematic(fixture(name))).rejects.toMatchObject({ statusCode: 400, code: expect.any(String) });
    }
  });
});
