import type {
  AdminSchematic,
  Collection,
  ImportResult,
  Page,
  SchematicDetail,
  SchematicSummary,
  User,
} from '../types';

const BASE = '/api/v1';
let accessToken: string | null = null;
let refreshInFlight: Promise<{ accessToken: string; user: User } | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return new ApiError(response.status, body.error ?? 'ERROR', body.message ?? response.statusText);
  } catch {
    return new ApiError(response.status, 'ERROR', response.statusText);
  }
}

/** Ejecuta la petición y reintenta una vez tras refrescar la sesión siexpira. */
async function fetchWithRefresh(path: string, init: RequestInit, retry: boolean): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');

  const response = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });

  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return fetchWithRefresh(path, init, false);
  }
  if (!response.ok) throw await parseError(response);
  return response;
}

export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const response = await fetchWithRefresh(path, init, retry);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Para descargas (ZIP, binarios): nunca se cachea en el service worker. */
export async function requestBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const response = await fetchWithRefresh(path, init, true);
  return response.blob();
}

export async function refreshSession(): Promise<{ accessToken: string; user: User } | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!response.ok) return null;
      const session = (await response.json()) as { accessToken: string; user: User };
      setAccessToken(session.accessToken);
      return session;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

const json = (method: string) => <T>(path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: json('POST'),
  patch: json('PATCH'),
  put: json('PUT'),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
  uploadPut: <T>(path: string, form: FormData) => request<T>(path, { method: 'PUT', body: form }),
  blob: (path: string) => requestBlob(path),
  auth: {
    async login(username: string, password: string): Promise<{ accessToken: string; user: User }> {
      const session = await request<{ accessToken: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAccessToken(session.accessToken);
      return session;
    },
    async register(username: string, password: string): Promise<{ accessToken: string; user: User }> {
      const session = await request<{ accessToken: string; user: User }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAccessToken(session.accessToken);
      return session;
    },
    async logout(): Promise<void> {
      await request<void>('/auth/logout', { method: 'POST' });
      setAccessToken(null);
    },
    refresh: refreshSession,
    me: () => request<User>('/auth/me'),
  },
  schematics: {
    list: (params: URLSearchParams) => api.get<Page<SchematicSummary>>(`/schematics?${params.toString()}`),
    get: (id: string, asAdmin = false) => api.get<SchematicDetail>(`/schematics/${id}${asAdmin ? '?asAdmin=true' : ''}`),
    create: (form: FormData, force = false) => api.upload<SchematicDetail>(`/schematics${force ? '?force=true' : ''}`, form),
    patch: (id: string, body: Partial<SchematicDetail>) => api.patch<SchematicDetail>(`/schematics/${id}`, body),
    remove: (id: string) => api.delete<void>(`/schematics/${id}`),
    replaceFile: (id: string, form: FormData) => api.uploadPut<SchematicDetail>(`/schematics/${id}/file`, form),
    uploadThumbnail: (id: string, blob: Blob) => {
      const form = new FormData();
      form.append('thumbnail', blob, 'thumbnail.png');
      return api.upload<SchematicDetail>(`/schematics/${id}/thumbnail`, form);
    },
    /** Descarga con cabecera Bearer: `<img>` y `<a>` no pueden autenticarse por sí solos. */
    thumbnailBlob: (id: string, asAdmin = false) =>
      requestBlob(`/schematics/${id}/thumbnail${asAdmin ? '?asAdmin=true' : ''}`),
    async download(id: string, filename: string, asAdmin = false): Promise<void> {
      const query = `${asAdmin ? 'asAdmin=true&' : ''}download=1`;
      downloadBlob(await requestBlob(`/schematics/${id}/file?${query}`), filename);
    },
    reparse: () => api.post<{ total: number; updated: number; failed: number; parserVersion: number }>('/schematics/reparse'),
  },
  collections: {
    list: () => api.get<Collection[]>('/collections'),
    create: (name: string, description?: string) => api.post<Collection>('/collections', { name, description }),
    update: (id: string, body: Partial<Pick<Collection, 'name' | 'description'>>) => api.patch<Collection>(`/collections/${id}`, body),
    remove: (id: string) => api.delete<void>(`/collections/${id}`),
  },
  backup: {
    exportMine: () => api.blob('/me/export'),
    importZip: (file: File | Blob) => {
      const form = new FormData();
      form.append('file', file, 'backup.zip');
      return api.upload<ImportResult>('/me/import', form);
    },
  },
  admin: {
    users: () => api.get<Page<User>>('/admin/users'),
    schematics: (params: URLSearchParams = new URLSearchParams()) =>
      api.get<Page<AdminSchematic>>(`/admin/schematics?${params.toString()}`),
    createUser: (username: string, password: string, role: 'USER' | 'ADMIN') =>
      api.post<User>('/admin/users', { username, password, role }),
    updateUser: (id: string, body: { role?: 'USER' | 'ADMIN'; password?: string }) =>
      api.patch<User>(`/admin/users/${id}`, body),
    deleteUser: (id: string) => api.delete<void>(`/admin/users/${id}`),
    exportAll: () => api.blob('/admin/export'),
  },
};
