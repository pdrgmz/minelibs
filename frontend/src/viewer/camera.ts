export type Vec3Tuple = [number, number, number];

export interface ViewerCamera {
  xRotation: number;
  yRotation: number;
  distance: number;
  center: Vec3Tuple;
}

export type ViewPreset = 'iso' | 'top' | 'front' | 'right';

type Rotation = Pick<ViewerCamera, 'xRotation' | 'yRotation'>;

interface Axes {
  right: Vec3Tuple;
  up: Vec3Tuple;
  forward: Vec3Tuple;
}

const ISO_ROTATION: Rotation = { xRotation: 0.8, yRotation: 0.5 };

/**
 * Normaliza el delta de la rueda a píxeles: `deltaMode` puede indicar líneas
 * (Firefox) o páginas, donde `deltaY=3` equivale a ~48 px y no a 3 px.
 */
export function wheelDeltaPixels(deltaY: number, deltaMode: number, viewportHeight: number): number {
  const multiplier = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, viewportHeight) : 1;
  return deltaY * multiplier;
}

export function clampCamera(camera: ViewerCamera): ViewerCamera {
  const halfPi = Math.PI / 2;
  return {
    ...camera,
    xRotation: Math.max(-halfPi, Math.min(halfPi, camera.xRotation)),
    distance: Math.max(1, Math.min(500, camera.distance)),
  };
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Filas de la matriz de view: ejes de cámara en coordenadas del mundo. */
function cameraAxes(rotation: Rotation): Axes {
  const sinX = Math.sin(rotation.xRotation);
  const cosX = Math.cos(rotation.xRotation);
  const sinY = Math.sin(rotation.yRotation);
  const cosY = Math.cos(rotation.yRotation);
  return {
    right: [cosY, 0, sinY],
    up: [sinX * sinY, cosX, -sinX * cosY],
    forward: [-cosX * sinY, sinX, cosX * cosY],
  };
}

function geometricCenter(size: Vec3Tuple): Vec3Tuple {
  return [size[0] / 2, size[1] / 2, size[2] / 2];
}

function projectedHalf(size: Vec3Tuple): Vec3Tuple {
  return [size[0] / 2, size[1] / 2, size[2] / 2];
}

function perspectiveTangents(aspect: number, fovDeg: number): { tanX: number; tanY: number } {
  const tanY = Math.tan((fovDeg * Math.PI) / 360);
  return { tanX: tanY * Math.max(0.2, aspect), tanY };
}

/**
 * Distancia necesaria para que las 8 esquinas de la caja entren en el frustum.
 * En perspectiva se suma la profundidad de cada esquina: la más cercana
 * proyecta más grande y es la que realmente limita el encuadre.
 */
function requiredDistance(
  size: Vec3Tuple,
  center: Vec3Tuple,
  aspect: number,
  fovDeg: number,
  rotation: Rotation,
): number {
  const { tanX, tanY } = perspectiveTangents(aspect, fovDeg);
  const axes = cameraAxes(rotation);
  const half = projectedHalf(size);
  const base = geometricCenter(size);
  const offset: Vec3Tuple = [base[0] - center[0], base[1] - center[1], base[2] - center[2]];

  let required = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const delta: Vec3Tuple = [offset[0] + sx * half[0], offset[1] + sy * half[1], offset[2] + sz * half[2]];
        const x = dot(axes.right, delta);
        const y = dot(axes.up, delta);
        const z = dot(axes.forward, delta);
        required = Math.max(required, Math.abs(x) / tanX + z, Math.abs(y) / tanY + z, z + 0.5);
      }
    }
  }
  return Math.max(2, Math.min(500, required * 1.12));
}

/** Distancia necesaria para encuadrar la caja en el viewport (con margen). */
export function fitDistance(
  size: Vec3Tuple,
  aspect: number,
  fovDeg = 70,
  rotation: Rotation = ISO_ROTATION,
): number {
  return requiredDistance(size, geometricCenter(size), aspect, fovDeg, rotation);
}

/**
 * Cámara encuadrada y centrada según la caja proyectada, no según su esfera
 * envolvente: aprovecha mejor la resolución y evita recortes en granjas planas.
 */
function fittedCamera(size: Vec3Tuple, aspect: number, rotation: Rotation, fovDeg = 70): ViewerCamera {
  const axes = cameraAxes(rotation);
  const { tanX, tanY } = perspectiveTangents(aspect, fovDeg);
  const base = geometricCenter(size);
  const half = projectedHalf(size);
  let center: Vec3Tuple = base;
  let distance = requiredDistance(size, center, aspect, fovDeg, rotation);

  for (let pass = 0; pass < 4; pass += 1) {
    const offset: Vec3Tuple = [base[0] - center[0], base[1] - center[1], base[2] - center[2]];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const delta: Vec3Tuple = [offset[0] + sx * half[0], offset[1] + sy * half[1], offset[2] + sz * half[2]];
          const x = dot(axes.right, delta);
          const y = dot(axes.up, delta);
          const z = dot(axes.forward, delta);
          const nx = x / (tanX * (distance - z));
          const ny = y / (tanY * (distance - z));
          minX = Math.min(minX, nx);
          maxX = Math.max(maxX, nx);
          minY = Math.min(minY, ny);
          maxY = Math.max(maxY, ny);
        }
      }
    }
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    if (Math.abs(midX) < 0.005 && Math.abs(midY) < 0.005) break;

    const shiftX = midX * tanX * distance;
    const shiftY = midY * tanY * distance;
    center = [
      center[0] + axes.right[0] * shiftX + axes.up[0] * shiftY,
      center[1] + axes.right[1] * shiftX + axes.up[1] * shiftY,
      center[2] + axes.right[2] * shiftX + axes.up[2] * shiftY,
    ];
    distance = requiredDistance(size, center, aspect, fovDeg, rotation);
  }

  return clampCamera({ ...rotation, distance, center });
}

/** Cámaras canónicas. `top` se usa también para el modo capa 2D. */
export function presetCamera(preset: ViewPreset, size: Vec3Tuple, aspect = 1.5): ViewerCamera {
  switch (preset) {
    case 'top':
      return fittedCamera([size[0], 1, size[2]], aspect, { xRotation: -Math.PI / 2, yRotation: 0 });
    case 'front':
      return fittedCamera([size[0], size[1], 1], aspect, { xRotation: 0, yRotation: 0 });
    case 'right':
      return fittedCamera([1, size[1], size[2]], aspect, { xRotation: 0, yRotation: Math.PI / 2 });
    case 'iso':
    default:
      return fittedCamera(size, aspect, ISO_ROTATION);
  }
}

/** Centro de una sección 16³, recortado a los límites del schematic. */
export function chunkCenter(key: string, size: Vec3Tuple, chunkSize = 16): Vec3Tuple | null {
  const parts = key.split(',').map((value) => Number(value));
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return null;
  return [
    Math.min(size[0], Math.max(0, parts[0] * chunkSize + chunkSize / 2)),
    Math.min(size[1], Math.max(0, parts[1] * chunkSize + chunkSize / 2)),
    Math.min(size[2], Math.max(0, parts[2] * chunkSize + chunkSize / 2)),
  ];
}
