import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getAccessToken, setAccessToken } from './client';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : '',
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

describe('API client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    setAccessToken(null);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('añade el token Bearer y las credenciales a cada petición', async () => {
    setAccessToken('token-abc');
    fetchMock.mockResolvedValue(jsonResponse(200, { id: '1' }));
    await api.get('/auth/me');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer token-abc');
    expect(init.credentials).toBe('include');
  });

  it('renueva la sesión con un solo refresh y reintenta la petición original', async () => {
    setAccessToken('expirado');
    const session = { accessToken: 'nuevo', user: { id: '1', username: 'alice', role: 'USER' } };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'UNAUTHORIZED', message: 'expirado' }))
      .mockResolvedValueOnce(jsonResponse(200, session))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await expect(api.get('/schematics')).resolves.toEqual({ ok: true });
    expect(getAccessToken()).toBe('nuevo');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/refresh');
  });

  it('convierte errores HTTP en ApiError con código y mensaje', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'VALIDATION_ERROR', message: 'Datos inválidos' }));
    await expect(api.get('/schematics')).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Datos inválidos' });
  });

  it('devuelve undefined para respuestas 204', async () => {
    fetchMock.mockResolvedValue(jsonResponse(204, null));
    await expect(api.delete('/schematics/1')).resolves.toBeUndefined();
  });
});
