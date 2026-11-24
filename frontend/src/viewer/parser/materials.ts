import type { BlockState, Material } from './types';

/** Incrementar al cambiar exclusiones, mapeo bloque→ítem o stackSize (AGENTS.md §6.4). */
export const PARSER_VERSION = 2;

/** Aire y bloques técnicos/no obtenibles (AGENTS.md §4.2). */
export const EXCLUDED_BLOCKS = new Set([
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

export function isIncluded(blockId: string): boolean {
  return !EXCLUDED_BLOCKS.has(blockId);
}

function stackSizeFor(itemId: string): number {
  // Camas (cualquier color) apiladas de 1 en 1.
  if (itemId === 'minecraft:bed' || itemId.endsWith('_bed')) return 1;
  // Carteles y velas se apilan de 16 en 16 (AGENTS.md §4.2).
  if (itemId === 'minecraft:sign' || itemId.endsWith('_sign') || itemId.endsWith('_candle') || itemId === 'minecraft:candle') return 16;
  return 64;
}

/**
 * Convierte un bloque en su ítem de compra. Las mitades superiores de
 * puertas/camas/plantas altas cuentan como 0 ítems (el par completo es 1).
 */
export function toItem(block: BlockState): { itemId: string; stackSize: number } | null {
  const id = block.blockId;

  if (id.endsWith('_door') && block.properties.half === 'upper') return null;
  if (id.endsWith('_bed') && block.properties.part === 'head') return null;
  if (TALL_PLANTS.has(id) && block.properties.half === 'upper') return null;

  let itemId = DIRECT_ITEMS[id];
  if (!itemId && id.endsWith('_wall_sign')) itemId = `${id.slice(0, -'_wall_sign'.length)}_sign`;
  if (!itemId && id.endsWith('_wall_hanging_sign')) itemId = `${id.slice(0, -'_wall_hanging_sign'.length)}_hanging_sign`;
  if (!itemId && id.endsWith('_wall_banner')) itemId = `${id.slice(0, -'_wall_banner'.length)}_banner`;
  itemId ??= id;

  return { itemId, stackSize: stackSizeFor(itemId) };
}

export function displayName(itemId: string): string {
  const withoutNamespace = itemId.includes(':') ? itemId.slice(itemId.indexOf(':') + 1) : itemId;
  return withoutNamespace
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** totalBlocks = bloques físicos (excluidos aire/técnicos); materials = ítems. */
export function buildMaterials(blocks: BlockState[]): { totalBlocks: number; materials: Material[] } {
  const counts = new Map<string, { count: number; stackSize: number }>();
  let totalBlocks = 0;

  for (const block of blocks) {
    if (!isIncluded(block.blockId)) continue;
    totalBlocks++;
    const item = toItem(block);
    if (!item) continue;
    const current = counts.get(item.itemId);
    if (current) current.count += 1;
    else counts.set(item.itemId, { count: 1, stackSize: item.stackSize });
  }

  const materials = [...counts.entries()]
    .map(([blockId, { count, stackSize }]) => ({ blockId, displayName: displayName(blockId), count, stackSize }))
    .sort((a, b) => b.count - a.count || a.blockId.localeCompare(b.blockId));

  return { totalBlocks, materials };
}
