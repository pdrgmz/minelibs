import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../config';
import { setupTestApp } from '../test/helpers';
import { safeResolve } from '../storage';

function jsonResponse(body: string, status = 200): Response {
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(bytes.byteLength) : null) },
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: bytes };
        },
        cancel: async () => undefined,
        releaseLock: () => undefined,
      }),
    },
  } as unknown as Response;
}

describe('servicio de assets de Minecraft', () => {
  let app: FastifyInstance;
  const fetchMock = vi.fn(async (_url: string | URL | Request) => jsonResponse('{"variants":{}}'));

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterEach(() => {
    fetchMock.mockClear();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await app.close();
  });

  it('descarga, cachea y sirve el asset con cabeceras de caché', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const url = '/assets/mc/1.21.4/assets/minecraft/blockstates/stone.json';
    const first = await app.inject({ method: 'GET', url });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ variants: {} });
    expect(first.headers['content-type']).toContain('application/json');
    expect(first.headers['cache-control']).toContain(`max-age=${env.ASSETS_CACHE_TTL_SECONDS}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/1.21.4/assets/minecraft/blockstates/stone.json');

    const second = await app.inject({ method: 'GET', url });
    expect(second.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('degrada versiones vagas a la versión por defecto', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({
      method: 'GET',
      url: '/assets/mc/latest/assets/minecraft/models/block/cube.json',
    });
    expect(response.statusCode).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/${env.DEFAULT_MC_VERSION}/`);
  });

  it('devuelve 404 si el origen no tiene el asset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('', 404)));
    const response = await app.inject({
      method: 'GET',
      url: '/assets/mc/1.21.4/assets/minecraft/blockstates/missing.json',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('ASSET_NOT_FOUND');
  });

  it('rechaza rutas relativas que salen del directorio de assets', () => {
    expect(() => safeResolve('/tmp/assets', '../secreto.txt')).toThrow();
    expect(() => safeResolve('/tmp/assets', 'a/../../secreto.txt')).toThrow();
    expect(() => safeResolve('/tmp/assets', 'blockstates/stone.json')).not.toThrow();
  });
});
