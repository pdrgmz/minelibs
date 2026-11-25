export type Vec3Tuple = [number, number, number];

export interface ViewerCamera {
  xRotation: number;
  yRotation: number;
  distance: number;
  center: Vec3Tuple;
}

export type ViewPreset = 'iso' | 'top' | 'front' | 'right';

export function clampCamera(camera: ViewerCamera): ViewerCamera {
  const halfPi = Math.PI / 2;
  return {
    ...camera,
    xRotation: Math.max(-halfPi, Math.min(halfPi, camera.xRotation)),
    distance: Math.max(1, Math.min(500, camera.distance)),
  };
}

/** Distancia necesaria para encuadrar la caja en el viewport (con margen). */
export function fitDistance(size: Vec3Tuple, aspect: number, fovDeg = 70): number {
  const verticalFov = (fovDeg * Math.PI) / 180;
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.2, aspect));
  const limitingFov = Math.min(verticalFov, horizontalFov);
  const radius = Math.sqrt(size[0] ** 2 + size[1] ** 2 + size[2] ** 2) / 2;
  const distance = radius / Math.sin(limitingFov / 2);
  return Math.max(2, Math.min(500, distance * 1.15));
}

/** Cámaras canónicas. `top` se usa también para el modo capa 2D. */
export function presetCamera(preset: ViewPreset, size: Vec3Tuple, aspect = 1.5): ViewerCamera {
  const center: Vec3Tuple = [size[0] / 2, size[1] / 2, size[2] / 2];
  const topDistance = fitDistance([size[0], 1, size[2]], aspect);
  switch (preset) {
    case 'top':
      return clampCamera({ xRotation: -Math.PI / 2, yRotation: 0, distance: topDistance, center });
    case 'front':
      return clampCamera({ xRotation: 0, yRotation: 0, distance: fitDistance([size[0], size[1], 1], aspect), center });
    case 'right':
      return clampCamera({ xRotation: 0, yRotation: Math.PI / 2, distance: fitDistance([1, size[1], size[2]], aspect), center });
    case 'iso':
    default:
      return clampCamera({ xRotation: 0.8, yRotation: 0.5, distance: fitDistance(size, aspect), center });
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
