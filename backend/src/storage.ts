import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { env } from './config';
import { HttpError } from './errors';

/** Resuelve una ruta relativa garantizando que no sale de `base` (zip-slip / path traversal). */
export function safeResolve(base: string, relative: string): string {
  if (!relative || relative.includes('\0') || relative.includes('\\') || path.isAbsolute(relative)) {
    throw new HttpError(400, 'Ruta de archivo no permitida', 'INVALID_PATH');
  }
  const root = path.resolve(base);
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new HttpError(400, 'Ruta de archivo fuera del directorio permitido', 'INVALID_PATH');
  }
  return resolved;
}

export function schematicPath(id: string, extension: string): string {
  return safeResolve(env.STORAGE_DIR, `${id}.${extension}`);
}

/** Para filas ya persistidas, cuyo nombre de archivo se guarda en la BD. */
export function storedSchematicPath(storageFilename: string): string {
  return safeResolve(env.STORAGE_DIR, storageFilename);
}

export function thumbnailPath(id: string): string {
  return safeResolve(env.THUMBNAILS_DIR, `${id}.png`);
}

export async function ensureSchematicDir(): Promise<void> {
  await mkdir(env.STORAGE_DIR, { recursive: true });
}

export async function ensureThumbnailDir(): Promise<void> {
  await mkdir(env.THUMBNAILS_DIR, { recursive: true });
}

/** Versiones vagas o desconocidas se degradan a la configurada por defecto. */
export function resolveMcVersion(version: string | undefined): string {
  return version && /^\d+\.\d+(\.\d+)?$/.test(version) ? version : env.DEFAULT_MC_VERSION;
}

export function assetRelativePath(rest: string): string {
  const clean = rest.replace(/^\/+/, '');
  const prefix = 'assets/minecraft/';
  if (!clean.startsWith(prefix)) {
    throw new HttpError(400, 'Solo se permiten assets bajo assets/minecraft', 'INVALID_PATH');
  }
  safeResolve('assets/minecraft', clean.slice(prefix.length));
  return clean;
}

export function assetPath(version: string, relative: string): string {
  return safeResolve(path.join(env.ASSETS_DIR, resolveMcVersion(version)), relative);
}

export const assetCacheRoot = (version: string): string => path.join(env.ASSETS_DIR, resolveMcVersion(version));
