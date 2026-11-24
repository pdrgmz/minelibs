import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AdminSchematic, Page, User } from '../types';

export function AdminPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<Page<User> | null>(null);
  const [schematics, setSchematics] = useState<Page<AdminSchematic> | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'USER' | 'ADMIN'>('USER');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyNotice, setBusyNotice] = useState('');

  const load = useCallback(() => {
    void Promise.all([api.admin.users(), api.admin.schematics()])
      .then(([userPage, schematicPage]) => {
        setUsers(userPage);
        setSchematics(schematicPage);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t('error')));
  }, [t]);

  useEffect(load, [load]);

  const onCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await api.admin.createUser(username, password, role);
      setUsername('');
      setPassword('');
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'));
    }
  };

  const changeRole = async (user: User) => {
    const next = user.role === 'ADMIN' ? 'USER' : 'ADMIN';
    await api.admin.updateUser(user.id, { role: next });
    load();
  };

  const resetPassword = async (user: User) => {
    const value = window.prompt(`${t('resetPassword')} — ${user.username}`);
    if (!value || value.length < 10) return;
    await api.admin.updateUser(user.id, { password: value });
    setNotice(t('saved'));
  };

  const deleteUser = async (user: User) => {
    if (!window.confirm(t('confirmDeleteUser'))) return;
    try {
      await api.admin.deleteUser(user.id);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'));
    }
  };

  const reparse = async () => {
    setBusyNotice(t('loading'));
    try {
      const result = await api.schematics.reparse();
      setNotice(`${t('reparsed')}: ${result.updated}/${result.total} (${result.failed} ${t('errors')})`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'));
    } finally {
      setBusyNotice('');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('admin')}</h1>
      {error && <p className="text-red-400">{error}</p>}
      {notice && <p className="text-accent">{notice}</p>}
      {busyNotice && <p className="text-slate-400">{busyNotice}</p>}

      <section className="rounded-xl border border-slate-700 bg-panel p-5">
        <h2 className="mb-3 text-lg font-semibold">{t('users')} ({users?.total ?? 0})</h2>
        <ul className="mb-4 space-y-1 text-sm">
          {users?.items.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 py-2">
              <span>{user.username}</span>
              <span className="flex flex-wrap gap-2">
                <button onClick={() => void changeRole(user)} className="rounded border border-slate-600 px-2 py-1 text-xs">{t('changeRole')}: {user.role}</button>
                <button onClick={() => void resetPassword(user)} className="rounded border border-slate-600 px-2 py-1 text-xs">{t('resetPassword')}</button>
                <button onClick={() => void deleteUser(user)} className="rounded border border-red-800 px-2 py-1 text-xs text-red-400">{t('deleteUser')}</button>
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={(event) => void onCreateUser(event)} className="flex flex-wrap gap-2">
          <input required placeholder={t('username')} value={username} onChange={(event) => setUsername(event.target.value)} className="rounded border border-slate-600 bg-surface px-3 py-2" />
          <input required type="password" minLength={10} placeholder={t('password')} value={password} onChange={(event) => setPassword(event.target.value)} className="rounded border border-slate-600 bg-surface px-3 py-2" />
          <select value={role} onChange={(event) => setRole(event.target.value as 'USER' | 'ADMIN')} className="rounded border border-slate-600 bg-surface px-3 py-2">
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <button className="rounded bg-accent px-3 py-2">{t('createUser')}</button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-700 bg-panel p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('library')} ({schematics?.total ?? 0})</h2>
          <button onClick={() => void reparse()} className="rounded border border-slate-600 px-3 py-1 text-sm">{t('reparse')}</button>
        </div>
        <ul className="space-y-1 text-sm">
          {schematics?.items.map((schematic) => (
            <li key={schematic.id} className="flex justify-between gap-2 border-b border-slate-700 py-1">
              <Link to={`/schematic/${schematic.id}`} className="truncate hover:text-accent">{schematic.name}</Link>
              <span className="shrink-0 text-slate-400">
                {schematic.format} · {schematic.userId.slice(0, 8)} · {schematic.widthX}×{schematic.heightY}×{schematic.lengthZ}
                <Link to={`/schematic/${schematic.id}`} className="ml-2 text-accent hover:underline">{t('edit')} ↗</Link>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
