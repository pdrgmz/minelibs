import { BlockDefinition, BlockModel, TextureAtlas } from 'deepslate/render';
import type { Resources } from 'deepslate/render';

/** Límite de peticiones simultáneas para no abrir cientos de conexiones. */
const MAX_CONCURRENCY = 8;

export type AssetPhase = 'definitions' | 'models' | 'textures' | 'atlas';

export interface AssetProgress {
  phase: AssetPhase;
  done: number;
  total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normaliza cualquier identificador de Minecraft a `minecraft:<path>` sin propiedades ni sufijos. */
function normalizeId(id: string): string {
  const withoutProperties = id.split('[')[0] ?? id;
  const withoutFragment = withoutProperties.split('#')[0] ?? withoutProperties;
  const path = withoutFragment.includes(':') ? (withoutFragment.split(':')[1] ?? withoutFragment) : withoutFragment;
  return `minecraft:${path.replace(/\.png$/i, '')}`;
}

/** Parte de la ruta bajo `assets/minecraft/` para un ID ya normalizado. */
function assetPath(id: string): string {
  return id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id;
}

function collectModelNames(data: unknown): string[] {
  const names = new Set<string>();
  const visitVariant = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visitVariant(entry);
    } else if (isRecord(value) && typeof value.model === 'string') {
      names.add(normalizeId(value.model));
    }
  };
  if (isRecord(data)) {
    if (isRecord(data.variants)) {
      for (const entry of Object.values(data.variants)) visitVariant(entry);
    }
    if (Array.isArray(data.multipart)) {
      for (const part of data.multipart) {
        if (isRecord(part)) visitVariant(part.apply);
      }
    }
  }
  return [...names];
}

function collectTextureIds(textures: unknown): string[] {
  if (!isRecord(textures)) return [];
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.length > 0 && !value.startsWith('#') && !value.startsWith('builtin/')) {
        ids.add(normalizeId(value));
      }
    } else if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
    } else if (isRecord(value) && typeof value.sprite === 'string') {
      ids.add(normalizeId(value.sprite));
    }
  };
  for (const value of Object.values(textures)) visit(value);
  return [...ids];
}

interface LoaderCache {
  definitions: Map<string, BlockDefinition | null>;
  definitionJson: Map<string, unknown>;
  models: Map<string, BlockModel | null>;
  modelsInFlight: Map<string, Promise<BlockModel | null>>;
  textures: Map<string, Blob | null>;
  /** Texturas de todos los modelos cargados, incluidos los padres. */
  referencedTextures: Set<string>;
}

/**
 * Los assets bajo `/assets/mc/{version}` son públicos y versionados: se puede compartir
 * la caché entre montajes sin cachear datos de usuario autenticados.
 */
const sharedCaches = new Map<string, LoaderCache>();

function cacheFor(version: string): LoaderCache {
  const cached = sharedCaches.get(version);
  if (cached) return cached;
  const created: LoaderCache = {
    definitions: new Map(),
    definitionJson: new Map(),
    models: new Map(),
    modelsInFlight: new Map(),
    textures: new Map(),
    referencedTextures: new Set(),
  };
  sharedCaches.set(version, created);
  return created;
}

/** Carga definiciones, modelos y texturas desde `/assets/mc/{version}/assets/minecraft/...`. */
export class AssetLoader {
  private readonly baseUrl: string;
  private readonly cache: LoaderCache;
  private token: string | null = null;
  private activeFetches = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(version: string) {
    this.baseUrl = `/assets/mc/${encodeURIComponent(version)}/assets/minecraft`;
    this.cache = cacheFor(version);
  }

  /** Los assets son públicos; el token se envía sólo si la app lo facilita. */
  setToken(token: string | null): void {
    this.token = token;
  }

  async getBlockDefinition(id: string): Promise<BlockDefinition | null> {
    const key = normalizeId(id);
    const cached = this.cache.definitions.get(key);
    if (cached !== undefined) return cached;

    const data = await this.fetchJson(`blockstates/${assetPath(key)}.json`);
    const definition = data === null ? null : BlockDefinition.fromJson(data);
    this.cache.definitions.set(key, definition);
    if (data !== null) this.cache.definitionJson.set(key, data);
    return definition;
  }

  async getBlockModel(id: string): Promise<BlockModel | null> {
    const key = normalizeId(id);
    const cached = this.cache.models.get(key);
    if (cached !== undefined) return cached;
    return this.loadModelWithDedupe(key, new Set<string>());
  }

  async getTexture(id: string): Promise<Blob | null> {
    const key = normalizeId(id);
    if (this.cache.textures.has(key)) return this.cache.textures.get(key) ?? null;

    const blob = await this.fetchBlob(`textures/${assetPath(key)}.png`);
    this.cache.textures.set(key, blob);
    return blob;
  }

  /** Descarga todo lo necesario para los IDs dados y construye el `Resources` de deepslate. */
  async buildResources(blockIds: string[], onProgress?: (progress: AssetProgress) => void): Promise<Resources> {
    const blockKeys = [...new Set(blockIds.map(normalizeId))];
    onProgress?.({ phase: 'definitions', done: 0, total: blockKeys.length });

    let definitionsDone = 0;
    await Promise.all(blockKeys.map(async (id) => {
      await this.getBlockDefinition(id);
      definitionsDone += 1;
      onProgress?.({ phase: 'definitions', done: definitionsDone, total: blockKeys.length });
    }));

    const modelIds = new Set<string>();
    for (const id of blockKeys) {
      const raw = this.cache.definitionJson.get(id);
      for (const modelId of collectModelNames(raw)) modelIds.add(modelId);
    }
    const modelList = [...modelIds];
    onProgress?.({ phase: 'models', done: 0, total: modelList.length });

    let modelsDone = 0;
    await Promise.all(modelList.map(async (modelId) => {
      await this.getBlockModel(modelId);
      modelsDone += 1;
      onProgress?.({ phase: 'models', done: modelsDone, total: modelList.length });
    }));

    const textureIds = [...this.cache.referencedTextures];
    onProgress?.({ phase: 'textures', done: 0, total: textureIds.length });
    let texturesDone = 0;
    const blobs = await Promise.all(textureIds.map(async (id) => {
      const blob = await this.getTexture(id);
      texturesDone += 1;
      onProgress?.({ phase: 'textures', done: texturesDone, total: textureIds.length });
      return [id, blob] as const;
    }));

    onProgress?.({ phase: 'atlas', done: 0, total: 1 });
    const textures: Record<string, Blob> = {};
    for (const [id, blob] of blobs) {
      if (blob) textures[id] = blob;
    }

    const atlas = await TextureAtlas.fromBlobs(textures);
    onProgress?.({ phase: 'atlas', done: 1, total: 1 });
    return {
      getBlockDefinition: (id) => this.cache.definitions.get(normalizeId(id.toString())) ?? null,
      getBlockModel: (id) => this.getBlockModelSync(id.toString()),
      getTextureUV: (id) => atlas.getTextureUV(id),
      getTextureAtlas: () => atlas.getTextureAtlas(),
      getPixelSize: () => atlas.getPixelSize(),
      getBlockFlags: () => ({ opaque: false }),
      getBlockProperties: () => null,
      getDefaultBlockProperties: () => null,
    };
  }

  private getBlockModelSync(id: string): BlockModel | null {
    return this.cache.models.get(normalizeId(id)) ?? null;
  }

  private async loadModelWithDedupe(key: string, ancestors: Set<string>): Promise<BlockModel | null> {
    const cached = this.cache.models.get(key);
    if (cached !== undefined) return cached;
    const inFlight = this.cache.modelsInFlight.get(key);
    if (inFlight) return inFlight;

    const promise = this.loadModel(key, ancestors);
    this.cache.modelsInFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this.cache.modelsInFlight.get(key) === promise) this.cache.modelsInFlight.delete(key);
    }
  }

  private async loadModel(key: string, ancestors: Set<string>): Promise<BlockModel | null> {
    const data = await this.fetchJson(`models/${assetPath(key)}.json`);
    if (data === null) {
      this.cache.models.set(key, null);
      return null;
    }

    const model = BlockModel.fromJson(data);
    this.cache.models.set(key, model);

    const raw = data as { parent?: unknown; textures?: unknown };
    for (const textureId of collectTextureIds(raw.textures)) this.cache.referencedTextures.add(textureId);

    const parent = typeof raw.parent === 'string' && raw.parent.length > 0
      ? normalizeId(raw.parent)
      : null;
    if (parent && parent !== key && !parent.startsWith('minecraft:builtin/') && !ancestors.has(parent)) {
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(key);
      await this.loadModelWithDedupe(parent, nextAncestors);
    }

    // Todos los padres ya están en caché; flatten() puede resolverlos sincrónicamente.
    model.flatten({ getBlockModel: (id) => this.getBlockModelSync(id.toString()) });
    return model;
  }

  private async fetchJson(path: string): Promise<unknown | null> {
    try {
      const response = await this.fetch(path);
      if (!response.ok) return null;
      return await response.json() as unknown;
    } catch {
      return null;
    }
  }

  private async fetchBlob(path: string): Promise<Blob | null> {
    try {
      const response = await this.fetch(path);
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  }

  private async fetch(path: string): Promise<Response> {
    return this.withSlot(async () => {
      const headers: Record<string, string> = {};
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      return fetch(`${this.baseUrl}/${path}`, { headers });
    });
  }

  private async withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeFetches >= MAX_CONCURRENCY) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.activeFetches += 1;
    try {
      return await task();
    } finally {
      this.activeFetches -= 1;
      this.waiting.shift()?.();
    }
  }
}
