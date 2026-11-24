import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import type { Collection, Page, SchematicSummary } from '../types';

interface Filters {
  q: string;
  tag: string;
  version: string;
  favorite: string;
  collectionId: string;
  sort: 'createdAt' | 'name' | 'totalBlocks' | 'updatedAt';
  page: number;
}

const emptyFilters: Filters = { q: '', tag: '', version: '', favorite: '', collectionId: '', sort: 'createdAt', page: 1 };

export function LibraryPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [data, setData] = useState<Page<SchematicSummary> | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionName, setCollectionName] = useState('');
  const [showCollectionForm, setShowCollectionForm] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== '' && value !== 1) params.set(key, String(value));
    });
    try {
      setData(await api.schematics.list(params));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'));
    }
  }, [filters, t]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void api.collections.list().then(setCollections).catch(() => undefined);
  }, []);

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    setFilters((current) => ({ ...current, q: (form.elements.namedItem('q') as HTMLInputElement).value, page: 1 }));
  };

  const toggleFavorite = async (schematic: SchematicSummary) => {
    await api.schematics.patch(schematic.id, { isFavorite: !schematic.isFavorite } as Partial<SchematicSummary>);
    await load();
  };

  const reloadCollections = async () => setCollections(await api.collections.list());

  const createCollection = async (event: FormEvent) => {
    event.preventDefault();
    if (!collectionName.trim()) return;
    try {
      await api.collections.create(collectionName.trim());
      setCollectionName('');
      setShowCollectionForm(false);
      await reloadCollections();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'));
    }
  };

  const removeCollection = async (collection: Collection) => {
    if (!window.confirm(`${t('delete')} «${collection.name}»?`)) return;
    try {
      await api.collections.remove(collection.id);
      if (filters.collectionId === collection.id) setFilters({ ...filters, collectionId: '', page: 1 });
      await reloadCollections();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'));
    }
  };

  const remove = async (schematic: SchematicSummary) => {
    if (!window.confirm(t('confirmDelete'))) return;
    try {
      await api.schematics.remove(schematic.id);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('error'));
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('library')}</h1>
        <Link to="/new" className="rounded bg-accent px-4 py-2 font-semibold">+ {t('newSchematic')}</Link>
      </div>

      <form onSubmit={onSearch} className="flex flex-wrap gap-2 rounded-lg bg-panel p-3">
        <input name="q" defaultValue={filters.q} placeholder={t('search')} className="min-w-48 flex-1 rounded border border-slate-600 bg-surface px-3 py-2" />
        <input
          aria-label={t('tags')}
          placeholder={t('tags')}
          value={filters.tag}
          onChange={(event) => setFilters({ ...filters, tag: event.target.value, page: 1 })}
          className="w-36 rounded border border-slate-600 bg-surface px-3 py-2"
        />
        <input
          aria-label={t('minecraftVersion')}
          placeholder={t('minecraftVersion')}
          value={filters.version}
          onChange={(event) => setFilters({ ...filters, version: event.target.value, page: 1 })}
          className="w-36 rounded border border-slate-600 bg-surface px-3 py-2"
        />
        <select value={filters.collectionId} onChange={(event) => setFilters({ ...filters, collectionId: event.target.value, page: 1 })} className="rounded border border-slate-600 bg-surface px-2 py-2">
          <option value="">{t('collections')}: {t('all')}</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>{collection.name}</option>
          ))}
        </select>
        <select aria-label={t('sort')} value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value as Filters['sort'], page: 1 })} className="rounded border border-slate-600 bg-surface px-2 py-2">
          <option value="createdAt">{t('sortCreated')}</option>
          <option value="updatedAt">{t('sortUpdated')}</option>
          <option value="name">{t('sortName')}</option>
          <option value="totalBlocks">{t('sortBlocks')}</option>
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={filters.favorite === 'true'} onChange={(event) => setFilters({ ...filters, favorite: event.target.checked ? 'true' : '', page: 1 })} />
          {t('favorites')}
        </label>
        <button className="rounded bg-slate-700 px-3 py-2">{t('search')}</button>
      </form>

      <section className="rounded-lg bg-panel p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{t('collections')}:</span>
          {collections.map((collection) => (
            <span key={collection.id} className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1">
              {collection.name}
              <button aria-label={`${t('delete')} ${collection.name}`} onClick={() => void removeCollection(collection)} className="text-red-300 hover:text-red-100">×</button>
            </span>
          ))}
          <button onClick={() => setShowCollectionForm((value) => !value)} className="text-accent hover:underline">+ {t('createCollection')}</button>
        </div>
        {showCollectionForm && (
          <form onSubmit={(event) => void createCollection(event)} className="mt-3 flex flex-wrap gap-2">
            <input required value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder={t('collectionName')} className="rounded border border-slate-600 bg-surface px-3 py-2" />
            <button className="rounded bg-accent px-3 py-2">{t('create')}</button>
          </form>
        )}
      </section>

      {error && <p className="text-red-400">{error}</p>}
      {data && data.items.length === 0 && <p className="rounded bg-panel p-6 text-slate-400">{t('emptyLibrary')}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.items.map((schematic) => (
          <article key={schematic.id} className="overflow-hidden rounded-xl border border-slate-700 bg-panel">
            <Link to={`/schematic/${schematic.id}`} className="block h-36 bg-slate-800">
              {schematic.thumbnailUrl ? (
                <AuthenticatedImage
                  src={`/schematics/${schematic.id}/thumbnail`}
                  alt={schematic.name}
                  className="h-full w-full object-cover"
                  fallback={schematic.format}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-slate-500">{schematic.format}</div>
              )}
            </Link>
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <Link to={`/schematic/${schematic.id}`} className="truncate font-semibold hover:text-accent">{schematic.name}</Link>
                <button aria-label={t('favorite')} onClick={() => void toggleFavorite(schematic)} className={schematic.isFavorite ? 'text-yellow-400' : 'text-slate-500'}>
                  {schematic.isFavorite ? '★' : '☆'}
                </button>
              </div>
              <p className="text-sm text-slate-400">
                {schematic.dimensions.widthX} × {schematic.dimensions.heightY} × {schematic.dimensions.lengthZ} · {schematic.totalBlocks} {t('blocks')}
              </p>
              <div className="flex flex-wrap gap-1">
                {schematic.tags.map((tag) => (
                  <span key={tag} className="rounded bg-slate-700 px-2 py-0.5 text-xs">{tag}</span>
                ))}
                {schematic.youtubeVideoId && <span className="rounded bg-red-900/60 px-2 py-0.5 text-xs">YouTube</span>}
              </div>
              <button onClick={() => void remove(schematic)} className="text-sm text-red-400 hover:underline">{t('delete')}</button>
            </div>
          </article>
        ))}
      </div>

      {data && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button disabled={filters.page === 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })} className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40">←</button>
          <span className="text-sm">{t('page')} {filters.page} {t('of')} {totalPages}</span>
          <button disabled={filters.page >= totalPages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })} className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40">→</button>
        </div>
      )}
    </div>
  );
}
