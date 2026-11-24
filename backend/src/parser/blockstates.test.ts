import { describe, expect, it } from 'vitest';
import {
  bitsForPaletteSize,
  coordsFromIndex,
  decodeLitematicLongs,
  decodeSchemV2Longs,
  decodeVarints,
  linearIndex,
  parseBlockState,
} from './blockstates';

/** Empaquetado contiguo de Litematica: bits corriendo de right a left through longs. */
function packCrossing(values: number[], bits: number): bigint[] {
  let acc = 0n;
  for (let i = values.length - 1; i >= 0; i--) acc = (acc << BigInt(bits)) | BigInt(values[i]!);
  const longs: bigint[] = [];
  for (let i = 0; i < Math.ceil((values.length * bits) / 64); i++) {
    longs.push(acc & 0xffff_ffff_ffff_ffffn);
    acc >>= 64n;
  }
  return longs;
}

/** Empaquetado de Sponge v2: floor(64/bits) entries por long, sin cruces. */
function packPerLong(values: number[], bits: number): bigint[] {
  const per = Math.floor(64 / bits);
  const longs: bigint[] = [];
  for (let base = 0; base < values.length; base += per) {
    let acc = 0n;
    const chunk = values.slice(base, base + per);
    for (let i = chunk.length - 1; i >= 0; i--) acc = (acc << BigInt(bits)) | BigInt(chunk[i]!);
    longs.push(acc);
  }
  return longs;
}

describe('bitsForPaletteSize (docs/02b)', () => {
  it('usa un mínimo de 2 bits y ceil(log2(paleta))', () => {
    expect(bitsForPaletteSize(1)).toBe(2);
    expect(bitsForPaletteSize(2)).toBe(2);
    expect(bitsForPaletteSize(3)).toBe(2);
    expect(bitsForPaletteSize(4)).toBe(2);
    expect(bitsForPaletteSize(5)).toBe(3);
    expect(bitsForPaletteSize(17)).toBe(5);
    expect(bitsForPaletteSize(33)).toBe(6);
  });

  it('respeta PaletteMax de Sponge v2 aunque haya huecos', () => {
    expect(bitsForPaletteSize(3, 3)).toBe(2);
    expect(bitsForPaletteSize(3, 4)).toBe(3);
    expect(bitsForPaletteSize(3, 8)).toBe(4);
  });
});

describe('decodificación de longs (docs/02b)', () => {
  it('Litematica: un entry de 6 bits cruza el borde entre longs', () => {
    const values = Array.from({ length: 11 }, () => 0);
    values[10] = 32; // bits 60..65 → cruza el long 0 al 1
    expect(decodeLitematicLongs(packCrossing(values, 6), values.length, 6)).toEqual(values);
  });

  it('Litematica: 5 bits con valores altos y paleta de 30 estados', () => {
    const values = [0, 1, 2, 3, 4, 29, 28, 27, 26, 25, 24, 23, 22, 21];
    expect(decodeLitematicLongs(packCrossing(values, 5), values.length, 5)).toEqual(values);
  });

  it('Sponge v2: 2 bits por entry con padding, sin cruzar longs', () => {
    const values = [0, 1, 2, 0, 1, 2, 1, 0, 2, 2, 1, 1, 0, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3];
    expect(decodeSchemV2Longs(packPerLong(values, 2), values.length, 2)).toEqual(values);
  });

  it('Sponge v2: bits=5 deja 4 entries por long con padding', () => {
    const values = [31, 0, 17, 5, 9, 30, 1, 2, 3, 4, 5, 6];
    expect(decodeSchemV2Longs(packPerLong(values, 5), values.length, 5)).toEqual(values);
  });

  it('rechaza arrays de BlockStates demasiado cortos', () => {
    expect(() => decodeLitematicLongs([0n], 100, 6)).toThrow('Array de estados demasiado corto');
    expect(() => decodeSchemV2Longs([0n], 100, 6)).toThrow('Array de estados demasiado corto');
  });
});

describe('decodeVarints (docs/02b §3)', () => {
  it('decodifica valores de 1 a 5 bytes', () => {
    expect(decodeVarints([0x00])).toEqual([0]);
    expect(decodeVarints([0x7f])).toEqual([127]);
    expect(decodeVarints([0x80, 0x01])).toEqual([128]);
    expect(decodeVarints([0xff, 0xff, 0xff, 0xff, 0x0f])).toEqual([4294967295]);
  });

  it('respeta el número esperado de varints', () => {
    expect(decodeVarints([1, 2, 3], 3)).toEqual([1, 2, 3]);
    expect(() => decodeVarints([1, 2], 3)).toThrow('Faltan varints');
    expect(() => decodeVarints([1, 2, 3], 2)).toThrow('más varints de lo esperado');
  });

  it('rechaza varints truncados o demasiado largos', () => {
    expect(() => decodeVarints([0x80])).toThrow('Varint NBT truncado');
    expect(() => decodeVarints([0x80, 0x80, 0x80, 0x80, 0x80, 0x01])).toThrow('Varint NBT demasiado largo');
  });
});

describe('índices y nombres de bloques', () => {
  it('convierte índices lineales en coordenadas YXZ y viceversa', () => {
    expect(coordsFromIndex(0, 13, 8, 18)).toEqual({ x: 0, y: 0, z: 0 });
    expect(coordsFromIndex(1, 13, 8, 18)).toEqual({ x: 1, y: 0, z: 0 });
    expect(coordsFromIndex(13, 13, 8, 18)).toEqual({ x: 0, y: 0, z: 1 });
    expect(coordsFromIndex(13 * 18, 13, 8, 18)).toEqual({ x: 0, y: 1, z: 0 });
    expect(linearIndex(12, 7, 17, 13, 8, 18)).toBe(7 * 13 * 18 + 17 * 13 + 12);
    expect(() => linearIndex(13, 0, 0, 13, 8, 18)).toThrow('Bloque fuera de los límites');
  });

  it('separa el ID base de las propiedades', () => {
    expect(parseBlockState('minecraft:repeater[delay=2,facing=north,locked=false]')).toEqual({
      blockId: 'minecraft:repeater',
      properties: { delay: '2', facing: 'north', locked: 'false' },
    });
    expect(parseBlockState('minecraft:stone')).toEqual({ blockId: 'minecraft:stone', properties: {} });
    expect(() => parseBlockState('minecraft:stone[facing]')).toThrow('Propiedad inválida');
  });
});
