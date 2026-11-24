import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
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

  useEffect(() => {
    void api.collections.list().then(setCollections).catch(() => undefined);
  }, []);

  const createCollection = async () => {
    const value = window.prompt(t('createCollection'));
    if (!value) return;
    const collection = await api.collections.create(value);
    setCollections((current) => [...current, collection]);
    setCollectionId(collection.id);
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
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">{t('newSchematic')}</h1>
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-4 rounded-xl border border-slate-700 bg-panel p-5">
        <label className="block">
          <span className="mb-1 block text-sm">{t('file')}</span>
          <input required type="file" accept=".litematic,.schem,.nbt" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="w-full text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm">{t('name')}</span>
          <input required maxLength={150} value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded border border-slate-600 bg-surface px-3 py-2" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm">{t('description')}</span>
          <textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="w-full rounded border border-slate-600 bg-surface px-3 py-2" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm">{t('youtubeUrl')}</span>
            <input type="url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://youtu.be/..." className="w-full rounded border border-slate-600 bg-surface px-3 py-2" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm">{t('minecraftVersion')}</span>
            <input maxLength={32} value={minecraftVersion} onChange={(event) => setMinecraftVersion(event.target.value)} placeholder="1.21.4" className="w-full rounded border border-slate-600 bg-surface px-3 py-2" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm">{t('tags')}</span>
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="hierro, redstone" className="w-full rounded border border-slate-600 bg-surface px-3 py-2" />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1">
            <span className="mb-1 block text-sm">{t('collections')}</span>
            <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)} className="w-full rounded border border-slate-600 bg-surface px-3 py-2">
              <option value="">—</option>
              {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void createCollection()} className="rounded border border-slate-600 px-3 py-2 text-sm">+ {t('createCollection')}</button>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={isFavorite} onChange={(event) => setIsFavorite(event.target.checked)} />
            {t('favorite')}
          </label>
        </div>
        {force && (
          <label className="flex items-center gap-2 rounded border border-yellow-700 bg-yellow-900/30 p-2 text-sm">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            {t('uploadAnyway')}
          </label>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button disabled={busy || !file} className="rounded bg-accent px-4 py-2 font-semibold disabled:opacity-50">{t('save')}</button>
      </form>
    </div>
  );
}
