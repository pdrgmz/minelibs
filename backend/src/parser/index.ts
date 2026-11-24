import { env } from '../config';
import { HttpError } from '../errors';
import type { SchematicFormat } from '../utils/upload';
import {
  asByteArray,
  asCompound,
  asCompoundList,
  asList,
  asLongArray,
  asNumber,
  asNumberList,
  asString,
  field,
  type AnyTag,
  optionalField,
  parseProperties,
  readNbt,
  type CompoundValue,
} from './nbt';
import {
  bitsForPaletteSize,
  coordsFromIndex,
  decodeLitematicLongs,
  decodeSchemV2Longs,
  decodeVarints,
  linearIndex,
  parseBlockState,
} from './blockstates';
import { buildMaterials } from './materials';
import type { BlockState, Dimensions, ParsedBlock, ParsedSchematic } from './types';

function assertDimensions(widthX: number, heightY: number, lengthZ: number): Dimensions {
  const values = [widthX, heightY, lengthZ];
  if (values.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new HttpError(400, `Dimensiones inválidas: ${widthX}×${heightY}×${lengthZ}`, 'INVALID_DIMENSIONS');
  }
  if (values.some((value) => value > env.MAX_DIMENSION)) {
    throw new HttpError(400, `Una dimensión supera el máximo de ${env.MAX_DIMENSION} bloques`, 'DIMENSION_TOO_LARGE');
  }
  const volume = widthX * heightY * lengthZ;
  if (!Number.isSafeInteger(volume) || volume > env.MAX_BLOCKS) {
    throw new HttpError(400, `El volumen supera el máximo de ${env.MAX_BLOCKS} bloques`, 'VOLUME_TOO_LARGE');
  }
  return { widthX, heightY, lengthZ };
}

function blockFromEntry(entry: CompoundValue, where: string): BlockState {
  const parsed = parseBlockState(asString(field(entry, 'Name', where), `${where}.Name`));
  const propertiesTag = optionalField(entry, 'Properties');
  return {
    blockId: parsed.blockId,
    properties: propertiesTag ? { ...parsed.properties, ...parseProperties(propertiesTag, `${where}.Properties`) } : parsed.properties,
  };
}

function blockFromPaletteName(fullName: string, where: string): BlockState {
  return parseBlockState(fullName);
}

function resolve<T>(palette: T[], index: number, where: string): T {
  const value = palette[index];
  if (!value) throw new HttpError(400, `Índice de paleta ${index} fuera de rango en ${where}`, 'INVALID_PALETTE_INDEX');
  return value;
}

/** Paleta global de Sponge: las claves son nombres y los valores sus IDs (que pueden no ser contiguos). */
function paletteById(entries: Array<[string, AnyTag | undefined]>, where: string): BlockState[] {
  const states = entries.map(([name]) => blockFromPaletteName(name, where));
  const ids = entries.map(([name, tag]) => asNumber(tag!, `${where}.${name}`));
  if (ids.some((id) => !Number.isInteger(id) || id < 0)) {
    throw new HttpError(400, `IDs de paleta inválidos en ${where}`, 'INVALID_PALETTE');
  }
  const byId: BlockState[] = new Array(Math.max(-1, ...ids) + 1);
  for (let i = 0; i < entries.length; i++) byId[ids[i]!] = states[i]!;
  if (byId.some((state) => !state)) throw new HttpError(400, `La paleta de ${where} tiene huecos`, 'INVALID_PALETTE');
  return byId;
}

type PlacedBlock = ParsedBlock;

function place(index: number, palette: BlockState[], coords: { x: number; y: number; z: number }, where: string): PlacedBlock {
  const state = resolve(palette, index, where);
  return { ...coords, ...state };
}

async function parseLitematic(buffer: Buffer): Promise<ParsedSchematic> {
  const root = await readNbt(buffer);
  const regions = asCompound(field(root, 'Regions', 'litematic'), 'Regions');
  const entries = Object.entries(regions);
  if (entries.length === 0) throw new HttpError(400, 'El .litematic no contiene regiones', 'INVALID_SCHEMATIC');

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const regionData = entries.map(([name, tag]) => {
    const where = `Regions.${name}`;
    const region = asCompound(tag!, where);
    const sizeNode = asCompound(field(region, 'Size', where), `${where}.Size`);
    const positionNode = asCompound(field(region, 'Position', where), `${where}.Position`);
    const rawSize = ['x', 'y', 'z'].map((axis) => asNumber(field(sizeNode, axis, `${where}.Size`), `${where}.Size.${axis}`));
    const position = ['x', 'y', 'z'].map((axis) => asNumber(field(positionNode, axis, `${where}.Position`), `${where}.Position.${axis}`));
    if (rawSize.some((value) => value === 0)) throw new HttpError(400, `Región ${name} tiene un tamaño cero`, 'INVALID_DIMENSIONS');

    const size = rawSize.map(Math.abs);
    const origin = rawSize.map((value, axis) => (value < 0 ? position[axis]! + value + 1 : position[axis]!));
    for (let axis = 0; axis < 3; axis++) {
      minX = Math.min(minX, origin[0]!);
      minY = Math.min(minY, origin[1]!);
      minZ = Math.min(minZ, origin[2]!);
      maxX = Math.max(maxX, origin[0]! + size[0]! - 1);
      maxY = Math.max(maxY, origin[1]! + size[1]! - 1);
      maxZ = Math.max(maxZ, origin[2]! + size[2]! - 1);
    }

    const palette = asCompoundList(field(region, 'BlockStatePalette', where), `${where}.BlockStatePalette`).map((entry, index) =>
      blockFromEntry(entry, `${where}.BlockStatePalette[${index}]`),
    );
    const longs = asLongArray(field(region, 'BlockStates', where), `${where}.BlockStates`);
    const bits = bitsForPaletteSize(palette.length);
    const volume = size[0]! * size[1]! * size[2]!;
    const indices = decodeLitematicLongs(longs, volume, bits);
    return { size, origin, palette, indices, where };
  });

  const dimensions = assertDimensions(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1);
  const blocks: ParsedBlock[] = [];
  for (const region of regionData) {
    const [width, height, length] = region.size as [number, number, number];
    for (let i = 0; i < region.indices.length; i++) {
      const local = coordsFromIndex(i, width, height, length);
      const x = region.origin[0]! + local.x - minX;
      const y = region.origin[1]! + local.y - minY;
      const z = region.origin[2]! + local.z - minZ;
      blocks.push(place(region.indices[i]!, region.palette, { x, y, z }, `${region.where}.BlockStates[${i}]`));
    }
  }
  return { dimensions, blocks, ...buildMaterials(blocks) };
}

async function parseSchem(buffer: Buffer): Promise<ParsedSchematic> {
  const root = await readNbt(buffer);
  const schematic = asCompound(field(root, 'Schematic', 'schem'), 'Schematic');
  const version = asNumber(field(schematic, 'Version', 'Schematic'), 'Schematic.Version');
  const widthX = asNumber(field(schematic, 'Width', 'Schematic'), 'Schematic.Width');
  const heightY = asNumber(field(schematic, 'Height', 'Schematic'), 'Schematic.Height');
  const lengthZ = asNumber(field(schematic, 'Length', 'Schematic'), 'Schematic.Length');
  const dimensions = assertDimensions(widthX, heightY, lengthZ);
  const volume = widthX * heightY * lengthZ;
  const blocksNode = asCompound(field(schematic, 'Blocks', 'Schematic'), 'Schematic.Blocks');
  const blocks: ParsedBlock[] = [];

  if (version === 2) {
    const paletteNode = asCompound(field(blocksNode, 'Palette', 'Schematic.Blocks'), 'Schematic.Blocks.Palette');
    const maxTag = optionalField(blocksNode, 'PaletteMax');
    const maxIndex = maxTag ? asNumber(maxTag, 'Schematic.Blocks.PaletteMax') : undefined;
    const entries = Object.entries(paletteNode);
    const bits = bitsForPaletteSize(entries.length, maxIndex);
    const byId = paletteById(entries, 'Schematic.Blocks.Palette');
    const longs = asLongArray(field(blocksNode, 'BlockData', 'Schematic.Blocks'), 'Schematic.Blocks.BlockData');
    const indices = decodeSchemV2Longs(longs, volume, bits);
    for (let i = 0; i < indices.length; i++) {
      blocks.push(place(indices[i]!, byId, coordsFromIndex(i, widthX, heightY, lengthZ), `Schematic.Blocks.BlockData[${i}]`));
    }
  } else if (version === 3) {
    const sectionsTag = optionalField(blocksNode, 'Sections');
    if (sectionsTag) {
      const sections = asCompound(sectionsTag, 'Schematic.Blocks.Sections');
      for (const [key, tag] of Object.entries(sections)) {
        const parts = key.split(',').map(Number);
        if (parts.length !== 3 || parts.some((value) => !Number.isInteger(value))) {
          throw new HttpError(400, `Clave de sección inválida: ${key}`, 'INVALID_SECTION');
        }
        const where = `Schematic.Blocks.Sections.${key}`;
        const section = asCompound(tag!, where);
        const palette = asCompoundList(field(section, 'Palette', where), `${where}.Palette`).map((entry, index) =>
          blockFromEntry(entry, `${where}.Palette[${index}]`),
        );
        const data = asByteArray(field(section, 'Data', where), `${where}.Data`);
        const indices = decodeVarints(data, 16 * 16 * 16);
        for (let i = 0; i < indices.length; i++) {
          // docs/02b §3: (localY*16 + localZ)*16 + localX
          const localX = i % 16;
          const localZ = Math.floor(i / 16) % 16;
          const localY = Math.floor(i / 256);
          const x = parts[0]! * 16 + localX;
          const y = parts[1]! * 16 + localY;
          const z = parts[2]! * 16 + localZ;
          if (x >= widthX || y >= heightY || z >= lengthZ) continue;
          blocks.push(place(indices[i]!, palette, { x, y, z }, `${where}.Data[${i}]`));
        }
      }
    } else {
      const paletteNode = asCompound(field(blocksNode, 'Palette', 'Schematic.Blocks'), 'Schematic.Blocks.Palette');
      const entries = Object.entries(paletteNode);
      const byId = paletteById(entries, 'Schematic.Blocks.Palette');
      const data = asByteArray(field(blocksNode, 'Data', 'Schematic.Blocks'), 'Schematic.Blocks.Data');
      const indices = decodeVarints(data, volume);
      for (let i = 0; i < indices.length; i++) {
        blocks.push(place(indices[i]!, byId, coordsFromIndex(i, widthX, heightY, lengthZ), `Schematic.Blocks.Data[${i}]`));
      }
    }
  } else {
    throw new HttpError(400, `Versión de Sponge Schematic no soportada: ${version}`, 'UNSUPPORTED_SCHEM_VERSION');
  }

  return { dimensions, blocks, ...buildMaterials(blocks) };
}

async function parseNbt(buffer: Buffer): Promise<ParsedSchematic> {
  const root = await readNbt(buffer);
  const size = asNumberList(field(root, 'size', 'nbt'), 'size');
  if (size.length !== 3) throw new HttpError(400, 'El campo size de un .nbt debe tener 3 componentes', 'INVALID_DIMENSIONS');
  const [widthX, heightY, lengthZ] = size as [number, number, number];
  const dimensions = assertDimensions(widthX, heightY, lengthZ);

  const plural = optionalField(root, 'palettes');
  let paletteEntries: CompoundValue[];
  if (plural) {
    const palettes = asList(plural, 'palettes');
    if (palettes.type !== 'list' || palettes.value.length === 0) {
      throw new HttpError(400, 'El campo palettes está vacío', 'INVALID_PALETTE');
    }
    // prismarine-nbt devuelve los items de una lista de listas como { type, value }.
    const first = palettes.value[0] as { type: string; value: unknown[] };
    paletteEntries = first.value.map((entry) => asCompound(entry as CompoundValue, 'palettes[0]'));
  } else {
    paletteEntries = asCompoundList(field(root, 'palette', 'nbt'), 'palette');
  }
  const palette = paletteEntries.map((entry, index) => blockFromEntry(entry, `palette[${index}]`));

  const dense: Array<BlockState | undefined> = new Array(widthX * heightY * lengthZ);
  const blockEntries = asCompoundList(field(root, 'blocks', 'nbt'), 'blocks');
  for (let i = 0; i < blockEntries.length; i++) {
    const entry = blockEntries[i]!;
    const pos = asNumberList(field(entry, 'pos', `blocks[${i}]`), `blocks[${i}].pos`);
    if (pos.length !== 3) throw new HttpError(400, `pos inválido en blocks[${i}]`, 'INVALID_COORDINATES');
    const [x, y, z] = pos as [number, number, number];
    const state = asNumber(field(entry, 'state', `blocks[${i}]`), `blocks[${i}].state`);
    const stateIndex = Math.trunc(state);
    if (stateIndex < 0) throw new HttpError(400, `Estado negativo en blocks[${i}]`, 'INVALID_PALETTE_INDEX');
    dense[linearIndex(x, y, z, widthX, heightY, lengthZ)] = resolve(palette, stateIndex, `blocks[${i}].state`);
  }

  const blocks: ParsedBlock[] = [];
  for (let y = 0; y < heightY; y++) {
    for (let z = 0; z < lengthZ; z++) {
      for (let x = 0; x < widthX; x++) {
        const state = dense[linearIndex(x, y, z, widthX, heightY, lengthZ)];
        if (state) blocks.push({ x, y, z, ...state });
      }
    }
  }
  return { dimensions, blocks, ...buildMaterials(blocks) };
}

/** Parseo completo. Nunca se llama con datos sin validar previamente (extensiones/magic bytes). */
export async function parseSchematic(buffer: Buffer, format: SchematicFormat): Promise<ParsedSchematic> {
  try {
    if (format === 'LITEMATIC') return await parseLitematic(buffer);
    if (format === 'SCHEM') return await parseSchem(buffer);
    if (format === 'NBT') return await parseNbt(buffer);
    throw new HttpError(400, 'Formato desconocido', 'INVALID_EXTENSION');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error ? error.message : 'No se pudo parsear el schematic', 'INVALID_SCHEMATIC', { cause: error });
  }
}
