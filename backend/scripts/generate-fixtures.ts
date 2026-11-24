/**
 * Genera los fixtures sintéticos de samples/ y sus .expected.json.
 * Uso: npm run fixtures:generate
 * Los fixtures reales (dos granjas en tres formatos) no se modifican.
 */
import { gzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nbt from 'prismarine-nbt';
import { parseSchematic } from '../src/parser';
import type { SchematicFormat } from '../src/utils/upload';
import { summarize } from '../src/parser/types';

const samples = path.resolve(__dirname, '../../samples');
const MASK64 = 0xffff_ffff_ffff_ffffn;

type Tag = { type: string; value: unknown };
// Se usan los builders de prismarine-nbt para no reimplementar la escritura NBT.
const int = nbt.int as (value: number) => Tag;
const short = nbt.short as (value: number) => Tag;
const string = nbt.string as (value: string) => Tag;
const comp = nbt.comp as (value: Record<string, Tag>) => Tag;
const byteArray = nbt.byteArray as (value: number[]) => Tag;
/** En una lista NBT, los compounds se escriben por su valor, sin envoltorio de tag. */
const list = (type: string, value: unknown[]): Tag => ({
  type: 'list',
  value: {
    type,
    value: type === 'compound' ? value.map((item) => (item as Tag & { name?: string }).value ?? item) : value,
  },
});
const longArray = (value: Array<[number, number]>): Tag => ({ type: 'longArray', value });

function toPair(value: bigint): [number, number] {
  const unsigned = value & MASK64;
  const toSigned = (n: bigint) => {
    const num = Number(n);
    return num >= 0x8000_0000 ? num - 0x1_0000_0000 : num;
  };
  return [toSigned(unsigned >> 32n), toSigned(unsigned & 0xffff_ffffn)];
}

/** Empaquetado contiguo: un entry puede cruzar el borde de un long (Litematica). */
function packCrossing(values: number[], bits: number): Array<[number, number]> {
  let acc = 0n;
  for (let i = values.length - 1; i >= 0; i--) acc = (acc << BigInt(bits)) | BigInt(values[i]!);
  const longs: Array<[number, number]> = [];
  const count = Math.ceil((values.length * bits) / 64);
  for (let i = 0; i < count; i++) {
    longs.push(toPair(acc & MASK64));
    acc >>= 64n;
  }
  return longs;
}

/** Empaquetado por long con padding: floor(64/bits) entries por long (Sponge v2). */
function packPerLong(values: number[], bits: number): Array<[number, number]> {
  const per = Math.floor(64 / bits);
  const longs: Array<[number, number]> = [];
  for (let base = 0; base < values.length; base += per) {
    let acc = 0n;
    const chunk = values.slice(base, base + per);
    for (let i = chunk.length - 1; i >= 0; i--) acc = (acc << BigInt(bits)) | BigInt(chunk[i]!);
    longs.push(toPair(acc));
  }
  return longs;
}

function varint(value: number): number[] {
  const bytes: number[] = [];
  let current = value >>> 0;
  do {
    let byte = current & 0x7f;
    current >>>= 7;
    if (current !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (current !== 0);
  return bytes;
}

const entry = (name: string, properties?: Record<string, string>): Tag =>
  comp(properties ? { Name: string(name), Properties: comp(Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, string(v)]))) } : { Name: string(name) });

const nbtFile = (root: Tag): Buffer => gzipSync(nbt.writeUncompressed({ ...root, name: '' } as never, 'big'));

const fixtures: Array<{ name: string; format: SchematicFormat; buffer: Buffer; expectError?: boolean }> = [];

function add(name: string, format: SchematicFormat, root: Tag): void {
  fixtures.push({ name, format, buffer: nbtFile(root) });
}

// 1. Una región, 2×2×2, air + stone + dirt. bits = 2.
{
  const palette = [entry('minecraft:air'), entry('minecraft:stone'), entry('minecraft:dirt')];
  const values = [0, 1, 0, 0, 0, 0, 0, 2]; // stone en (0,0,0), dirt en (1,1,1)
  add('basic.litematic', 'LITEMATIC', comp({
    Version: int(6),
    Regions: comp({ Main: comp({
      Position: comp({ x: int(0), y: int(0), z: int(0) }),
      Size: comp({ x: int(2), y: int(2), z: int(2) }),
      BlockStatePalette: list('compound', palette),
      BlockStates: longArray(packCrossing(values, 2)),
    }) }),
  }));
}

// 2. Dos regiones, una con tamaño negativo → bounding box global 6×2×6.
{
  const palette = [entry('minecraft:air'), entry('minecraft:stone')];
  const regionA = comp({
    // position.x = 5, size.x = -2 → origin.x = 4, abarca x=4,5
    Position: comp({ x: int(5), y: int(0), z: int(5) }),
    Size: comp({ x: int(-2), y: int(1), z: int(1) }),
    BlockStatePalette: list('compound', palette),
    BlockStates: longArray(packCrossing([1, 1], 2)),
  });
  const regionB = comp({
    Position: comp({ x: int(0), y: int(0), z: int(0) }),
    Size: comp({ x: int(1), y: int(2), z: int(2) }),
    BlockStatePalette: list('compound', palette),
    BlockStates: longArray(packCrossing([0, 0, 0, 1], 2)),
  });
  add('multi_region.litematic', 'LITEMATIC', comp({
    Version: int(6),
    Regions: comp({ A: regionA, B: regionB }),
  }));
}

// 3. Entry 10 (bits 60–65) cruza el límite de 64 bits con bits=6.
{
  const palette = [entry('minecraft:air'), ...Array.from({ length: 32 }, (_, i) => entry(`minecraft:test_block_${i}`))];
  const values = new Array<number>(11).fill(0);
  values[10] = 32;
  add('bit_boundary.litematic', 'LITEMATIC', comp({
    Version: int(6),
    Regions: comp({ Main: comp({
      Position: comp({ x: int(0), y: int(0), z: int(0) }),
      Size: comp({ x: int(11), y: int(1), z: int(1) }),
      BlockStatePalette: list('compound', palette),
      BlockStates: longArray(packCrossing(values, 6)),
    }) }),
  }));
}

// 4. Sponge v2: 4×1×2, bits=2, 8 entries en un long con padding.
{
  const palette: Record<string, Tag> = { 'minecraft:air': int(0), 'minecraft:stone': int(1), 'minecraft:dirt': int(2) };
  const values = [0, 1, 2, 0, 1, 2, 1, 0];
  add('schem_v2.schem', 'SCHEM', comp({ Schematic: comp({
    Version: int(2),
    Width: short(4), Height: short(1), Length: short(2),
    Blocks: comp({
      Palette: comp(palette),
      PaletteMax: int(3),
      BlockData: longArray(packPerLong(values, 2)),
    }),
  }) }));
}

// 5. Sponge v3 con secciones: 16×32×16, dos secciones (0,0,0) y (0,1,0).
{
  const palette = [entry('minecraft:air'), entry('minecraft:stone'), entry('minecraft:dirt'), entry('minecraft:torch')];
  const sectionData = (placements: Array<[number, number]>) => {
    const data = new Array<number>(4096).fill(0);
    for (const [index, state] of placements) data[index] = state;
    return byteArray(data.flatMap(varint));
  };
  // (localY*16 + localZ)*16 + localX
  const stoneIndex = (2 * 16 + 3) * 16 + 1;
  const dirtIndex = (3 * 16 + 4) * 16 + 2;
  add('schem_v3.schem', 'SCHEM', comp({ Schematic: comp({
    Version: int(3),
    Width: short(16), Height: short(32), Length: short(16),
    Blocks: comp({ Sections: comp({
      '0,0,0': comp({ Palette: list('compound', palette), Data: sectionData([[stoneIndex, 1], [dirtIndex, 2]]) }),
      '0,1,0': comp({ Palette: list('compound', palette), Data: sectionData([[0, 3]]) }),
    }) }),
  }) }));
}

// 6. Estructura vanilla con posiciones explícitas + líquidos ignorados.
{
  add('structure.nbt', 'NBT', comp({
    size: list('int', [3, 2, 2]),
    palette: list('compound', [entry('minecraft:air'), entry('minecraft:stone'), entry('minecraft:dirt')]),
    fluid_palette: list('compound', [entry('minecraft:water')]),
    blocks: list('compound', [
      comp({ pos: list('int', [0, 0, 0]), state: int(1) }),
      comp({ pos: list('int', [2, 1, 1]), state: int(2) }),
    ]),
  }));
}

// 7. Exclusiones: agua/lava/piston_head/etc. fuera; dos stairs waterlogged agrupadas.
{
  const technical = [
    'minecraft:water', 'minecraft:lava', 'minecraft:bubble_column', 'minecraft:piston_head',
    'minecraft:moving_piston', 'minecraft:fire', 'minecraft:soul_fire', 'minecraft:light',
    'minecraft:frosted_ice', 'minecraft:nether_portal', 'minecraft:end_portal', 'minecraft:end_gateway',
    'minecraft:air', 'minecraft:cave_air', 'minecraft:void_air', 'minecraft:structure_void',
  ];
  const palette = [
    ...technical.map((name) => entry(name)),
    entry('minecraft:oak_stairs', { facing: 'north', waterlogged: 'true' }),
    entry('minecraft:oak_stairs', { facing: 'south', waterlogged: 'true', half: 'top' }),
  ];
  const blocks = palette.map((_, state) => comp({ pos: list('int', [state, 0, 0]), state: int(state) }));
  add('waterlogged.nbt', 'NBT', comp({
    size: list('int', [palette.length, 1, 1]),
    palette: list('compound', palette),
    blocks: list('compound', blocks),
  }));
}

// 8. Bloques dobles: puerta, cama, planta alta y cartel de pared.
{
  const palette = [
    entry('minecraft:air'),
    entry('minecraft:oak_door', { half: 'lower', facing: 'north' }),
    entry('minecraft:oak_door', { half: 'upper', facing: 'north' }),
    entry('minecraft:red_bed', { part: 'foot', facing: 'north' }),
    entry('minecraft:red_bed', { part: 'head', facing: 'north' }),
    entry('minecraft:sunflower', { half: 'lower' }),
    entry('minecraft:sunflower', { half: 'upper' }),
    entry('minecraft:oak_wall_sign', { facing: 'north', waterlogged: 'false' }),
  ];
  add('double_blocks.nbt', 'NBT', comp({
    size: list('int', [8, 2, 1]),
    palette: list('compound', palette),
    blocks: list('compound', [
      comp({ pos: list('int', [0, 0, 0]), state: int(1) }),
      comp({ pos: list('int', [0, 1, 0]), state: int(2) }),
      comp({ pos: list('int', [1, 0, 0]), state: int(3) }),
      comp({ pos: list('int', [1, 1, 0]), state: int(4) }),
      comp({ pos: list('int', [2, 0, 0]), state: int(5) }),
      comp({ pos: list('int', [2, 1, 0]), state: int(6) }),
      comp({ pos: list('int', [3, 0, 0]), state: int(7) }),
    ]),
  }));
}

// 9 y 10. Archivos corruptos: GZIP válido con NBT inválido.
fixtures.push({ name: 'corrupt.litematic', format: 'LITEMATIC', buffer: gzipSync(Buffer.from([0x0a, 0xff, 0xff, 0xff])), expectError: true });
fixtures.push({ name: 'fake_extension.schem', format: 'SCHEM', buffer: gzipSync(Buffer.from('esto no es un árbol NBT')), expectError: true });

async function main(): Promise<void> {
  for (const fixture of fixtures) {
    await writeFile(path.join(samples, fixture.name), fixture.buffer);
    if (fixture.expectError) {
      await writeFile(path.join(samples, `${fixture.name}.expected.json`), JSON.stringify({ expectError: true }, null, 2) + '\n');
      continue;
    }
    const parsed = await parseSchematic(fixture.buffer, fixture.format);
    await writeFile(path.join(samples, `${fixture.name}.expected.json`), JSON.stringify(summarize(parsed), null, 2) + '\n');
  }
  // Expected de los fixtures reales (verificados además por concordancia entre los 3 formatos).
  for (const name of ['granja-de-cooblestone-rapida', 'bamboo-farm-720k-bamboo-per-hour-bonemeal-dependent']) {
    for (const ext of ['litematic', 'schem', 'nbt'] as const) {
      const buffer = await readFile(path.join(samples, `${name}.${ext}`));
      const parsed = await parseSchematic(buffer, ext.toUpperCase() as SchematicFormat);
      await writeFile(path.join(samples, `${name}.${ext}.expected.json`), JSON.stringify(summarize(parsed), null, 2) + '\n');
    }
  }
  console.log(`Generados ${fixtures.length} fixtures sintéticos y sus expected.json`);
}

void main();
