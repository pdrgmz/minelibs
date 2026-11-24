import { mkdir, readdir, rm } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../config';
import { auth, createAdmin, multipart, register, resetDb, sampleFile, setupTestApp, validSchematicFile } from '../test/helpers';

describe('schematics API', () => {
  let app: FastifyInstance;
  let token: string;

  const upload = async (overrides: Record<string, string> = {}, query = '') => {
    const form = multipart(
      {
        name: 'Granja de hierro 1.21',
        description: 'Tasas: 300/h',
        youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
        tags: 'hierro,redstone',
        minecraftVersion: '1.21.4',
        ...overrides,
      },
      { field: 'file', filename: 'farm.litematic', content: validSchematicFile() },
    );
    return app.inject({
      method: 'POST',
      url: `/api/v1/schematics${query}`,
      headers: { ...auth(token), ...form.headers },
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
    token = (await register(app, `user${Math.random().toString(36).slice(2)}`)).token;
  });
  afterAll(async () => {
    await app.close();
  });

  it('sube un schematic válido y deriva metadatos', async () => {
    const response = await upload();
    expect(response.statusCode).toBe(201);
    const body = response.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      name: 'Granja de hierro 1.21',
      youtubeVideoId: 'dQw4w9WgXcQ',
      format: 'LITEMATIC',
      parserVersion: 2,
      totalBlocks: 2,
      dimensions: { widthX: 2, heightY: 2, lengthZ: 2 },
    });
    expect(body.materials).toEqual([
      { blockId: 'minecraft:dirt', displayName: 'Dirt', count: 1, stackSize: 64 },
      { blockId: 'minecraft:stone', displayName: 'Stone', count: 1, stackSize: 64 },
    ]);
    expect(body.tags).toEqual(['hierro', 'redstone']);
    expect(body.fileUrl).toMatch(/^\/api\/v1\/schematics\/[\w-]+\/file$/);
  });

  it('rechaza extensión inválida, magic bytes incorrectos y archivo vacío', async () => {
    const badExt = multipart({ name: 'x' }, { field: 'file', filename: 'farm.txt', content: validSchematicFile() });
    expect((await app.inject({ method: 'POST', url: '/api/v1/schematics', headers: { ...auth(token), ...badExt.headers }, payload: badExt.payload })).statusCode).toBe(400);

    const badMagic = multipart({ name: 'x' }, { field: 'file', filename: 'farm.nbt', content: Buffer.from('esto no es nbt') });
    expect((await app.inject({ method: 'POST', url: '/api/v1/schematics', headers: { ...auth(token), ...badMagic.headers }, payload: badMagic.payload })).statusCode).toBe(400);

    const empty = multipart({ name: 'x' }, { field: 'file', filename: 'farm.nbt', content: Buffer.alloc(0) });
    expect((await app.inject({ method: 'POST', url: '/api/v1/schematics', headers: { ...auth(token), ...empty.headers }, payload: empty.payload })).statusCode).toBe(400);
  });

  it('detecta duplicados por SHA-256 y permite forzar', async () => {
    expect((await upload()).statusCode).toBe(201);
    const duplicate = await upload();
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: 'DUPLICATE_FILE' });
    expect((await upload({}, '?force=true')).statusCode).toBe(201);
  });

  it('lista con paginación y filtros y devuelve el detalle', async () => {
    await upload({ name: 'Granja A', tags: 'hierro', isFavorite: 'true' });
    await upload({ name: 'Granja B', tags: 'xp', minecraftVersion: '1.20.4' }, '?force=true');

    const all = await app.inject({ method: 'GET', url: '/api/v1/schematics?page=1&limit=1', headers: auth(token) });
    expect(all.json<{ total: number; items: unknown[] }>().total).toBe(2);
    expect(all.json<{ items: unknown[] }>().items).toHaveLength(1);

    const favorite = await app.inject({ method: 'GET', url: '/api/v1/schematics?favorite=true', headers: auth(token) });
    expect(favorite.json<{ items: Array<{ name: string }> }>().items.map((x) => x.name)).toEqual(['Granja A']);
    const tag = await app.inject({ method: 'GET', url: '/api/v1/schematics?tag=xp', headers: auth(token) });
    expect(tag.json<{ total: number }>().total).toBe(1);
    const search = await app.inject({ method: 'GET', url: '/api/v1/schematics?q=Granada', headers: auth(token) });
    expect(search.json<{ total: number }>().total).toBe(0);

    const id = favorite.json<{ items: Array<{ id: string }> }>().items[0].id;
    const detail = await app.inject({ method: 'GET', url: `/api/v1/schematics/${id}`, headers: auth(token) });
    expect(detail.json()).toMatchObject({ name: 'Granja A', isFavorite: true, checkedMaterials: [] });
  });

  it('actualiza metadatos y checklist sin reparsear', async () => {
    const created = (await upload()).json<{ id: string }>();
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/schematics/${created.id}`,
      headers: auth(token),
      payload: { name: 'Renombrada', isFavorite: true, checkedMaterials: ['minecraft:hopper'], tags: ['nuevo'], youtubeUrl: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ name: 'Renombrada', isFavorite: true, checkedMaterials: ['minecraft:hopper'], youtubeVideoId: 'dQw4w9WgXcQ' });
  });

  it('borra el schematic y su archivo', async () => {
    const created = (await upload()).json<{ id: string }>();
    expect((await readdir(env.STORAGE_DIR)).length).toBe(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/schematics/${created.id}`, headers: auth(token) })).statusCode).toBe(204);
    expect(await readdir(env.STORAGE_DIR)).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: `/api/v1/schematics/${created.id}`, headers: auth(token) })).statusCode).toBe(404);
  });

  it('valida la pertenencia de la colección', async () => {
    const collection = await app.inject({ method: 'POST', url: '/api/v1/collections', headers: auth(token), payload: { name: 'Mundo 1.21' } });
    expect(collection.statusCode).toBe(201);
    const collectionId = collection.json<{ id: string }>().id;
    expect((await upload({ collectionId })).statusCode).toBe(201);

    const otherToken = (await register(app, 'otro-usuario')).token;
    expect((await app.inject({ method: 'POST', url: '/api/v1/schematics', headers: { ...auth(otherToken), ...multipart({ name: 'x', collectionId }, { field: 'file', filename: 'a.litematic', content: validSchematicFile() }).headers }, payload: multipart({ name: 'x', collectionId }, { field: 'file', filename: 'a.litematic', content: validSchematicFile() }).payload })).statusCode).toBe(404);
  });

  it('acepta y sirve un thumbnail PNG, rechaza otros formatos', async () => {
    const created = (await upload()).json<{ id: string }>();
    const png = Buffer.concat([Buffer.from('89504e47', 'hex'), Buffer.from('contenido-falso-pero-valido-para-la-prueba')]);
    const form = multipart({}, { field: 'thumbnail', filename: 'thumb.png', content: png });
    expect((await app.inject({ method: 'POST', url: `/api/v1/schematics/${created.id}/thumbnail`, headers: { ...auth(token), ...form.headers }, payload: form.payload })).statusCode).toBe(201);
    const image = await app.inject({ method: 'GET', url: `/api/v1/schematics/${created.id}/thumbnail`, headers: auth(token) });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
  });

  it('sirve el binario en inline o attachment', async () => {
    const created = (await upload()).json<{ id: string }>();
    const inline = await app.inject({ method: 'GET', url: `/api/v1/schematics/${created.id}/file`, headers: auth(token) });
    expect(inline.headers['content-disposition']).toContain('inline');
    const download = await app.inject({ method: 'GET', url: `/api/v1/schematics/${created.id}/file?download=1`, headers: auth(token) });
    expect(download.headers['content-disposition']).toContain('attachment');
  });

  it('reemplaza el archivo y recalcula dimensiones y materiales', async () => {
    const created = (await upload()).json<{ id: string }>();
    const form = multipart({}, { field: 'file', filename: 'structure.nbt', content: sampleFile('structure.nbt') });
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/schematics/${created.id}/file`,
      headers: { ...auth(token), ...form.headers },
      payload: form.payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      format: 'NBT',
      parserVersion: 2,
      totalBlocks: 2,
      dimensions: { widthX: 3, heightY: 2, lengthZ: 2 },
      thumbnailUrl: null,
    });
  });

  it('rechaza archivos NBT corruptos con 400', async () => {
    const form = multipart({ name: 'corrupto' }, { field: 'file', filename: 'corrupt.litematic', content: sampleFile('corrupt.litematic') });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/schematics',
      headers: { ...auth(token), ...form.headers },
      payload: form.payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_NBT' });
  });

  it('reparsea la biblioteca solo para administradores', async () => {
    const created = (await upload()).json<{ id: string }>();
    expect((await app.inject({ method: 'POST', url: '/api/v1/schematics/reparse', headers: auth(token) })).statusCode).toBe(403);

    await createAdmin();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admintest', password: 'admin-pass-test-123' } });
    const adminToken = login.json<{ accessToken: string }>().accessToken;
    const reparse = await app.inject({ method: 'POST', url: '/api/v1/schematics/reparse', headers: auth(adminToken) });
    expect(reparse.statusCode).toBe(200);
    expect(reparse.json()).toMatchObject({ total: 1, updated: 1, failed: 0, parserVersion: 2 });

    const detail = await app.inject({ method: 'GET', url: `/api/v1/schematics/${created.id}`, headers: auth(token) });
    expect(detail.json()).toMatchObject({ parserVersion: 2, totalBlocks: 2 });
  });

  it('aísla bibliotecas ajenas y permite moderación de solo lectura con asAdmin', async () => {
    const created = (await upload()).json<{ id: string }>();
    const other = (await register(app, `other${Math.random().toString(36).slice(2)}`)).token;

    expect((await app.inject({ method: 'GET', url: `/api/v1/schematics/${created.id}`, headers: auth(other) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/schematics/${created.id}/file`, headers: auth(other) })).statusCode).toBe(404);

    await createAdmin();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admintest', password: 'admin-pass-test-123' } });
    const adminToken = login.json<{ accessToken: string }>().accessToken;
    const moderated = await app.inject({
      method: 'GET',
      url: `/api/v1/schematics/${created.id}?asAdmin=true`,
      headers: auth(adminToken),
    });
    expect(moderated.statusCode).toBe(200);
    expect(moderated.json()).toMatchObject({ id: created.id, name: 'Granja de hierro 1.21' });

    const moderatedFile = await app.inject({
      method: 'GET',
      url: `/api/v1/schematics/${created.id}/file?asAdmin=true`,
      headers: auth(adminToken),
    });
    expect(moderatedFile.statusCode).toBe(200);
  });

  it('acepta campos opcionales vacíos enviados por el formulario', async () => {
    const response = await upload({
      description: '',
      youtubeUrl: '',
      minecraftVersion: '',
      collectionId: '',
      tags: '',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      youtubeUrl: null,
      youtubeVideoId: null,
      description: null,
      minecraftVersion: null,
      collectionId: null,
      tags: [],
    });
  });
});
