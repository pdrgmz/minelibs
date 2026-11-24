import { parse, type Compound, type NBT, type Tags } from 'prismarine-nbt';
import { HttpError } from '../errors';

export type AnyTag = Tags[keyof Tags];
export type CompoundValue = Record<string, AnyTag | undefined>;

/** Lee cualquier NBT (GZIP, Zlib o crudo) exclusivamente con prismarine-nbt. */
export async function readNbt(buffer: Buffer): Promise<CompoundValue> {
  let root: NBT;
  try {
    ({ parsed: root } = await parse(buffer));
  } catch (error) {
    throw new HttpError(400, 'El árbol NBT es inválido o está corrupto', 'INVALID_NBT', { cause: error });
  }
  if (root?.type !== 'compound') {
    throw new HttpError(400, 'La raíz del archivo NBT no es un compound', 'INVALID_NBT');
  }
  return root.value as CompoundValue;
}

export function field(node: CompoundValue, key: string, where: string): AnyTag {
  const tag = node[key];
  if (!tag) throw new HttpError(400, `Falta el campo NBT "${key}" en ${where}`, 'INVALID_NBT');
  return tag;
}

export function optionalField(node: CompoundValue, key: string): AnyTag | undefined {
  return node[key];
}

export function asCompound(node: CompoundValue | AnyTag, where: string): CompoundValue {
  const tag = node as AnyTag;
  if (tag?.type !== 'compound') throw new HttpError(400, `Se esperaba un compound en ${where}`, 'INVALID_NBT');
  return (tag as Compound).value as CompoundValue;
}

export function asList(tag: AnyTag, where: string): { type: string; value: unknown[] } {
  if (tag?.type !== 'list') throw new HttpError(400, `Se esperaba una lista en ${where}`, 'INVALID_NBT');
  const list = (tag as Tags['list']).value;
  return { type: list.type, value: list.value as unknown[] };
}

export function asCompoundList(tag: AnyTag, where: string): CompoundValue[] {
  const list = asList(tag, where);
  if (list.type !== 'compound') throw new HttpError(400, `Se esperaba una lista de compounds en ${where}`, 'INVALID_NBT');
  return list.value as CompoundValue[];
}

export function asNumber(tag: AnyTag, where: string): number {
  if (tag?.type !== 'byte' && tag.type !== 'short' && tag.type !== 'int' && tag.type !== 'float' && tag.type !== 'double') {
    throw new HttpError(400, `Se esperaba un número en ${where}`, 'INVALID_NBT');
  }
  const value = Number(tag.value);
  if (!Number.isFinite(value)) throw new HttpError(400, `Número inválido en ${where}`, 'INVALID_NBT');
  return value;
}

export function asString(tag: AnyTag, where: string): string {
  if (tag?.type !== 'string') throw new HttpError(400, `Se esperaba un string en ${where}`, 'INVALID_NBT');
  return tag.value;
}

export function asNumberList(tag: AnyTag, where: string): number[] {
  const list = asList(tag, where);
  if (!['byte', 'short', 'int'].includes(list.type)) {
    throw new HttpError(400, `Se esperaba una lista de enteros en ${where}`, 'INVALID_NBT');
  }
  const values = list.value.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new HttpError(400, `Entero inválido en ${where}`, 'INVALID_NBT');
  }
  return values;
}

export function asByteArray(tag: AnyTag, where: string): number[] {
  if (tag?.type !== 'byteArray') throw new HttpError(400, `Se esperaba un byte array en ${where}`, 'INVALID_NBT');
  return Array.from(tag.value).map(Number);
}

/** Los long arrays NBT llegan como pares [high, low] de int32 con signo. */
export function longToBigInt([hi, lo]: [number, number]): bigint {
  return (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
}

export function asLongArray(tag: AnyTag, where: string): bigint[] {
  if (tag?.type !== 'longArray') throw new HttpError(400, `Se esperaba un long array en ${where}`, 'INVALID_NBT');
  return tag.value.map((pair) => longToBigInt(pair as [number, number]));
}

export function parseProperties(tag: AnyTag | undefined, where: string): Record<string, string> {
  if (!tag) return {};
  const properties = asCompound(tag, where);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    result[key] = asString(value!, `${where}.${key}`);
  }
  return result;
}
