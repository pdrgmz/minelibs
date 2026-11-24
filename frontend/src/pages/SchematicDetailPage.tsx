import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, downloadBlob, getAccessToken } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSchematicParse } from '../hooks/useSchematicParse';
import type { Material, SchematicDetail } from '../types';
import {
  filterMaterials,
  materialsForLayer,
  materialsToCsv,
  materialsToText,
  presentMaterials,
} from '../utils/materials';
import { SchematicViewer } from '../viewer';

export function SchematicDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const asAdmin = user?.role === 'ADMIN';
  const [schematic, setSchematic] = useState<SchematicDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [layerY, setLayerY] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [showRuler, setShowRuler] = useState(false);
  const [layerMode, setLayerMode] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [renderStage, setRenderStage] = useState('');
  const [materialQuery, setMaterialQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '', minecraftVersion: '', tags: '' });
  const captureRef = useRef<(() => string | null) | null>(null);
  const thumbnailDone = useRef<string | null>(null);

  useEffect(() => {
    void api.schematics.get(id, asAdmin).then((detail) => {
      setSchematic(detail);
      setDraft({
        name: detail.name,
        description: detail.description ?? '',
        minecraftVersion: detail.minecraftVersion ?? '',
        tags: detail.tags.join(', '),
      });
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t('error')));
  }, [id, t, asAdmin]);

  const fileUrl = schematic ? `${schematic.fileUrl}${asAdmin ? '?asAdmin=true' : ''}` : null;
  const { parsed, stage, error: parseError } = useSchematicParse(fileUrl, getAccessToken());

  const blocks = useMemo(() => parsed?.blocks ?? [], [parsed]);
  const allMaterials = useMemo(
    () => (layerY === null ? schematic?.materials ?? [] : materialsForLayer(blocks, layerY)),
    [layerY, schematic, blocks],
  );
  const rows = useMemo(() => filterMaterials(presentMaterials(allMaterials), materialQuery), [allMaterials, materialQuery]);
  const checked = new Set(schematic?.checkedMaterials ?? []);
  const checkedCount = rows.filter((row) => checked.has(row.blockId)).length;

  // Genera la miniatura isométrica una sola vez por schematic cuando el visor está listo.
  useEffect(() => {
    if (!schematic || !parsed || !captureRef.current || thumbnailDone.current === schematic.id) return;
    thumbnailDone.current = schematic.id;
    const timer = window.setTimeout(() => {
      const dataUrl = captureRef.current?.();
      if (!dataUrl) return;
      void fetch(dataUrl)
        .then((response) => response.blob())
        .then((blob) => api.schematics.uploadThumbnail(schematic.id, blob))
        .then((updated) => setSchematic(updated))
        .catch(() => setNotice(t('thumbnailFailed')));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [schematic, parsed, t]);

  const toggleMaterial = async (blockId: string) => {
    if (!schematic) return;
    const next = checked.has(blockId)
      ? schematic.checkedMaterials.filter((item) => item !== blockId)
      : [...schematic.checkedMaterials, blockId];
    setSchematic(await api.schematics.patch(id, { checkedMaterials: next } as Partial<SchematicDetail>));
  };

  const remove = async () => {
    if (!window.confirm(t('confirmDelete'))) return;
    await api.schematics.remove(id);
    navigate('/');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!schematic) return;
    const updated = await api.schematics.patch(id, {
      name: draft.name,
      description: draft.description,
      minecraftVersion: draft.minecraftVersion,
      tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    } as Partial<SchematicDetail>);
    setSchematic(updated);
    setEditing(false);
    setNotice(t('saved'));
  };

  const replaceFile = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    thumbnailDone.current = null;
    setSchematic(await api.schematics.replaceFile(id, form));
  };

  const exportCsv = () => downloadBlob(new Blob([materialsToCsv(rows)], { type: 'text/csv' }), `${schematic?.name ?? 'materials'}.csv`);
  const exportText = () => downloadBlob(new Blob([materialsToText(rows)], { type: 'text/plain' }), `${schematic?.name ?? 'materials'}.txt`);
  const resetChecked = async () => {
    if (!schematic) return;
    setSchematic(await api.schematics.patch(id, { checkedMaterials: [] } as Partial<SchematicDetail>));
  };

  const onReady = useCallback((capture: () => string | null) => { captureRef.current = capture; }, []);

  // Atajos del modo capa y del resaltado (AGENTS.md §4.5 / docs/04 Fase 3).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setHighlight(null);
        setMeasureMode(false);
        return;
      }
      if (layerY === null) return;
      const maxY = Math.max(0, (schematic?.dimensions.heightY ?? 1) - 1);
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setLayerY((value) => Math.min(maxY, (value ?? 0) + 1));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setLayerY((value) => Math.max(0, (value ?? 0) - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layerY, schematic?.dimensions.heightY]);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!schematic) return <p className="text-slate-400">{t('loading')}</p>;

  const version = schematic.minecraftVersion ?? '1.21.4';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/" className="text-sm text-accent hover:underline">← {t('library')}</Link>
          <h1 className="mt-1 text-3xl font-bold">{schematic.name}</h1>
          <p className="mt-1 text-slate-400">{schematic.description}</p>
          <p className="mt-2 text-sm text-slate-300">
            {schematic.dimensions.widthX} × {schematic.dimensions.heightY} × {schematic.dimensions.lengthZ} · {schematic.totalBlocks} {t('blocks')} · {schematic.minecraftVersion ?? '—'} · {schematic.originalFilename}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void api.schematics.download(id, schematic.originalFilename, asAdmin)} className="rounded border border-slate-600 px-3 py-2 text-sm">{t('download')}</button>
          <button onClick={() => setEditing((value) => !value)} className="rounded border border-slate-600 px-3 py-2 text-sm">{t('edit')}</button>
          <label className="cursor-pointer rounded border border-slate-600 px-3 py-2 text-sm">
            {t('replaceFile')}
            <input type="file" accept=".litematic,.schem,.nbt" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void replaceFile(file);
            }} />
          </label>
          <button onClick={() => void remove()} className="rounded border border-red-800 px-3 py-2 text-sm text-red-400">{t('delete')}</button>
        </div>
      </div>

      {notice && <p className="rounded bg-panel px-3 py-2 text-sm text-accent">{notice}</p>}

      {editing && (
        <form onSubmit={(event) => void save(event)} className="grid gap-3 rounded-xl border border-slate-700 bg-panel p-5 sm:grid-cols-2">
          <label className="text-sm">{t('name')}<input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="mt-1 w-full rounded bg-surface px-3 py-2" /></label>
          <label className="text-sm">{t('minecraftVersion')}<input value={draft.minecraftVersion} onChange={(e) => setDraft({ ...draft, minecraftVersion: e.target.value })} className="mt-1 w-full rounded bg-surface px-3 py-2" /></label>
          <label className="text-sm sm:col-span-2">{t('description')}<textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="mt-1 w-full rounded bg-surface px-3 py-2" /></label>
          <label className="text-sm sm:col-span-2">{t('tags')}<input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} className="mt-1 w-full rounded bg-surface px-3 py-2" /></label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className="rounded bg-accent px-3 py-2">{t('save')}</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded border border-slate-600 px-3 py-2">{t('cancel')}</button>
          </div>
        </form>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-700 bg-panel p-5">
          <h2 className="mb-3 text-lg font-semibold">{t('viewer3d')}</h2>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              {t('layer')}
              <input type="checkbox" checked={layerY !== null} onChange={(e) => setLayerY(e.target.checked ? Math.floor(schematic.dimensions.heightY / 2) : null)} />
            </label>
            {layerY !== null && (
              <>
                <button
                  aria-label={t('previousLayer')}
                  disabled={layerY === 0}
                  onClick={() => setLayerY(layerY - 1)}
                  className="rounded border border-slate-600 px-2 disabled:opacity-40"
                >←</button>
                <input type="range" min={0} max={Math.max(0, schematic.dimensions.heightY - 1)} value={layerY} onChange={(e) => setLayerY(Number(e.target.value))} className="w-36" />
                <button
                  aria-label={t('nextLayer')}
                  disabled={layerY >= schematic.dimensions.heightY - 1}
                  onClick={() => setLayerY(layerY + 1)}
                  className="rounded border border-slate-600 px-2 disabled:opacity-40"
                >→</button>
                <span className="text-slate-400">Y = {layerY} / {Math.max(0, schematic.dimensions.heightY - 1)}</span>
              </>
            )}
            {layerY === null && <span className="text-slate-400">{t('allLayers')}</span>}
            <label className="flex items-center gap-2 disabled:opacity-40">
              {t('layerMode')}
              <input type="checkbox" disabled={layerY === null} checked={layerMode} onChange={(e) => setLayerMode(e.target.checked)} />
            </label>
            <label className="flex items-center gap-2">
              {t('showGrid')}
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
            </label>
            <label className="flex items-center gap-2">
              {t('showRuler')}
              <input type="checkbox" checked={showRuler} onChange={(e) => setShowRuler(e.target.checked)} />
            </label>
            <button
              disabled={layerY === null}
              onClick={() => setMeasureMode((value) => !value)}
              className={`rounded border px-2 py-1 disabled:opacity-40 ${measureMode ? 'border-amber-400 text-amber-300' : 'border-slate-600'}`}
            >{t('measure')}</button>
          </div>
          <label className="mb-3 block text-sm">
            {t('highlight')}
            <select value={highlight ?? ''} onChange={(e) => setHighlight(e.target.value || null)} className="mt-1 w-full rounded bg-surface px-3 py-2">
              <option value="">{t('all')}</option>
              {schematic.materials.map((material: Material) => (
                <option key={material.blockId} value={material.blockId}>{material.displayName}</option>
              ))}
            </select>
          </label>
          <div className="h-[26rem] overflow-hidden rounded bg-slate-900">
            {parseError ? (
              <p className="p-4 text-sm text-red-400">{parseError}</p>
            ) : (
              <SchematicViewer
                blocks={blocks}
                version={version}
                layerY={layerY}
                highlight={highlight}
                showGrid={showGrid}
                showRuler={showRuler}
                layerMode={layerMode}
                measureMode={measureMode}
                token={getAccessToken()}
                onProgress={setRenderStage}
                onReady={onReady}
              />
            )}
          </div>
          {(stage || parsed || renderStage) && (
            <p className="mt-2 text-xs text-slate-500">
              {stage ? t(stage) : renderStage ? t(renderStage) : `${blocks.length} ${t('blocks')}`}
            </p>
          )}
        </section>

        <div className="space-y-6">
          {schematic.youtubeVideoId && (
            <section className="rounded-xl border border-slate-700 bg-panel p-5">
              <h2 className="mb-3 text-lg font-semibold">{t('tutorial')}</h2>
              <div className="aspect-video">
                <iframe
                  className="h-full w-full rounded"
                  src={`https://www.youtube-nocookie.com/embed/${schematic.youtubeVideoId}`}
                  title={t('tutorial')}
                  allowFullScreen
                />
              </div>
              {schematic.youtubeUrl && <a href={schematic.youtubeUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-accent hover:underline">YouTube ↗</a>}
            </section>
          )}

          <section className="rounded-xl border border-slate-700 bg-panel p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{t('materials')}</h2>
              <span className="text-sm text-slate-400">{checkedCount}/{rows.length} {t('materialProgress')}</span>
            </div>
            <div className="mb-2 h-2 overflow-hidden rounded bg-slate-700">
              <div className="h-full bg-accent transition-all" style={{ width: rows.length ? `${(checkedCount / rows.length) * 100}%` : '0%' }} />
            </div>
            <input value={materialQuery} onChange={(e) => setMaterialQuery(e.target.value)} placeholder={t('filterMaterials')} className="mb-3 w-full rounded bg-surface px-3 py-2 text-sm" />
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500">{t('noMaterials')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-400">
                  <tr><th className="py-1">{t('materials')}</th><th className="py-1 text-right">{t('blocks')}</th><th className="py-1 text-right">{t('stacks')}</th><th className="py-1 text-right">{t('shulkers')}</th></tr>
                </thead>
                <tbody>
                  {rows.map((material) => (
                    <tr
                      key={material.blockId}
                      className={`border-t border-slate-700 ${highlight === material.blockId ? 'bg-sky-900/40' : ''}`}
                      onMouseEnter={() => setHighlight(material.blockId)}
                      onMouseLeave={() => setHighlight(null)}
                    >
                      <td className="py-2">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={checked.has(material.blockId)} onChange={() => void toggleMaterial(material.blockId)} />
                          <button type="button" onClick={() => setHighlight((current) => current === material.blockId ? null : material.blockId)} className="text-left hover:text-accent">{material.displayName}</button>
                        </label>
                      </td>
                      <td className="py-2 text-right">{material.count}</td>
                      <td className="py-2 text-right">{material.stacks}</td>
                      <td className="py-2 text-right">{material.shulkers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <button onClick={exportCsv} className="rounded border border-slate-600 px-2 py-1">{t('exportCsv')}</button>
              <button onClick={exportText} className="rounded border border-slate-600 px-2 py-1">{t('exportText')}</button>
              <button onClick={() => void resetChecked()} className="rounded border border-slate-600 px-2 py-1">{t('resetChecked')}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
