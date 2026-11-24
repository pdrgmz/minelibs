import { readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { env } from '../config';
import { prisma } from '../db';

export async function setupTestApp(): Promise<FastifyInstance> {
  await Promise.all([
    rm(env.STORAGE_DIR, { recursive: true, force: true }),
    rm(env.THUMBNAILS_DIR, { recursive: true, force: true }),
    rm(env.ASSETS_DIR, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(env.STORAGE_DIR, { recursive: true }),
    mkdir(env.THUMBNAILS_DIR, { recursive: true }),
    mkdir(env.ASSETS_DIR, { recursive: true }),
  ]);
  await resetDb();
  return buildApp();
}

export async function resetDb(): Promise<void> {
  await prisma.schematic.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

export async function createAdmin(username = 'admintest', password = 'admin-pass-test-123'): Promise<void> {
  await prisma.user.create({
    data: { username, role: 'ADMIN', passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
  });
}

export async function register(app: FastifyInstance, username: string, password = 'password-de-prueba-123'): Promise<{ token: string; cookie: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username, password },
  });
  const body = response.json<{ accessToken: string }>();
  const cookie = response.headers['set-cookie'] as unknown as string[] | string | undefined;
  return { token: body.accessToken, cookie: Array.isArray(cookie) ? cookie[0] : (cookie ?? '') };
}

export function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

/** Lee un fixture de samples/ (generados por scripts/generate-fixtures.ts). */
export function sampleFile(name: string): Buffer {
  return readFileSync(path.resolve(__dirname, '../../../samples', name));
}

/** Fixture NBT real: 2×2×2 con stone + dirt. */
export function validSchematicFile(): Buffer {
  return sampleFile('basic.litematic');
}

export function multipart(fields: Record<string, string>, file?: { field: string; filename: string; content: Buffer }) {
  const boundary = '----minelibs-test-boundary';
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      file.content,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
