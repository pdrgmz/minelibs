import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { Button, Card, ConfirmModal, EmptyState, ErrorBanner, Icon, IconButton, SkeletonCard, buttonClass, inputClass } from '../components/ui';
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

type ConfirmTarget = { kind: 'collection'; collection: Collection } | { kind: 'schematic'; schematic: SchematicSummary };

export function LibraryPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [data, setData] = useState<Page<SchematicSummary> | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionName, setCollectionName] = useState('');
  const [showCollectionForm, setShowCollectionForm] = useState(false);
  const [error, setError] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');

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

  const openRemoveCollection = (collection: Collection) => {
    setConfirmError('');
    setConfirmTarget({ kind: 'collection', collection });
  };

  const openRemove = (schematic: SchematicSummary) => {
    setConfirmError('');
    setConfirmTarget({ kind: 'schematic', schematic });
  };

  const runConfirm = async () => {
    const target = confirmTarget;
    if (!target) return;
    setConfirmBusy(true);
    setConfirmError('');
    try {
      if (target.kind === 'collection') {
        await api.collections.remove(target.collection.id);
        if (filters.collectionId === target.collection.id) setFilters({ ...filters, collectionId: '', page: 1 });
        await reloadCollections();
      } else {
        await api.schematics.remove(target.schematic.id);
        await load();
      }
      setConfirmTarget(null);
    } catch (cause) {
      setConfirmError(cause instanceof ApiError ? cause.message : t('error'));
    } finally {
      setConfirmBusy(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const hasFilters = Boolean(filters.q || filters.tag || filters.version || filters.favorite || filters.collectionId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('library')}</h1>
          <p className="mt-1 text-sm text-slate-400">{t('librarySubtitle')}</p>
        </div>
        <Link to="/new" className={buttonClass('primary')}>
          <Icon name="plus" />
          {t('newSchematic')}
        </Link>
      </div>

      <Card className="p-4">
        <form onSubmit={onSearch} className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input name="q" defaultValue={filters.q} placeholder={t('search')} aria-label={t('search')} className={inputClass} />
          <input aria-label={t('tags')} placeholder={t('tags')} value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value, page: 1 })} className={inputClass} />
          <input aria-label={t('minecraftVersion')} placeholder={t('minecraftVersion')} value={filters.version} onChange={(event) => setFilters({ ...filters, version: event.target.value, page: 1 })} className={inputClass} />
          <Button type="submit" variant="secondary" icon="search">{t('search')}</Button>
          <select aria-label={t('collections')} value={filters.collectionId} onChange={(event) => setFilters({ ...filters, collectionId: event.target.value, page: 1 })} className={inputClass}>
            <option value="">{t('collections')}: {t('all')}</option>
            {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
          </select>
          <select aria-label={t('sort')} value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value as Filters['sort'], page: 1 })} className={inputClass}>
            <option value="createdAt">{t('sortCreated')}</option>
            <option value="updatedAt">{t('sortUpdated')}</option>
            <option value="name">{t('sortName')}</option>
            <option value="totalBlocks">{t('sortBlocks')}</option>
          </select>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-surface px-3 text-sm text-slate-300 md:col-span-2">
            <input type="checkbox" checked={filters.favorite === 'true'} onChange={(event) => setFilters({ ...filters, favorite: event.target.checked ? 'true' : '', page: 1 })} className="accent-accent" />
            {t('favorites')}
          </label>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4 text-sm">
          <span className="font-medium text-slate-400">{t('collections')}</span>
          {collections.map((collection) => (
            <span key={collection.id} className="inline-flex items-center gap-1 rounded-lg bg-slate-800/70 py-1 pl-2.5 pr-1 text-xs text-slate-200">
              {collection.name}
              <IconButton label={`${t('delete')} ${collection.name}`} icon="close" size="sm" onClick={() => openRemoveCollection(collection)} className="text-slate-500 hover:text-red-300" />
            </span>
          ))}
          <Button variant="ghost" size="sm" icon="plus" onClick={() => setShowCollectionForm((value) => !value)}>{t('createCollection')}</Button>
        </div>
        {showCollectionForm && (
          <form onSubmit={(event) => void createCollection(event)} className="mt-3 flex flex-wrap gap-2">
            <input required value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder={t('collectionName')} aria-label={t('collectionName')} className={`${inputClass} max-w-xs`} />
            <Button type="submit" variant="primary" icon="check">{t('create')}</Button>
          </form>
        )}
      </Card>

      <ErrorBanner>{error}</ErrorBanner>

      {!data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      )}

      {data && data.items.length === 0 && (
        hasFilters ? (
          <EmptyState
            icon="search"
            title={t('noResults')}
            description={t('emptyLibrary')}
            action={<Button variant="secondary" icon="refresh" onClick={() => setFilters(emptyFilters)}>{t('all')}</Button>}
          />
        ) : (
          <EmptyState
            icon="box"
            title={t('emptyLibrary')}
            description={t('librarySubtitle')}
            action={<Link to="/new" className={buttonClass('primary')}><Icon name="plus" />{t('newSchematic')}</Link>}
          />
        )
      )}

      {data && data.items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((schematic) => (
            <article key={schematic.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-panel transition-colors duration-100 hover:border-slate-700">
              <Link to={`/schematic/${schematic.id}`} className="block h-36 bg-surface" aria-label={schematic.name}>
                {schematic.thumbnailUrl ? (
                  <AuthenticatedImage src={`/schematics/${schematic.id}/thumbnail`} alt={schematic.name} className="h-full w-full object-cover" fallback={schematic.format} />
                ) : (
                  <span className="flex h-full items-center justify-center text-xs uppercase tracking-wide text-slate-500">{schematic.format}</span>
                )}
              </Link>
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/schematic/${schematic.id}`} className="min-w-0 truncate font-medium text-white hover:text-accent">{schematic.name}</Link>
                  <IconButton
                    label={t('favorite')}
                    icon="star"
                    variant="ghost"
                    size="sm"
                    onClick={() => void toggleFavorite(schematic)}
                    className={schematic.isFavorite ? 'text-accent [&_path]:fill-current' : 'text-slate-500 hover:text-accent'}
                  />
                </div>
                <p className="tabular text-xs text-slate-400">
                  {schematic.dimensions.widthX} × {schematic.dimensions.heightY} × {schematic.dimensions.lengthZ} · {schematic.totalBlocks} {t('blocks')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {schematic.tags.map((tag) => <span key={tag} className="rounded-lg bg-slate-800/70 px-2 py-0.5 text-xs text-slate-300">{tag}</span>)}
                  {schematic.youtubeVideoId && <span className="inline-flex items-center gap-1 rounded-lg bg-slate-800/70 px-2 py-0.5 text-xs text-slate-300"><Icon name="external" size={12} />YouTube</span>}
                </div>
                <Button variant="ghost" size="sm" icon="trash" onClick={() => openRemove(schematic)} className="text-red-300 hover:text-red-200 hover:bg-red-950/40">
                  {t('delete')}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {data && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm text-slate-400">
          <IconButton label={t('previousPage')} icon="chevronLeft" variant="secondary" size="sm" disabled={filters.page === 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })} />
          <span className="tabular">{t('page')} {filters.page} {t('of')} {totalPages}</span>
          <IconButton label={t('nextPage')} icon="chevronRight" variant="secondary" size="sm" disabled={filters.page >= totalPages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })} />
        </div>
      )}

      <ConfirmModal
        open={confirmTarget !== null}
        title={t('delete')}
        description={confirmTarget?.kind === 'collection'
          ? t('confirmDeleteCollection', { name: confirmTarget.collection.name })
          : t('confirmDelete')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        loading={confirmBusy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onClose={() => { setConfirmTarget(null); setConfirmError(''); }}
      />
    </div>
  );
}
