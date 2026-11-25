import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorBanner, Icon, IconButton, Metric, SkeletonCard, buttonClass, inputClass } from '../components/ui';
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
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink pb-5">
        <div>
          <div className="label mb-2 text-muted">Minelibs / {t('library')}</div>
          <h1 className="font-mono text-2xl font-bold uppercase tracking-[0.08em] text-ink sm:text-3xl">{t('library')}</h1>
          <p className="mt-2 max-w-2xl font-sans text-sm text-muted">{t('librarySubtitle')}</p>
        </div>
        <div className="flex items-stretch gap-2">
          <Metric label={t('blocks')} value={data?.total ?? '—'} hint={t('library')} className="min-w-[104px]" />
          <Link to="/new" className={buttonClass('primary', 'md', 'self-stretch')} style={{ height: 'auto' }}>
            <Icon name="plus" />
            {t('newSchematic')}
          </Link>
        </div>
      </div>

      <Card className="p-4">
        <form onSubmit={onSearch} className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input name="q" defaultValue={filters.q} placeholder={t('search')} aria-label={t('search')} className={inputClass} />
          <input aria-label={t('tags')} placeholder={t('tags')} value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value, page: 1 })} className={inputClass} />
          <input aria-label={t('minecraftVersion')} placeholder={t('minecraftVersion')} value={filters.version} onChange={(event) => setFilters({ ...filters, version: event.target.value, page: 1 })} className={inputClass} />
          <Button type="submit" variant="primary" icon="search">{t('search')}</Button>
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
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-control border border-ink bg-canvas px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink md:col-span-2">
            <input type="checkbox" checked={filters.favorite === 'true'} onChange={(event) => setFilters({ ...filters, favorite: event.target.checked ? 'true' : '', page: 1 })} className="accent-accent" />
            {t('favorites')}
          </label>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-dashed border-dash pt-4">
          <span className="label text-muted">{t('collections')}</span>
          {collections.map((collection) => (
            <span key={collection.id} className="inline-flex items-center gap-1 rounded-full border border-ink bg-ink py-0.5 pl-3 pr-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-paper">
              {collection.name}
              <IconButton label={`${t('delete')} ${collection.name}`} icon="close" variant="onDark" size="xs" onClick={() => openRemoveCollection(collection)} />
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
            <article key={schematic.id} className="overflow-hidden rounded-surface border border-ink bg-surface transition-colors duration-100 hover:border-muted">
              <Link to={`/schematic/${schematic.id}`} className="block aspect-[4/3] overflow-hidden border-b border-ink bg-white" aria-label={schematic.name}>
                {schematic.thumbnailUrl ? (
                  <AuthenticatedImage src={`/schematics/${schematic.id}/thumbnail?v=${encodeURIComponent(schematic.updatedAt)}`} alt={schematic.name} className="h-full w-full object-cover" fallback={schematic.format} />
                ) : (
                  <span className="flex h-full items-center justify-center font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink/60">{schematic.format}</span>
                )}
              </Link>
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/schematic/${schematic.id}`} className="min-w-0 truncate font-mono text-sm font-bold uppercase tracking-[0.06em] text-ink hover:underline decoration-accent decoration-2 underline-offset-4">{schematic.name}</Link>
                  <IconButton
                    label={t('favorite')}
                    icon="star"
                    variant="secondary"
                    size="sm"
                    onClick={() => void toggleFavorite(schematic)}
                    className={schematic.isFavorite ? 'bg-accent text-ink [&_path]:fill-current' : 'text-muted'}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="ink">{schematic.format}</Badge>
                  <Badge tone="lavender">{schematic.minecraftVersion || '—'}</Badge>
                  {schematic.youtubeVideoId && <Badge tone="accent"><Icon name="external" size={10} />YouTube</Badge>}
                </div>
                <p className="tabular border-t border-dashed border-dash pt-3 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                  {schematic.dimensions.widthX}×{schematic.dimensions.heightY}×{schematic.dimensions.lengthZ} · {schematic.totalBlocks} {t('blocks')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {schematic.tags.slice(0, 3).map((tag) => <Badge key={tag} tone="ink">{tag}</Badge>)}
                  {schematic.tags.length > 3 && <Badge tone="lavender">+{schematic.tags.length - 3}</Badge>}
                </div>
                <Button variant="ghost" size="sm" icon="trash" onClick={() => openRemove(schematic)} className="text-terracotta hover:bg-terracotta/10">
                  {t('delete')}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {data && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
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
