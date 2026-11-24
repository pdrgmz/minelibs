import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, downloadBlob, getAccessToken } from '../api/client';
import { Button, Card, ConfirmModal, ErrorBanner, Field, Icon, IconButton, NoticeBanner, PageHeader, SectionHeading, inputClass } from '../components/ui';
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
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

  const openDelete = () => {
    setDeleteError('');
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await api.schematics.remove(id);
      navigate('/');
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : t('error'));
    } finally {
      setDeleteBusy(false);
    }
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

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!schematic) return <p className="text-slate-400">{t('loading')}</p>;

  const version = schematic.minecraftVersion ?? '1.21.4';
  const toggleClass = (active: boolean) =>
    `inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${active ? 'border-accent/50 bg-accent/15 text-accent' : 'border-slate-700 bg-surface text-slate-300 hover:border-slate-600 hover:text-white'}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={schematic.name}
        description={schematic.description || undefined}
        back={<Link to="/" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"><Icon name="chevronLeft" size={14} />{t('library')}</Link>}
        actions={
          <>
            <Button icon="download" onClick={() => void api.schematics.download(id, schematic.originalFilename, asAdmin)}>{t('download')}</Button>
            <Button icon="edit" onClick={() => setEditing((value) => !value)}>{t('edit')}</Button>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3.5 text-sm font-medium text-slate-100 transition-colors hover:border-slate-600 hover:bg-slate-800">
              <Icon name="upload" size={16} />
              {t('replaceFile')}
              <input type="file" accept=".litematic,.schem,.nbt" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void replaceFile(file);
              }} />
            </label>
            <Button variant="danger" icon="trash" onClick={openDelete}>{t('delete')}</Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
        <span className="tabular inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-panel px-2.5 py-1"><Icon name="box" size={13} />{schematic.dimensions.widthX} × {schematic.dimensions.heightY} × {schematic.dimensions.lengthZ}</span>
        <span className="tabular inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-panel px-2.5 py-1">{schematic.totalBlocks} {t('blocks')}</span>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-panel px-2.5 py-1">{schematic.minecraftVersion ?? '—'}</span>
        <span className="truncate rounded-lg border border-slate-800 bg-panel px-2.5 py-1">{schematic.originalFilename}</span>
      </div>
      <NoticeBanner>{notice}</NoticeBanner>

      {editing && (
        <Card>
          <SectionHeading title={t('edit')} />
          <form onSubmit={(event) => void save(event)} className="grid gap-4 sm:grid-cols-2">
            <Field label={t('name')}><input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} /></Field>
            <Field label={t('minecraftVersion')}><input value={draft.minecraftVersion} onChange={(e) => setDraft({ ...draft, minecraftVersion: e.target.value })} className={inputClass} /></Field>
            <Field label={t('description')} className="sm:col-span-2"><textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={inputClass} /></Field>
            <Field label={t('tags')} className="sm:col-span-2"><input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} className={inputClass} /></Field>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" variant="primary" icon="check">{t('save')}</Button>
              <Button icon="close" onClick={() => setEditing(false)}>{t('cancel')}</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <SectionHeading title={t('viewer3d')} />
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <label className={toggleClass(layerY !== null)}>
              <input type="checkbox" checked={layerY !== null} onChange={(e) => setLayerY(e.target.checked ? Math.floor(schematic.dimensions.heightY / 2) : null)} className="sr-only" />
              <Icon name="layers" size={14} />
              {t('layer')}
            </label>
            {layerY !== null && (
              <>
                <IconButton label={t('previousLayer')} icon="chevronLeft" variant="secondary" size="sm" disabled={layerY === 0} onClick={() => setLayerY(layerY - 1)} />
                <input type="range" min={0} max={Math.max(0, schematic.dimensions.heightY - 1)} value={layerY} onChange={(e) => setLayerY(Number(e.target.value))} className="w-28 accent-accent sm:w-36" aria-label={t('layer')} />
                <IconButton label={t('nextLayer')} icon="chevronRight" variant="secondary" size="sm" disabled={layerY >= schematic.dimensions.heightY - 1} onClick={() => setLayerY(layerY + 1)} />
                <span className="tabular text-slate-400">Y = {layerY} / {Math.max(0, schematic.dimensions.heightY - 1)}</span>
              </>
            )}
            {layerY === null && <span className="text-slate-400">{t('allLayers')}</span>}
            <label className={toggleClass(layerMode && layerY !== null)}>
              <input type="checkbox" disabled={layerY === null} checked={layerMode} onChange={(e) => setLayerMode(e.target.checked)} className="sr-only" />
              <Icon name="grid" size={14} />
              {t('layerMode')}
            </label>
            <label className={toggleClass(showGrid)}>
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} className="sr-only" />
              <Icon name="grid" size={14} />
              {t('showGrid')}
            </label>
            <label className={toggleClass(showRuler)}>
              <input type="checkbox" checked={showRuler} onChange={(e) => setShowRuler(e.target.checked)} className="sr-only" />
              <Icon name="ruler" size={14} />
              {t('showRuler')}
            </label>
            <Button size="sm" icon="ruler" variant={measureMode ? 'primary' : 'secondary'} disabled={layerY === null} onClick={() => setMeasureMode((value) => !value)}>{t('measure')}</Button>
          </div>
          <Field label={t('highlight')} className="mb-4">
            <select value={highlight ?? ''} onChange={(e) => setHighlight(e.target.value || null)} className={inputClass}>
              <option value="">{t('all')}</option>
              {schematic.materials.map((material: Material) => (
                <option key={material.blockId} value={material.blockId}>{material.displayName}</option>
              ))}
            </select>
          </Field>
          <div className="h-[26rem] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            {parseError ? (
              <ErrorBanner>{parseError}</ErrorBanner>
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
        </Card>

        <div className="min-w-0 space-y-6">
          {schematic.youtubeVideoId && (
            <Card>
              <SectionHeading title={t('tutorial')} action={<a href={schematic.youtubeUrl ?? '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">YouTube<Icon name="external" size={13} /></a>} />
              <div className="aspect-video overflow-hidden rounded-lg">
                <iframe
                  className="h-full w-full"
                  src={`https://www.youtube-nocookie.com/embed/${schematic.youtubeVideoId}`}
                  title={t('tutorial')}
                  allowFullScreen
                />
              </div>
            </Card>
          )}

          <Card>
            <SectionHeading
              title={t('materials')}
              action={<span className="tabular text-sm text-slate-400">{checkedCount}/{rows.length} {t('materialProgress')}</span>}
            />
            <div className="mb-4 h-2 overflow-hidden rounded-lg bg-slate-700" role="progressbar" aria-valuenow={checkedCount} aria-valuemin={0} aria-valuemax={rows.length}>
              <div className="h-full bg-accent transition-[width] duration-200" style={{ width: rows.length ? `${(checkedCount / rows.length) * 100}%` : '0%' }} />
            </div>
            <input value={materialQuery} onChange={(e) => setMaterialQuery(e.target.value)} placeholder={t('filterMaterials')} aria-label={t('filterMaterials')} className={`${inputClass} mb-3`} />
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500">{t('noMaterials')}</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface/70 text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="px-3 py-2 font-medium">{t('materials')}</th><th className="px-3 py-2 text-right font-medium">{t('blocks')}</th><th className="px-3 py-2 text-right font-medium">{t('stacks')}</th><th className="px-3 py-2 text-right font-medium">{t('shulkers')}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {rows.map((material) => (
                      <tr
                        key={material.blockId}
                        className={`transition-colors ${highlight === material.blockId ? 'bg-accent/10' : 'hover:bg-slate-800/40'}`}
                        onMouseEnter={() => setHighlight(material.blockId)}
                        onMouseLeave={() => setHighlight(null)}
                      >
                        <td className="px-3 py-2">
                          <label className="flex cursor-pointer items-center gap-2">
                            <input type="checkbox" checked={checked.has(material.blockId)} onChange={() => void toggleMaterial(material.blockId)} className="accent-accent" />
                            <button type="button" onClick={() => setHighlight((current) => current === material.blockId ? null : material.blockId)} className="text-left text-slate-100 hover:text-accent">{material.displayName}</button>
                          </label>
                        </td>
                        <td className="tabular px-3 py-2 text-right text-slate-200">{material.count}</td>
                        <td className="tabular px-3 py-2 text-right text-slate-200">{material.stacks}</td>
                        <td className="tabular px-3 py-2 text-right text-slate-200">{material.shulkers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" icon="download" onClick={exportCsv}>{t('exportCsv')}</Button>
              <Button size="sm" icon="download" onClick={exportText}>{t('exportText')}</Button>
              <Button size="sm" icon="refresh" onClick={() => void resetChecked()}>{t('resetChecked')}</Button>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmModal
        open={deleteOpen}
        title={t('delete')}
        description={t('confirmDelete')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        loading={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onClose={() => { setDeleteOpen(false); setDeleteError(''); }}
      />
    </div>
  );
}
