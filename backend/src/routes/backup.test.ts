import { mkdir, rm } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../config';
import { prisma } from '../db';
import { auth, createAdmin, multipart, register, resetDb, setupTestApp, validSchematicFile } from '../test/helpers';

describe('export / import ZIP', () => {
  let app: FastifyInstance;
  let token: string;

  const upload = async (accessToken: string, name = 'Granja backup') => {
    const form = multipart(
      { name, minecraftVersion: '1.21.4', tags: 'redstone' },
      { field: 'file', filename: 'farm.litematic', content: validSchematicFile() },
    );
    return app.inject({
      method: 'POST',
      url: '/api/v1/schematics',
      headers: { ...auth(accessToken), ...form.headers },
      payload: form.payload,
    });
  };

  const importZip = (accessToken: string, zip: Buffer) => {
    const form = multipart({}, { field: 'file', filename: 'backup.zip', content: zip });
    return app.inject({
      method: 'POST',
      url: '/api/v1/me/import',
      headers: { ...auth(accessToken), ...form.headers },
      payload: form.payload,
    });
  };

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await Promise.all([rm(env.STORAGE_DIR, { recursive: true, force: true }), rm(env.THUMBNAILS_DIR, { recursive: true, force: true })]);
    await Promise.all([mkdir(env.STORAGE_DIR, { recursive: true }), mkdir(env.THUMBNAILS_DIR, { recursive: true })]);
    await resetDb();
    token = (await register(app, `backup${Math.random().toString(36).slice(2)}`)).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('exporta manifest + binarios y los reimporta con nuevos UUID y reparseo', async () => {
    const created = await upload(token);
    expect(created.statusCode).toBe(201);
    const original = created.json<{ id: string; sha256: string; materials: unknown[] }>();

    const exported = await app.inject({ method: 'GET', url: '/api/v1/me/export', headers: auth(token) });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('application/zip');

    const otherToken = (await register(app, `import${Math.random().toString(36).slice(2)}`)).token;
    const imported = await importZip(otherToken, exported.rawPayload);
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toEqual({ imported: 1, skipped: 0, errors: [] });

    const rows = await prisma.schematic.findMany({ where: { userId: (await prisma.user.findFirst({ where: { username: { startsWith: 'import' } }, select: { id: true } }))!.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(original.id);
    expect(rows[0].sha256).toBe(original.sha256);
    expect(rows[0].parserVersion).toBe(2);
    expect(JSON.parse(rows[0].materials)).toEqual(original.materials);
  });

  it('omite SHA-256 duplicados al reimportar en la misma biblioteca', async () => {
    await upload(token);
    const zip = (await app.inject({ method: 'GET', url: '/api/v1/me/export', headers: auth(token) })).rawPayload;
    const result = await importZip(token, zip);
    expect(result.statusCode).toBe(200);
    expect(result.json<{ imported: number; skipped: number; errors: string[] }>().imported).toBe(0);
    expect(result.json<{ errors: string[] }>().errors[0]).toContain('SHA-256');
  });

  it('rechaza entradas ZIP con path traversal', async () => {
    const zip = Buffer.from(zipSync({
      'manifest.json': strToU8(JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), collections: [], schematics: [] })),
      '../evil.txt': strToU8('malicious'),
    }));
    const result = await importZip(token, zip);
    expect(result.statusCode).toBe(400);
    expect(result.json().error).toBe('INVALID_ZIP_ENTRY');
  });

  it('rechaza un manifest con versión desconocida', async () => {
    const zip = Buffer.from(zipSync({
      'manifest.json': strToU8(JSON.stringify({ schemaVersion: 99, exportedAt: new Date().toISOString(), collections: [], schematics: [] })),
    }));
    const result = await importZip(token, zip);
    expect(result.statusCode).toBe(400);
    expect(result.json().error).toBe('INVALID_MANIFEST');
  });

  it('el admin exporta todas las bibliotecas', async () => {
    await upload(token);
    await createAdmin();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admintest', password: 'admin-pass-test-123' },
    });
    const adminToken = login.json<{ accessToken: string }>().accessToken;
    const result = await app.inject({ method: 'GET', url: '/api/v1/admin/export', headers: auth(adminToken) });
    expect(result.statusCode).toBe(200);
    expect(result.rawPayload.length).toBeGreaterThan(100);
  });
});
