import { describe, expect, it } from 'vitest';
import { blockKey } from './layers';
import { intersectYPlane, pickVoxel } from './picking';

const occupied = new Set(['2,1,3', '5,1,3', '2,1,6']);

describe('pickVoxel', () => {
  it('encuentra la primera celda ocupada sobre el eje X', () => {
    expect(pickVoxel([0.5, 1.5, 3.5], [1, 0, 0], occupied)).toEqual([2, 1, 3]);
  });

  it('devuelve null cuando el rayo no toca ninguna celda', () => {
    expect(pickVoxel([0.5, 8.5, 8.5], [1, 0, 0], occupied)).toBeNull();
  });

  it('respeta la distancia máxima', () => {
    expect(pickVoxel([0.5, 1.5, 3.5], [1, 0, 0], occupied, 1)).toBeNull();
  });

  it('acepta direcciones negativas y normalizadas en diagonal', () => {
    const diagonal = Math.SQRT1_2;
    // La diagonal cruza la esquina (3,3) antes que la celda (2,2).
    expect(pickVoxel([6.5, 1.5, 6.5], [-diagonal, 0, -diagonal], occupied)).toEqual([2, 1, 3]);
  });

  it('ignora origin o dirección no finitos', () => {
    expect(pickVoxel([Number.NaN, 1, 1], [1, 0, 0], occupied)).toBeNull();
  });
});

describe('intersectYPlane', () => {
  it('interseca el plano horizontal hacia abajo', () => {
    const point = intersectYPlane([4, 5, 6], [0, -1, 0], 2);
    expect(point?.[1]).toBe(2);
    expect(point?.[0]).toBe(4);
  });

  it('devuelve null si el rayo es paralelo o apunta en sentido contrario', () => {
    expect(intersectYPlane([0, 5, 0], [1, 0, 0], 2)).toBeNull();
    expect(intersectYPlane([0, 5, 0], [0, 1, 0], 2)).toBeNull();
  });
});

describe('blockKey', () => {
  it('acepta tuplas y objetos', () => {
    expect(blockKey([1, 2, 3])).toBe('1,2,3');
    expect(blockKey({ x: 1, y: 2, z: 3 })).toBe('1,2,3');
  });
});
