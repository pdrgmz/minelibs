import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, downloadBlob, ApiError } from '../api/client';
import { Button, Card, ErrorBanner, Icon, NoticeBanner, PageHeader } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { ImportResult } from '../types';

export function ImportExportPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const exportMine = async () => {
    setBusy(true);
    setError('');
    try {
      downloadBlob(await api.backup.exportMine(), 'minelibs-backup.zip');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  const exportAll = async () => {
    setBusy(true);
    setError('');
    try {
      downloadBlob(await api.admin.exportAll(), 'minelibs-all.zip');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await api.backup.importZip(file));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('error'));
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t('importExport')} description={t('backupHint')} />
      <ErrorBanner>{error}</ErrorBanner>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon name="download" size={20} /></span>
          <h2 className="font-semibold text-white">{t('exportBackup')}</h2>
          <p className="mt-1 flex-1 text-sm text-slate-400">{t('exportBackupHint')}</p>
          <Button variant="primary" icon="download" loading={busy} onClick={() => void exportMine()} className="mt-4 w-full">{t('exportBackup')}</Button>
        </Card>
        <Card className="flex flex-col">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon name="upload" size={20} /></span>
          <h2 className="font-semibold text-white">{t('chooseZip')}</h2>
          <p className="mt-1 flex-1 text-sm text-slate-400">{t('importHint')}</p>
          <label className="mt-4 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-700 bg-surface px-3 text-sm font-medium text-slate-100 hover:border-slate-600 disabled:opacity-50">
            <Icon name="folder" size={15} />
            {t('chooseZip')}
            <input type="file" accept=".zip,application/zip" className="sr-only" onChange={(event) => void onFile(event)} />
          </label>
        </Card>
      </div>

      {user?.role === 'ADMIN' && (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 text-slate-300"><Icon name="shield" size={20} /></span>
            <div>
              <h2 className="font-semibold text-white">{t('adminExport')}</h2>
              <p className="mt-0.5 text-sm text-slate-400">{t('adminExportHint')}</p>
            </div>
          </div>
          <Button icon="download" loading={busy} onClick={() => void exportAll()}>{t('adminExport')}</Button>
        </Card>
      )}

      {result && (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-white">{t('importResult')}</h2>
          <NoticeBanner>{t('imported')}: <strong>{result.imported}</strong> · {t('skipped')}: <strong>{result.skipped}</strong></NoticeBanner>
          {result.errors.length > 0 && (
            <ul className="mt-3 max-h-48 list-disc space-y-1 overflow-auto pl-5 text-sm text-amber-300">
              {result.errors.map((message, index) => <li key={index}>{message}</li>)}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
