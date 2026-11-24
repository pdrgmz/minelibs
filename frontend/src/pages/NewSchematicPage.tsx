import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Button, Card, ErrorBanner, Field, Icon, PageHeader, PromptModal, inputClass } from '../components/ui';
import type { Collection, SchematicDetail } from '../types';

export function NewSchematicPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [minecraftVersion, setMinecraftVersion] = useState('');
  const [tags, setTags] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [force, setForce] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState('');
  const [collectionError, setCollectionError] = useState('');
  const [collectionBusy, setCollectionBusy] = useState(false);

  useEffect(() => {
    void api.collections.list().then(setCollections).catch(() => undefined);
  }, []);

  const openCreateCollection = () => {
    setCollectionDraft('');
    setCollectionError('');
    setCollectionOpen(true);
  };

  const createCollection = async (value: string) => {
    const name = value.trim();
    if (!name) {
      setCollectionError(t('requiredError'));
      return;
    }
    setCollectionBusy(true);
    setCollectionError('');
    try {
      const collection = await api.collections.create(name);
      setCollections((current) => [...current, collection]);
      setCollectionId(collection.id);
      setCollectionOpen(false);
      setCollectionDraft('');
    } catch (cause) {
      setCollectionError(cause instanceof Error ? cause.message : t('error'));
    } finally {
      setCollectionBusy(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    form.set('file', file);
    form.set('name', name);
    form.set('description', description);
    form.set('youtubeUrl', youtubeUrl);
    form.set('minecraftVersion', minecraftVersion);
    form.set('tags', tags);
    form.set('collectionId', collectionId);
    form.set('isFavorite', String(isFavorite));

    try {
      const schematic = await api.schematics.create(form, force);
      navigate(`/schematic/${(schematic as SchematicDetail).id}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setError(`${t('duplicate')} ${cause.message}`);
        setForce(true);
      } else {
        setError(cause instanceof Error ? cause.message : t('error'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t('newSchematic')}
        description={t('newSchematicSubtitle')}
        back={<Link to="/" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"><Icon name="chevronLeft" size={14} />{t('library')}</Link>}
      />
      <Card>
        <form onSubmit={(event) => void onSubmit(event)} className="space-y-5">
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-200">{t('file')}</span>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-700 bg-surface/50 p-4 text-sm hover:border-accent/60">
              <Icon name="upload" size={20} className="text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-slate-100">{file ? file.name : t('file')}</span>
                <span className="mt-0.5 block text-xs text-slate-500">.litematic · .schem · .nbt</span>
              </span>
              <input required type="file" accept=".litematic,.schem,.nbt" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="sr-only" />
              <span className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300">{t('upload')}</span>
            </label>
          </div>
          <Field label={t('name')}>
            <input required maxLength={150} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
          </Field>
          <Field label={t('description')}>
            <textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('youtubeUrl')}>
              <input type="url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://youtu.be/..." className={inputClass} />
            </Field>
            <Field label={t('minecraftVersion')}>
              <input maxLength={32} value={minecraftVersion} onChange={(event) => setMinecraftVersion(event.target.value)} placeholder="1.21.4" className={inputClass} />
            </Field>
          </div>
          <Field label={t('tags')} hint={t('tagsHint')}>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="hierro, redstone" className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label={t('collections')}>
              <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)} className={inputClass}>
                <option value="">—</option>
                {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
              </select>
            </Field>
            <Button icon="plus" onClick={openCreateCollection}>+ {t('createCollection')}</Button>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={isFavorite} onChange={(event) => setIsFavorite(event.target.checked)} className="accent-accent" />
              {t('favorite')}
            </label>
            {force && (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-amber-800/70 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
                <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} className="accent-amber-400" />
                {t('uploadAnyway')}
              </label>
            )}
          </div>
          <ErrorBanner>{error}</ErrorBanner>
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-4">
            <Button as-link to="/" icon="close">{t('cancel')}</Button>
            <Button type="submit" variant="primary" icon="check" loading={busy} disabled={!file}>{t('save')}</Button>
          </div>
        </form>
      </Card>

      <PromptModal
        open={collectionOpen}
        title={t('createCollection')}
        label={t('collectionName')}
        value={collectionDraft}
        onChange={setCollectionDraft}
        onSubmit={(value) => void createCollection(value)}
        onClose={() => { setCollectionOpen(false); setCollectionError(''); }}
        confirmLabel={t('create')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        placeholder={t('collectionName')}
        error={collectionError}
        loading={collectionBusy}
        maxLength={100}
      />
    </div>
  );
}
