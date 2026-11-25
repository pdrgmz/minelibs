import { blockKey } from './layers';

export type Vec3Tuple = [number, number, number];

/**
 * Recorrido DDA (Amanatides & Woo) sobre celdas de 1×1×1.
 * Devuelve la primera celda ocupada que cruza el rayo, o `null`.
 * Es O(número de celdas atravesadas), no O(bloques totales).
 */
export function pickVoxel(
  origin: Vec3Tuple,
  direction: Vec3Tuple,
  occupied: ReadonlySet<string>,
  maxDistance = 500,
): Vec3Tuple | null {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = direction;
  if (!Number.isFinite(ox + oy + oz + dx + dy + dz)) return null;

  const step: Vec3Tuple = [
    dx > 0 ? 1 : dx < 0 ? -1 : 0,
    dy > 0 ? 1 : dy < 0 ? -1 : 0,
    dz > 0 ? 1 : dz < 0 ? -1 : 0,
  ];
  const cell: Vec3Tuple = [Math.floor(ox), Math.floor(oy), Math.floor(oz)];

  const tDelta: Vec3Tuple = [
    dx === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dx),
    dy === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dy),
    dz === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dz),
  ];
  const boundary = (index: number): number => {
    const component = [ox, oy, oz][index] ?? 0;
    const dir = [dx, dy, dz][index] ?? 0;
    const current = cell[index] ?? 0;
    if (dir > 0) return (current + 1 - component) / dir;
    if (dir < 0) return (component - current) / -dir;
    return Number.POSITIVE_INFINITY;
  };
  const tMax: Vec3Tuple = [boundary(0), boundary(1), boundary(2)];

  let travelled = 0;
  for (let index = 0; index < 1024 && travelled <= maxDistance; index += 1) {
    if (occupied.has(blockKey(cell))) return [...cell] as Vec3Tuple;

    if (tMax[0] <= tMax[1] && tMax[0] <= tMax[2]) {
      if (tMax[0] === Number.POSITIVE_INFINITY) break;
      cell[0] += step[0];
      travelled = tMax[0];
      tMax[0] += tDelta[0];
    } else if (tMax[1] <= tMax[2]) {
      if (tMax[1] === Number.POSITIVE_INFINITY) break;
      cell[1] += step[1];
      travelled = tMax[1];
      tMax[1] += tDelta[1];
    } else {
      if (tMax[2] === Number.POSITIVE_INFINITY) break;
      cell[2] += step[2];
      travelled = tMax[2];
      tMax[2] += tDelta[2];
    }
  }
  return null;
}

/** Intersección del rayo con el plano horizontal `y = planeY`, para medir en modo capa. */
export function intersectYPlane(
  origin: Vec3Tuple,
  direction: Vec3Tuple,
  planeY: number,
): Vec3Tuple | null {
  if (Math.abs(direction[1]) < 1e-6) return null;
  const travelled = (planeY - origin[1]) / direction[1];
  if (travelled < 0) return null;
  return [
    origin[0] + direction[0] * travelled,
    planeY,
    origin[2] + direction[2] * travelled,
  ];
}
