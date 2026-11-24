/**
 * Capa de presentación de materiales (docs/01 §3.2, docs/04 Fase 3 tarea 9).
 *
 * La lógica de exclusión, mapeo bloque→ítem y stackSize se copia de
 * `backend/src/parser/materials.ts` (PARSER_VERSION=2) para que el visor y el
 * backend calculen exactamente lo mismo.
 */

import type { Material } from '../types';

export interface MaterialRow extends Material {
  stacks: number;
  shulkers: number;
}

const STACKS_PER_SHULKER = 27;

/** Aire y bloques técnicos/no obtenibles (AGENTS.md §4.2). */
const EXCLUDED_BLOCKS = new Set([
  'minecraft:air',
  'minecraft:cave_air',
  'minecraft:void_air',
  'minecraft:structure_void',
  'minecraft:water',
  'minecraft:lava',
  'minecraft:bubble_column',
  'minecraft:piston_head',
  'minecraft:moving_piston',
  'minecraft:fire',
  'minecraft:soul_fire',
  'minecraft:light',
  'minecraft:frosted_ice',
  'minecraft:nether_portal',
  'minecraft:end_portal',
  'minecraft:end_gateway',
]);

const DIRECT_ITEMS: Record<string, string> = {
  'minecraft:redstone_wire': 'minecraft:redstone',
  'minecraft:wall_torch': 'minecraft:torch',
  'minecraft:soul_wall_torch': 'minecraft:soul_torch',
  'minecraft:redstone_wall_torch': 'minecraft:redstone_torch',
};

const TALL_PLANTS = new Set([
  'minecraft:sunflower',
  'minecraft:lilac',
  'minecraft:rose_bush',
  'minecraft:peony',
  'minecraft:large_fern',
  'minecraft:tall_grass',
  'minecraft:tall_seagrass',
  'minecraft:pitcher_plant',
]);

function isIncluded(blockId: string): boolean {
  return !EXCLUDED_BLOCKS.has(blockId);
}

function stackSizeFor(itemId: string): number {
  // Camas (cualquier color) apiladas de 1 en 1.
  if (itemId === 'minecraft:bed' || itemId.endsWith('_bed')) return 1;
  // Carteles y velas se apilan de 16 en 16 (AGENTS.md §4.2).
  if (
    itemId === 'minecraft:sign' ||
    itemId.endsWith('_sign') ||
    itemId.endsWith('_candle') ||
    itemId === 'minecraft:candle'
  ) {
    return 16;
  }
  return 64;
}

/** Igual que `toItem` del backend: las mitades superiores cuentan 0 ítems. */
function toItem(block: {
  blockId: string;
  properties: Record<string, string>;
}): { itemId: string; stackSize: number } | null {
  const id = block.blockId;

  if (id.endsWith('_door') && block.properties.half === 'upper') return null;
  if (id.endsWith('_bed') && block.properties.part === 'head') return null;
  if (TALL_PLANTS.has(id) && block.properties.half === 'upper') return null;

  let itemId = DIRECT_ITEMS[id];
  if (!itemId && id.endsWith('_wall_sign')) {
    itemId = `${id.slice(0, -'_wall_sign'.length)}_sign`;
  }
  if (!itemId && id.endsWith('_wall_hanging_sign')) {
    itemId = `${id.slice(0, -'_wall_hanging_sign'.length)}_hanging_sign`;
  }
  if (!itemId && id.endsWith('_wall_banner')) {
    itemId = `${id.slice(0, -'_wall_banner'.length)}_banner`;
  }
  itemId ??= id;

  return { itemId, stackSize: stackSizeFor(itemId) };
}

function displayName(itemId: string): string {
  const withoutNamespace = itemId.includes(':')
    ? itemId.slice(itemId.indexOf(':') + 1)
    : itemId;
  return withoutNamespace
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function sortMaterials(counts: Map<string, { count: number; stackSize: number }>): Material[] {
  return [...counts.entries()]
    .map(([blockId, { count, stackSize }]) => ({
      blockId,
      displayName: displayName(blockId),
      count,
      stackSize,
    }))
    .sort((a, b) => b.count - a.count || a.blockId.localeCompare(b.blockId));
}

/** Añade stacks/shulkers y mantiene el orden count DESC, blockId ASC. */
export function presentMaterials(materials: Material[]): MaterialRow[] {
  return materials
    .map((material) => {
      const stacks = Math.ceil(material.count / material.stackSize);
      return {
        ...material,
        stacks,
        shulkers: Math.ceil(stacks / STACKS_PER_SHULKER),
      };
    })
    .sort((a, b) => b.count - a.count || a.blockId.localeCompare(b.blockId));
}

/**
 * Materiales de una capa Y. Las propiedades se ignoran para agrupar y normalizar
 * (solo se conserva `half`/`part` para replicar el conteo de puertas, camas y
 * plantas altas del backend). Los block states que vengan dentro de `blockId`
 * entre corchetes se descartan.
 */
export function materialsForLayer(
  blocks: Array<{
    x: number;
    y: number;
    z: number;
    blockId: string;
    properties: Record<string, string>;
  }>,
  y: number,
): Material[] {
  const counts = new Map<string, { count: number; stackSize: number }>();

  for (const block of blocks) {
    if (block.y !== y) continue;

    const bracket = block.blockId.indexOf('[');
    const blockId = (bracket === -1 ? block.blockId : block.blockId.slice(0, bracket)).trim();
    if (!isIncluded(blockId)) continue;

    const item = toItem({ blockId, properties: block.properties });
    if (!item) continue;

    const current = counts.get(item.itemId);
    if (current) current.count += 1;
    else counts.set(item.itemId, { count: 1, stackSize: item.stackSize });
  }

  return sortMaterials(counts);
}

/** Texto plano: `count × displayName (blockId) — N stacks / M shulkers`. */
export function materialsToText(rows: MaterialRow[]): string {
  if (rows.length === 0) return '';
  return (
    rows
      .map(
        (row) =>
          `${row.count} × ${row.displayName} (${row.blockId}) — ${row.stacks} stacks / ${row.shulkers} shulkers`,
      )
      .join('\n') + '\n'
  );
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV con comillas dobles escapadas y salto de línea al final de cada fila. */
export function materialsToCsv(rows: MaterialRow[]): string {
  const header = 'blockId,displayName,count,stackSize,stacks,shulkers';
  const lines = rows.map((row) =>
    [row.blockId, row.displayName, row.count, row.stackSize, row.stacks, row.shulkers]
      .map(csvCell)
      .join(','),
  );
  return [header, ...lines].map((line) => `${line}\n`).join('');
}

/** Búsqueda case-insensitive por displayName o blockId; conserva el orden. */
export function filterMaterials(rows: MaterialRow[], query: string): MaterialRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter(
    (row) =>
      row.displayName.toLowerCase().includes(needle) ||
      row.blockId.toLowerCase().includes(needle),
  );
}
