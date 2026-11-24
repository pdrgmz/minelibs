import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, downloadBlob, ApiError } from '../api/client';
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
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{t('importExport')}</h1>
      <p className="rounded-lg bg-panel p-4 text-sm text-slate-300">{t('backupHint')}</p>

      <section className="grid gap-3 rounded-xl border border-slate-700 bg-panel p-5 sm:grid-cols-2">
        <button disabled={busy} onClick={() => void exportMine()} className="rounded bg-accent px-4 py-3 font-semibold disabled:opacity-50">
          {t('exportBackup')}
        </button>
        <label className="cursor-pointer rounded border border-slate-600 px-4 py-3 text-center font-semibold">
          {t('chooseZip')}
          <input type="file" accept=".zip,application/zip" className="hidden" onChange={(event) => void onFile(event)} />
        </label>
        {user?.role === 'ADMIN' && (
          <button disabled={busy} onClick={() => void exportAll()} className="rounded border border-slate-600 px-4 py-3 sm:col-span-2">
            {t('adminExport')}
          </button>
        )}
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <section className="rounded-xl border border-slate-700 bg-panel p-5">
          <h2 className="mb-3 text-lg font-semibold">{t('importResult')}</h2>
          <p className="text-sm">
            {t('imported')}: <strong>{result.imported}</strong> · {t('skipped')}: <strong>{result.skipped}</strong>
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-3 max-h-48 list-disc overflow-auto pl-5 text-sm text-amber-300">
              {result.errors.map((message, index) => <li key={index}>{message}</li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
