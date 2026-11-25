import { describe, expect, it } from 'vitest';
import { chunkCenter, clampCamera, fitDistance, presetCamera, wheelDeltaPixels } from './camera';

const size: [number, number, number] = [48, 32, 80];

describe('wheelDeltaPixels', () => {
  it('respeta deltas en píxeles', () => {
    expect(wheelDeltaPixels(100, 0, 600)).toBe(100);
  });

  it('convierte líneas y páginas a píxeles', () => {
    expect(wheelDeltaPixels(3, 1, 600)).toBe(48);
    expect(wheelDeltaPixels(1, 2, 600)).toBe(600);
  });
});

describe('camera presets', () => {
  it('encuadra vista superior, frontal y lateral con centros coherentes', () => {
    for (const preset of ['iso', 'top', 'front', 'right'] as const) {
      const camera = presetCamera(preset, size, 1.5);
      const expected: [number, number, number] = [24, 16, 40];
      for (let axis = 0; axis < 3; axis += 1) {
        expect(Number.isFinite(camera.center[axis])).toBe(true);
        expect(Math.abs(camera.center[axis] - expected[axis])).toBeLessThan(size[axis] / 2 + 1);
      }
      expect(camera.distance).toBeGreaterThan(0);
      expect(Math.abs(camera.xRotation)).toBeLessThanOrEqual(Math.PI / 2);
    }
  });

  it('top mira estrictamente hacia abajo y front no rota en Y', () => {
    const top = presetCamera('top', size);
    const front = presetCamera('front', size);
    expect(top.xRotation).toBeCloseTo(-Math.PI / 2);
    expect(front.xRotation).toBe(0);
    expect(front.yRotation).toBe(0);
  });

  it('claampa distancia y rotación vertical', () => {
    const clamped = clampCamera({ xRotation: 10, yRotation: 0, distance: 0, center: [0, 0, 0] });
    expect(clamped.xRotation).toBeCloseTo(Math.PI / 2);
    expect(clamped.distance).toBe(1);
  });

  it('la distancia de encuadre crece con el tamaño', () => {
    expect(fitDistance(size, 1.5)).toBeGreaterThan(fitDistance([8, 8, 8], 1.5));
  });

  it('un aspecto más ancho permite acercar la cámara', () => {
    const wide: [number, number, number] = [80, 1, 8];
    expect(fitDistance(wide, 2)).toBeLessThan(fitDistance(wide, 1));
  });

  it('calcula centros de sección recortados a los límites', () => {
    expect(chunkCenter('1,0,2', size)).toEqual([24, 8, 40]);
    expect(chunkCenter('bad', size)).toBeNull();
    expect(chunkCenter('0,0,0', [8, 8, 8])).toEqual([8, 8, 8]);
  });
});
