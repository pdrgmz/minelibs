import { ParserError } from './errors';

/** bits = max(2, ceil(log2(tamaño de paleta))) salvo indicación contraria (docs/02b). */
export function bitsForPaletteSize(size: number, maxIndex?: number): number {
  const effective = maxIndex === undefined ? size : Math.max(size, maxIndex + 1);
  if (!Number.isInteger(effective) || effective < 1) {
    throw new ParserError('Tamaño de paleta inválido', 'INVALID_PALETTE');
  }
  return Math.max(2, Math.ceil(Math.log2(effective)));
}

/** Litematica: los entries SÍ cruzan el borde entre longs (docs/02b §1). */
export function decodeLitematicLongs(longs: bigint[], count: number, bits: number): number[] {
  ensureCapacity(longs.length, Math.ceil((count * bits) / 64));
  const mask = (1n << BigInt(bits)) - 1n;
  const result: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const bitIndex = BigInt(i) * BigInt(bits);
    const start = Number(bitIndex >> 6n);
    const end = Number((bitIndex + BigInt(bits) - 1n) >> 6n);
    const offset = Number(bitIndex & 63n);
    let value = longs[start] >> BigInt(offset);
    if (start !== end) value |= longs[end] << BigInt(64 - offset);
    result[i] = Number(value & mask);
  }
  return result;
}

/** Sponge v2: floor(64/bits) entries por long, con padding; los entries NO cruzan (docs/02b §2). */
export function decodeSchemV2Longs(longs: bigint[], count: number, bits: number): number[] {
  const entriesPerLong = Math.floor(64 / bits);
  ensureCapacity(longs.length, Math.ceil(count / entriesPerLong));
  const mask = (1n << BigInt(bits)) - 1n;
  const result: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const longIndex = Math.floor(i / entriesPerLong);
    const bitOffset = (i % entriesPerLong) * bits;
    result[i] = Number((longs[longIndex] >> BigInt(bitOffset)) & mask);
  }
  return result;
}

/** Varints de Minecraft: 7 bits por byte, bit 8 = continúa (docs/02b §3). */
export function decodeVarints(bytes: number[], count?: number): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  let used = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (shift > 28 || (shift === 28 && (byte & 0x70) !== 0)) {
      throw new ParserError('Varint NBT demasiado largo', 'INVALID_VARINT');
    }
    // Suma aritmética en lugar de OR bitado: JS usa int32 con signo y 0xffffffff daría -1.
    value += (byte & 0x7f) * 2 ** shift;
    used++;
    if ((byte & 0x80) === 0) {
      values.push(value >>> 0);
      if (count !== undefined && values.length > count) {
        throw new ParserError('El array de datos contiene más varints de lo esperado', 'INVALID_VARINT');
      }
      value = 0;
      shift = 0;
      used = 0;
    } else {
      shift += 7;
    }
  }
  if (used !== 0) throw new ParserError('Varint NBT truncado', 'INVALID_VARINT');
  if (count !== undefined && values.length < count) {
    throw new ParserError(`Faltan varints: se esperaban ${count} y hay ${values.length}`, 'INVALID_VARINT');
  }
  return count === undefined ? values : values.slice(0, count);
}

/** Orden lineal verificado contra los fixtures reales: index = y*W*L + z*W + x. */
export function coordsFromIndex(index: number, width: number, _height: number, length: number) {
  return {
    x: index % width,
    z: Math.floor(index / width) % length,
    y: Math.floor(index / (width * length)),
  };
}

export function linearIndex(x: number, y: number, z: number, width: number, height: number, length: number): number {
  if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= length) {
    throw new ParserError(`Bloque fuera de los límites (${x},${y},${z})`, 'INVALID_COORDINATES');
  }
  return (y * length + z) * width + x;
}

/** Acepta "minecraft:stone[facing=north,waterlogged=true]" y devuelve ID base + propiedades. */
export function parseBlockState(fullName: string): { blockId: string; properties: Record<string, string> } {
  const open = fullName.indexOf('[');
  if (open === -1) return { blockId: fullName, properties: {} };
  if (!fullName.endsWith(']')) throw new ParserError(`Nombre de bloque inválido: ${fullName}`, 'INVALID_BLOCK_STATE');
  const blockId = fullName.slice(0, open);
  const properties: Record<string, string> = {};
  for (const pair of fullName.slice(open + 1, -1).split(',')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) throw new ParserError(`Propiedad inválida en ${fullName}`, 'INVALID_BLOCK_STATE');
    properties[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return { blockId, properties };
}

function ensureCapacity(actual: number, required: number): void {
  if (actual < required) {
    throw new ParserError(`Array de estados demasiado corto: ${actual} longs, se necesitan ${required}`, 'INVALID_BLOCK_STATES');
  }
}
