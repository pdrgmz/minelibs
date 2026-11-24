import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createAdmin, multipart, register, resetDb, setupTestApp, validSchematicFile } from '../test/helpers';

describe('autenticación y aislamiento de usuarios', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await setupTestApp();
  });
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await app.close();
  });

  it('registra un usuario y devuelve access token + cookie de refresh', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: 'alice', password: 'password-de-prueba-123' } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ user: { username: 'alice', role: 'USER' } });
    expect(response.json().accessToken).toBeTypeOf('string');
    expect(response.headers['set-cookie']).toContain('minelibs_refresh=');
  });

  it('rechaza credenciales incorrectas y valida el formato del usuario', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: 'alice', password: 'password-de-prueba-123' } });
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: 'incorrecta-123' } });
    expect(bad.statusCode).toBe(401);
    const invalid = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: 'A B', password: 'password-de-prueba-123' } });
    expect(invalid.statusCode).toBe(400);
  });

  it('renueva la sesión rotando el refresh y revoca el anterior', async () => {
    const { cookie } = await register(app, 'alice');
    const cookieHeader = cookie.split(';')[0];
    const refreshed = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: cookieHeader } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().accessToken).toBeTypeOf('string');
    const reused = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: cookieHeader } });
    expect(reused.statusCode).toBe(401);
  });

  it('protege las rutas y aísla las bibliotecas por usuario', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    const alice = await register(app, 'alice');
    const bob = await register(app, 'bob');

    const form = multipart({ name: 'Granja de Alice' }, { field: 'file', filename: 'farm.litematic', content: validSchematicFile() });
    const created = await app.inject({ method: 'POST', url: '/api/v1/schematics', headers: { ...auth(alice.token), ...form.headers }, payload: form.payload });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: string }>().id;

    expect((await app.inject({ method: 'GET', url: `/api/v1/schematics/${id}`, headers: auth(bob.token) })).statusCode).toBe(404);
    const bobList = await app.inject({ method: 'GET', url: '/api/v1/schematics', headers: auth(bob.token) });
    expect(bobList.json<{ total: number }>().total).toBe(0);

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(alice.token) });
    expect(me.json()).toMatchObject({ username: 'alice' });
  });

  it('solo el admin accede al panel de administración', async () => {
    const user = await register(app, 'alice');
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: auth(user.token) })).statusCode).toBe(403);

    await createAdmin();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admintest', password: 'admin-pass-test-123' } });
    expect(login.statusCode).toBe(200);
    const adminList = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: auth(login.json<{ accessToken: string }>().accessToken) });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json<{ total: number }>().total).toBe(2);
  });
});
