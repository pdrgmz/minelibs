import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { env } from '../config';
import { HttpError } from '../errors';
import { assetPath, assetRelativePath, resolveMcVersion } from '../storage';

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.mcmeta': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

function contentType(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

async function downloadAsset(version: string, relative: string): Promise<Buffer> {
  const url = `${env.ASSETS_UPSTREAM_URL.replace(/\/$/, '')}/${version}/${relative}`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(env.ASSETS_FETCH_TIMEOUT_MS) });
  } catch (cause) {
    throw new HttpError(502, 'No se pudo conectar con el origen de assets', 'ASSET_UPSTREAM_ERROR', { cause });
  }
  if (response.status === 404) throw new HttpError(404, 'Asset no encontrado', 'ASSET_NOT_FOUND');
  if (!response.ok) {
    throw new HttpError(502, `El origen de assets respondió ${response.status}`, 'ASSET_UPSTREAM_ERROR');
  }

  const maxBytes = env.ASSETS_MAX_FILE_MB * 1024 * 1024;
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new HttpError(413, 'El asset supera el tamaño máximo permitido', 'ASSET_TOO_LARGE');

  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, 'El origen de assets no devolvió contenido', 'ASSET_UPSTREAM_ERROR');
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, 'El asset supera el tamaño máximo permitido', 'ASSET_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function ensureAsset(version: string, relative: string): Promise<string> {
  const requestedVersion = resolveMcVersion(version);
  const target = assetPath(requestedVersion, relative);
  try {
    await stat(target);
    return target;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }

  const buffer = await downloadAsset(requestedVersion, relative);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, buffer);
  await rename(temporary, target);
  return target;
}

/** Descarga al arranque un conjunto mínimo de la versión por defecto (no bloquea la app). */
export async function prewarmAssets(): Promise<void> {
  const files = [
    'assets/minecraft/blockstates/stone.json',
    'assets/minecraft/models/block/cube.json',
    'assets/minecraft/models/block/cube_all.json',
    'assets/minecraft/textures/block/stone.png',
  ];
  await Promise.all(files.map((file) => ensureAsset(env.DEFAULT_MC_VERSION, file).catch(() => undefined)));
}

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/assets/mc/:version/*', async (request, reply) => {
    const params = request.params as { version: string; '*': string };
    const relative = assetRelativePath(params['*'] ?? '');
    const target = await ensureAsset(params.version, relative);
    return reply
      .header('Cache-Control', `public, max-age=${env.ASSETS_CACHE_TTL_SECONDS}`)
      .type(contentType(target))
      .send(createReadStream(target));
  });
}
