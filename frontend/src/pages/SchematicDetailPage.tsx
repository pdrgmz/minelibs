import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, downloadBlob, getAccessToken } from '../api/client';
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorBanner,
  Field,
  Icon,
  IconButton,
  Metric,
  Modal,
  NoticeBanner,
  PageHeader,
  SectionHeading,
  SegmentedProgress,
  Tabs,
  inputClass,
  type IconName,
  type TabItem,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useSchematicParse } from '../hooks/useSchematicParse';
import type { Collection, Material, SchematicDetail } from '../types';
import {
  filterMaterials,
  materialsForLayer,
  materialsToCsv,
  materialsToText,
  presentMaterials,
} from '../utils/materials';
import { SchematicViewer, type CaptureFn, type ViewerTheme } from '../viewer';

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
  const [pinnedHighlight, setPinnedHighlight] = useState<string | null>(null);
  const [hoverHighlight, setHoverHighlight] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [showRuler, setShowRuler] = useState(false);
  const [layerMode, setLayerMode] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [isolateLayer, setIsolateLayer] = useState(false);
  const [contextPreset, setContextPreset] = useState<'off' | 'low' | 'high'>('low');
  const [theme, setTheme] = useState<ViewerTheme>(() => {
    try {
      return localStorage.getItem('minelibs:viewer-bg') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [autoplay, setAutoplay] = useState(false);
  const [autoSpeed, setAutoSpeed] = useState(900);
  const [helpOpen, setHelpOpen] = useState(false);
  const [renderStage, setRenderStage] = useState('');
  const [viewerReady, setViewerReady] = useState(0);
  const [materialQuery, setMaterialQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [draft, setDraft] = useState({ name: '', description: '', minecraftVersion: '', tags: '', collectionId: '' });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [inspectorTab, setInspectorTab] = useState('materials');
  const captureRef = useRef<CaptureFn | null>(null);
  const thumbnailDone = useRef<string | null>(null);

  const highlight = pinnedHighlight ?? hoverHighlight;
  const maxLayerY = Math.max(0, (schematic?.dimensions.heightY ?? 1) - 1);
  const contextOpacity = contextPreset === 'off'
    ? 0
    : contextPreset === 'high'
      ? theme === 'dark' ? 0.45 : 0.5
      : theme === 'dark' ? 0.28 : 0.35;

  useEffect(() => {
    try {
      localStorage.setItem('minelibs:viewer-bg', theme);
    } catch {
      // Almacenamiento opcional: el visor sigue funcionando sin persistencia.
    }
  }, [theme]);

  useEffect(() => {
    setPinnedHighlight(null);
    setHoverHighlight(null);
    setLayerY(null);
    setMeasureMode(false);
    setAutoplay(false);
  }, [id]);

  useEffect(() => {
    void api.schematics.get(id, asAdmin).then((detail) => {
      setSchematic(detail);
      setDraft({
        name: detail.name,
        description: detail.description ?? '',
        minecraftVersion: detail.minecraftVersion ?? '',
        tags: detail.tags.join(', '),
        collectionId: detail.collectionId ?? '',
      });
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t('error')));
  }, [id, t, asAdmin]);

  useEffect(() => {
    void api.collections.list().then(setCollections).catch(() => undefined);
  }, []);

  const fileUrl = schematic ? `${schematic.fileUrl}${asAdmin ? '?asAdmin=true' : ''}` : null;
  const { parsed, stage, error: parseError } = useSchematicParse(fileUrl, getAccessToken());

  const blocks = useMemo(() => parsed?.blocks ?? [], [parsed]);
  const allMaterials = useMemo(
    () => (layerY === null ? schematic?.materials ?? [] : materialsForLayer(blocks, layerY)),
    [layerY, schematic, blocks],
  );
  const layerMaterialCount = useMemo(
    () => layerY === null ? 0 : materialsForLayer(blocks, layerY).length,
    [blocks, layerY],
  );
  const rows = useMemo(() => filterMaterials(presentMaterials(allMaterials), materialQuery), [allMaterials, materialQuery]);
  const checked = new Set(schematic?.checkedMaterials ?? []);
  const checkedCount = rows.filter((row) => checked.has(row.blockId)).length;

  // Captura la miniatura isométrica sólo cuando el motor ya dibuja los bloques del schematic.
  const captureThumbnail = useCallback(async (targetId: string, isActive: () => boolean = () => true): Promise<boolean> => {
    for (let attempt = 0; attempt < 6 && isActive(); attempt += 1) {
      const dataUrl = captureRef.current?.();
      // Una captura casi vacía es sólo el color de fondo: espera al siguiente frame.
      if (dataUrl && dataUrl.length > 4000) {
        try {
          const blob = await (await fetch(dataUrl)).blob();
          const updated = await api.schematics.uploadThumbnail(targetId, blob);
          thumbnailDone.current = targetId;
          setSchematic(updated);
          return true;
        } catch {
          return false;
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }
    return false;
  }, []);

  useEffect(() => {
    if (!schematic || !parsed || !blocks.length || viewerReady === 0 || schematic.userId !== user?.id || thumbnailDone.current === schematic.id) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void captureThumbnail(schematic.id, () => active).then((ok) => {
        if (!ok && active) setNotice(t('thumbnailFailed'));
      });
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [schematic, parsed, blocks.length, viewerReady, user, t, captureThumbnail]);

  const regenerateThumbnail = async (): Promise<void> => {
    if (!schematic) return;
    setNotice('');
    const ok = await captureThumbnail(schematic.id);
    setNotice(t(ok ? 'thumbnailReady' : 'thumbnailFailed'));
  };

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
      collectionId: draft.collectionId || null,
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

  const onReady = useCallback((capture: CaptureFn) => {
    captureRef.current = capture;
    setViewerReady((value) => value + 1);
  }, []);
  const toggleTheme = useCallback(() => setTheme((value) => value === 'dark' ? 'light' : 'dark'), []);
  const stepLayer = useCallback((delta: number) => {
    setLayerY((value) => {
      if (value === null) return delta > 0 ? 0 : null;
      return Math.max(0, Math.min(maxLayerY, value + delta));
    });
  }, [maxLayerY]);

  useEffect(() => {
    if (!autoplay || layerY === null) return;
    let timer = 0;
    const advance = (): void => {
      setLayerY((value) => (value === null ? 0 : value >= maxLayerY ? 0 : value + 1));
      timer = window.setTimeout(advance, autoSpeed);
    };
    timer = window.setTimeout(advance, autoSpeed);
    const onVisibility = (): void => {
      window.clearTimeout(timer);
      if (!document.hidden) timer = window.setTimeout(advance, autoSpeed);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [autoplay, autoSpeed, layerY === null, maxLayerY]);

  // Atajos del modo capa y del resaltado (AGENTS.md §4.5 / docs/04 Fase 3).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement && target.matches('input, textarea, select, button, canvas')) return;
      if (event.key === 'Escape') {
        setPinnedHighlight(null);
        setHoverHighlight(null);
        setMeasureMode(false);
        setAutoplay(false);
        return;
      }
      if (layerY === null) return;
      if (event.key === 'PageDown') {
        event.preventDefault();
        stepLayer(1);
      } else if (event.key === 'PageUp') {
        event.preventDefault();
        stepLayer(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layerY, stepLayer]);

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!schematic) return <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{t('loading')}</p>;

  const isOwner = schematic.userId === user?.id;
  const version = schematic.minecraftVersion ?? '1.21.4';
  const toggleClass = (active: boolean) =>
    `inline-flex h-8 cursor-pointer items-center gap-2 rounded-control border px-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors ${active ? 'border-ink bg-accent text-ink' : 'border-ink bg-canvas text-muted hover:text-ink'}`;

  const inspectorTabs: TabItem[] = [
    { id: 'materials', label: t('materials'), icon: 'box', badge: <Badge tone="accent">{rows.length}</Badge> },
    { id: 'details', label: t('details'), icon: 'info' },
  ];
  if (schematic.youtubeVideoId) inspectorTabs.push({ id: 'tutorial', label: t('tutorial'), icon: 'external' });

  return (
    <div className="space-y-6">
      <PageHeader
        title={schematic.name}
        description={schematic.description || undefined}
        back={<Link to="/" className="inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted hover:text-ink"><Icon name="chevronLeft" size={14} />{t('library')}</Link>}
      />

      <NoticeBanner>{notice}</NoticeBanner>

      {editing && (
        <Card>
          <SectionHeading title={t('edit')} />
          <form onSubmit={(event) => void save(event)} className="grid gap-4 sm:grid-cols-2">
            <Field label={t('name')}><input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} /></Field>
            <Field label={t('minecraftVersion')}><input value={draft.minecraftVersion} onChange={(e) => setDraft({ ...draft, minecraftVersion: e.target.value })} className={inputClass} /></Field>
            {isOwner && (
              <Field label={t('collections')} className="sm:col-span-2">
                <select value={draft.collectionId} onChange={(e) => setDraft({ ...draft, collectionId: e.target.value })} className={inputClass}>
                  <option value="">{t('noCollection')}</option>
                  {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
                </select>
              </Field>
            )}
            <Field label={t('description')} className="sm:col-span-2"><textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={inputClass} /></Field>
            <Field label={t('tags')} className="sm:col-span-2"><input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} className={inputClass} /></Field>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" variant="primary" icon="check">{t('save')}</Button>
              <Button icon="close" onClick={() => setEditing(false)}>{t('cancel')}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="w-full min-w-0 p-4">
        <SectionHeading title={t('viewer3d')} action={<Badge tone="ink">{t('layers')}</Badge>} />
        <div className={`h-[34rem] w-full overflow-hidden rounded-control border-2 border-ink lg:h-[44rem] ${theme === 'dark' ? 'bg-terminal' : 'bg-canvas'}`}>
          {parseError ? (
            <div className="p-4"><ErrorBanner>{parseError}</ErrorBanner></div>
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
              theme={theme}
              contextOpacity={contextOpacity}
              isolateLayer={isolateLayer}
              token={getAccessToken()}
              onThemeChange={toggleTheme}
              onHelp={() => setHelpOpen(true)}
              onLayerStep={stepLayer}
              onProgress={setRenderStage}
              onReady={onReady}
            />
          )}
        </div>
        {(stage || parsed || renderStage) && (
          <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
            {stage ? t(stage) : renderStage ? t(renderStage) : `${blocks.length} ${t('blocks')}`}
          </p>
        )}
      </Card>

      <Card className="w-full min-w-0 p-4">
        <SectionHeading title={t('viewerControls')} action={<Badge tone="ink">{t('viewer3d')}</Badge>} />
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 border-b border-dashed border-dash pb-3">
              <label className={toggleClass(layerY !== null)}>
                <input type="checkbox" checked={layerY !== null} onChange={(e) => setLayerY(e.target.checked ? Math.floor(schematic.dimensions.heightY / 2) : null)} className="sr-only" />
                <Icon name="layers" size={13} />
                {t('layer')}
              </label>
              <label className={toggleClass(layerMode && layerY !== null)}>
                <input type="checkbox" disabled={layerY === null} checked={layerMode} onChange={(e) => setLayerMode(e.target.checked)} className="sr-only" />
                <Icon name="grid" size={13} />
                {t('layerMode')}
              </label>
              <label className={toggleClass(showGrid)}>
                <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} className="sr-only" />
                <Icon name="grid" size={13} />
                {t('showGrid')}
              </label>
              <label className={toggleClass(showRuler)}>
                <input type="checkbox" checked={showRuler} onChange={(e) => setShowRuler(e.target.checked)} className="sr-only" />
                <Icon name="ruler" size={13} />
                {t('showRuler')}
              </label>
              <Button size="sm" variant={measureMode ? 'primary' : 'secondary'} icon="ruler" disabled={layerY === null} onClick={() => setMeasureMode((value) => !value)}>{t('measure')}</Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-control border border-ink bg-canvas p-3">
              <span className="label text-muted">{t('layers')}</span>
              <IconButton label={t('previousLayer')} icon="chevronLeft" variant="secondary" size="sm" disabled={layerY === null || layerY === 0} onClick={() => stepLayer(-1)} />
              <input
                type="range"
                min={0}
                max={maxLayerY}
                value={layerY ?? 0}
                disabled={layerY === null}
                onChange={(e) => setLayerY(Number(e.target.value))}
                className="h-2 min-w-[120px] flex-1 accent-accent disabled:opacity-40"
                aria-label={t('layer')}
              />
              <IconButton label={t('nextLayer')} icon="chevronRight" variant="secondary" size="sm" disabled={layerY === null || layerY >= maxLayerY} onClick={() => stepLayer(1)} />
              <span className="tabular font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink">
                {layerY === null ? t('allLayers') : `Y ${layerY} / ${maxLayerY}`}
              </span>
              <Button size="sm" variant={autoplay ? 'primary' : 'secondary'} icon={autoplay ? 'pause' : 'play'} disabled={layerY === null} onClick={() => setAutoplay((value) => !value)}>
                {autoplay ? t('stopAutoplay') : t('autoplay')}
              </Button>
              <label className="flex items-center gap-1">
                <span className="label text-muted">{t('autoSpeed')}</span>
                <select
                  value={autoSpeed}
                  onChange={(e) => setAutoSpeed(Number(e.target.value))}
                  className="h-8 rounded-control border border-ink bg-paper px-2 font-mono text-[10px] font-bold text-ink"
                  aria-label={t('autoSpeed')}
                >
                  <option value={1400}>0.7×</option>
                  <option value={900}>1×</option>
                  <option value={450}>2×</option>
                </select>
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-control border border-dashed border-dash bg-canvas p-2">
              <span className="label text-muted">{t('context')}</span>
              {(['off', 'low', 'high'] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={contextPreset === preset}
                  onClick={() => setContextPreset(preset)}
                  className={`h-7 rounded-control border border-ink px-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] ${contextPreset === preset ? 'bg-accent text-ink' : 'bg-canvas text-muted hover:text-ink'}`}
                >
                  {preset === 'off' ? t('contextOff') : preset === 'low' ? t('contextLow') : t('contextHigh')}
                </button>
              ))}
              <label className={toggleClass(isolateLayer)}>
                <input type="checkbox" checked={isolateLayer} onChange={(e) => setIsolateLayer(e.target.checked)} className="sr-only" />
                <Icon name="layers" size={13} />
                {t('isolate')}
              </label>
              {layerY !== null && (
                <span className="tabular font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                  {t('layerMaterials')}: {layerMaterialCount}
                </span>
              )}
            </div>

            <Field label={t('highlight')} hint={pinnedHighlight ? t('helpHighlight') : undefined}>
              <select value={pinnedHighlight ?? ''} onChange={(e) => setPinnedHighlight(e.target.value || null)} className={inputClass}>
                <option value="">{t('all')}</option>
                {schematic.materials.map((material: Material) => (
                  <option key={material.blockId} value={material.blockId}>{material.displayName}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="min-w-0 p-4">
          <SectionHeading title={t('details')} action={<Badge tone="ink">{t('blocks')}</Badge>} />
          <div className="grid grid-cols-2 gap-3">
            <Metric label={t('dimensions')} value={`${schematic.dimensions.widthX}×${schematic.dimensions.heightY}×${schematic.dimensions.lengthZ}`} tone="accent" />
            <Metric label={t('blocks')} value={schematic.totalBlocks.toLocaleString()} />
            <Metric label={t('minecraftVersion')} value={schematic.minecraftVersion ?? '—'} />
            <Metric label={t('file')} value={<span className="block truncate text-sm">{schematic.originalFilename}</span>} hint={schematic.format} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-dashed border-dash pt-3">
            <Button size="sm" icon="download" onClick={() => void api.schematics.download(id, schematic.originalFilename, asAdmin)}>{t('download')}</Button>
            {isOwner && <Button size="sm" icon="refresh" onClick={() => void regenerateThumbnail()}>{t('captureThumbnail')}</Button>}
            <Button size="sm" icon="edit" onClick={() => setEditing((value) => !value)}>{t('edit')}</Button>
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-control border border-ink bg-canvas px-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink hover:bg-surface">
              <Icon name="upload" size={13} />
              {t('replaceFile')}
              <input type="file" accept=".litematic,.schem,.nbt" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void replaceFile(file);
              }} />
            </label>
            <Button size="sm" variant="danger" icon="trash" onClick={openDelete}>{t('delete')}</Button>
          </div>
        </Card>

        <Card className="min-w-0 p-4">
          <Tabs
            className="mb-4"
            value={inspectorTab}
            onChange={setInspectorTab}
            items={inspectorTabs}
          />

          {inspectorTab === 'materials' && (
            <div className="space-y-4">
              <div className="rounded-control border border-ink bg-canvas p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="label text-muted">{t('materialProgress')}</span>
                  <span className="tabular font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink">{checkedCount}/{rows.length}</span>
                </div>
                <SegmentedProgress value={checkedCount} max={rows.length} label={t('materialProgress')} />
              </div>
              <input value={materialQuery} onChange={(e) => setMaterialQuery(e.target.value)} placeholder={t('filterMaterials')} aria-label={t('filterMaterials')} className={inputClass} />
              {rows.length === 0 ? (
                <EmptyState icon="box" title={t('noMaterials')} />
              ) : (
                <div className="overflow-hidden rounded-control border border-ink">
                  <table className="w-full text-left">
                    <thead className="bg-terminal font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-paper">
                      <tr><th className="px-2 py-2">{t('materials')}</th><th className="px-2 py-2 text-right">{t('blocks')}</th><th className="px-2 py-2 text-right">{t('stacks')}</th><th className="px-2 py-2 text-right">{t('shulkers')}</th></tr>
                    </thead>
                    <tbody className="divide-y divide-dash">
                      {rows.map((material) => (
                        <tr
                          key={material.blockId}
                          className={`transition-colors ${highlight === material.blockId ? 'bg-accent/20' : 'hover:bg-canvas'}`}
                          onMouseEnter={() => setHoverHighlight(material.blockId)}
                          onMouseLeave={() => setHoverHighlight(null)}
                          onFocus={() => setHoverHighlight(material.blockId)}
                          onBlur={() => setHoverHighlight(null)}
                        >
                          <td className="px-2 py-2">
                            <label className="flex cursor-pointer items-center gap-2">
                              <input type="checkbox" checked={checked.has(material.blockId)} onChange={() => void toggleMaterial(material.blockId)} className="accent-accent" />
                              <button type="button" onClick={() => setPinnedHighlight((current) => current === material.blockId ? null : material.blockId)} aria-pressed={pinnedHighlight === material.blockId} className="text-left font-mono text-[11px] font-bold text-ink hover:underline decoration-accent decoration-2 underline-offset-2">{material.displayName}</button>
                            </label>
                          </td>
                          <td className="tabular px-2 py-2 text-right font-mono text-[11px] font-bold text-ink">{material.count}</td>
                          <td className="tabular px-2 py-2 text-right font-mono text-[11px] font-bold text-muted">{material.stacks}</td>
                          <td className="tabular px-2 py-2 text-right font-mono text-[11px] font-bold text-muted">{material.shulkers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap gap-2 border-t border-dashed border-dash pt-4">
                <Button size="sm" icon="download" onClick={exportCsv}>{t('exportCsv')}</Button>
                <Button size="sm" icon="download" onClick={exportText}>{t('exportText')}</Button>
                <Button size="sm" icon="refresh" onClick={() => void resetChecked()}>{t('resetChecked')}</Button>
              </div>
            </div>
          )}

          {inspectorTab === 'details' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Metric label={t('dimensions')} value={`${schematic.dimensions.widthX}×${schematic.dimensions.heightY}×${schematic.dimensions.lengthZ}`} />
                <Metric label={t('blocks')} value={schematic.totalBlocks.toLocaleString()} tone="accent" />
              </div>
              <dl className="divide-y divide-dash rounded-control border border-ink bg-canvas">
                {[
                  [t('name'), schematic.name],
                  [t('minecraftVersion'), schematic.minecraftVersion ?? '—'],
                  [t('file'), schematic.originalFilename],
                  [t('tags'), schematic.tags.join(', ') || '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
                    <dt className="label text-muted">{label}</dt>
                    <dd className="min-w-0 break-all font-mono text-[11px] font-bold text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
              {schematic.description && <p className="border-l-4 border-l-lavender bg-canvas p-3 font-sans text-sm text-muted">{schematic.description}</p>}
            </div>
          )}

          {inspectorTab === 'tutorial' && (
            <div>
              {schematic.youtubeVideoId ? (
                <>
                  <a href={schematic.youtubeUrl ?? '#'} target="_blank" rel="noreferrer" className="mb-3 inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink underline decoration-accent decoration-2 underline-offset-4">
                    YouTube <Icon name="external" size={12} />
                  </a>
                  <div className="aspect-video overflow-hidden rounded-control border-2 border-ink bg-terminal">
                    <iframe
                      className="h-full w-full"
                      src={`https://www.youtube-nocookie.com/embed/${schematic.youtubeVideoId}`}
                      title={t('tutorial')}
                      allowFullScreen
                    />
                  </div>
                </>
              ) : (
                <EmptyState icon="external" title={t('tutorial')} description={t('librarySubtitle')} />
              )}
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={helpOpen}
        title={t('helpTitle')}
        description={t('helpIntro')}
        icon="help"
        closeLabel={t('close')}
        onClose={() => setHelpOpen(false)}
      >
        <dl className="divide-y divide-dash rounded-control border border-ink bg-canvas">
          {([
            [t('helpOrbit'), 'grid'],
            [t('helpPan'), 'fit'],
            [t('helpLayers'), 'layers'],
            [t('helpHighlight'), 'target'],
            [t('helpMeasure'), 'ruler'],
            [t('helpTheme'), 'sun'],
          ] as Array<[string, IconName]>).map(([text, icon]) => (
            <div key={text} className="flex items-start gap-3 px-3 py-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-ink bg-accent/20 text-ink"><Icon name={icon} size={15} /></span>
              <dd className="font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-ink">{text}</dd>
            </div>
          ))}
        </dl>
      </Modal>

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
