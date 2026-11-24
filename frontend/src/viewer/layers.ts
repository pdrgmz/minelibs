import type { Dimensions, ParsedBlock } from './parser/types';

/**
 * ID base de un bloque: sin propiedades (`[facing=north]`) y sin namespace.
 * Así `minecraft:repeater[delay=2]` y `repeater` son equivalentes.
 */
export function baseBlockId(blockId: string): string {
  const withoutProperties = blockId.split('[')[0] ?? blockId;
  const separator = withoutProperties.indexOf(':');
  return separator >= 0 ? withoutProperties.slice(separator + 1) : withoutProperties;
}

/** Devuelve una copia filtrada; nunca modifica el array de entrada. */
export function filterBlocks(
  blocks: ParsedBlock[],
  layerY: number | null,
  highlight: string | null,
): ParsedBlock[] {
  const wanted = highlight === null ? null : baseBlockId(highlight);
  return blocks.filter((block) => {
    if (layerY !== null && block.y !== layerY) return false;
    return wanted === null || baseBlockId(block.blockId) === wanted;
  });
}

/** Claves únicas `cx,cy,cz` de las secciones 16³ (o del tamaño indicado) presentes. */
export function chunkKeys(blocks: ParsedBlock[], chunkSize = 16): string[] {
  const size = Number.isFinite(chunkSize) && chunkSize >= 1 ? Math.floor(chunkSize) : 16;
  const keys = new Set<string>();
  for (const block of blocks) {
    const cx = Math.floor(block.x / size);
    const cy = Math.floor(block.y / size);
    const cz = Math.floor(block.z / size);
    keys.add(`${cx},${cy},${cz}`);
  }
  return [...keys];
}

export type Point3 = [number, number, number];

export interface Measurement {
  a: Point3;
  b: Point3;
  dx: number;
  dy: number;
  dz: number;
  distance: number;
}

/** Distancia Manhattan por ejes y euclídea entre dos celdas del schematic. */
export function measurePoints(a: Point3, b: Point3): Measurement {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  const dz = Math.abs(b[2] - a[2]);
  return {
    a: [...a] as Point3,
    b: [...b] as Point3,
    dx,
    dy,
    dz,
    distance: Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) * 100) / 100,
  };
}

/** Conteo de bloques por sección 16³, ordenado por clave. */
export function chunkCounts(blocks: ParsedBlock[], chunkSize = 16): Array<{ key: string; count: number }> {
  const size = Number.isFinite(chunkSize) && chunkSize >= 1 ? Math.floor(chunkSize) : 16;
  const counts = new Map<string, number>();
  for (const block of blocks) {
    const key = `${Math.floor(block.x / size)},${Math.floor(block.y / size)},${Math.floor(block.z / size)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

/** Marcas 0..max (ambos incluidos) separadas por `step` bloques. */
export function rulerMarks(size: Dimensions, step = 16): number[] {
  const max = Math.max(size.widthX, size.heightY, size.lengthZ);
  const stride = Number.isFinite(step) && step >= 1 ? Math.floor(step) : 16;
  if (!Number.isFinite(max) || max <= 0) return [0];

  const marks: number[] = [0];
  for (let value = stride; value < max; value += stride) marks.push(value);
  marks.push(max);
  return marks;
}
