import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorBanner, Icon, NoticeBanner, PageHeader, PromptModal, SectionHeading, Tabs, inputClass } from '../components/ui';
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
  const [dialog, setDialog] = useState<{ kind: 'resetPassword' | 'deleteUser'; user: User } | null>(null);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [tab, setTab] = useState<'users' | 'library'>('users');

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

  const closeDialog = () => {
    setDialog(null);
    setPasswordDraft('');
    setDialogError('');
  };

  const openResetPassword = (user: User) => {
    setPasswordDraft('');
    setDialogError('');
    setDialog({ kind: 'resetPassword', user });
  };

  const openDeleteUser = (user: User) => {
    setDialogError('');
    setDialog({ kind: 'deleteUser', user });
  };

  const submitResetPassword = async (value: string) => {
    if (dialog?.kind !== 'resetPassword') return;
    if (value.length < 10) {
      setDialogError(t('minLengthError', { count: 10 }));
      return;
    }
    setDialogBusy(true);
    setDialogError('');
    try {
      await api.admin.updateUser(dialog.user.id, { password: value });
      setNotice(t('saved'));
      closeDialog();
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : t('error'));
    } finally {
      setDialogBusy(false);
    }
  };

  const confirmDeleteUser = async () => {
    if (dialog?.kind !== 'deleteUser') return;
    setDialogBusy(true);
    setDialogError('');
    try {
      await api.admin.deleteUser(dialog.user.id);
      load();
      closeDialog();
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : t('error'));
    } finally {
      setDialogBusy(false);
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
      <PageHeader title={t('admin')} description={t('adminSubtitle')} />
      <ErrorBanner>{error}</ErrorBanner>
      <NoticeBanner>{notice || busyNotice}</NoticeBanner>

      <Tabs
        value={tab}
        onChange={(id) => setTab(id as 'users' | 'library')}
        items={[
          { id: 'users', label: `${t('users')} (${users?.total ?? 0})`, icon: 'user' },
          { id: 'library', label: `${t('library')} (${schematics?.total ?? 0})`, icon: 'box' },
        ]}
      />

      {tab === 'users' && (
        <Card>
          <SectionHeading title={t('users')} />
          <div className="overflow-hidden rounded-control border border-ink">
            <table className="w-full text-left">
              <thead className="bg-terminal font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-paper">
                <tr><th className="px-3 py-2">{t('username')}</th><th className="px-3 py-2">{t('role')}</th><th className="px-3 py-2 text-right">{t('actions')}</th></tr>
              </thead>
              <tbody className="divide-y divide-dash">
                {users?.items.map((user) => (
                  <tr key={user.id} className="hover:bg-canvas">
                    <td className="px-3 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.06em] text-ink">{user.username}</td>
                    <td className="px-3 py-2"><Badge tone={user.role === 'ADMIN' ? 'accent' : 'ink'}>{user.role}</Badge></td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" icon="shield" onClick={() => void changeRole(user)}>{t('changeRole')}</Button>
                        <Button size="sm" icon="key" onClick={() => openResetPassword(user)}>{t('resetPassword')}</Button>
                        <Button size="sm" variant="danger" icon="trash" onClick={() => openDeleteUser(user)}>{t('deleteUser')}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users && users.items.length === 0 && <EmptyState icon="user" title={t('noUsers')} />}
          </div>
          <form onSubmit={(event) => void onCreateUser(event)} className="mt-5 grid gap-3 border-t border-dashed border-dash pt-5 sm:grid-cols-[1fr_1fr_auto_auto]">
            <input required placeholder={t('username')} aria-label={t('username')} value={username} onChange={(event) => setUsername(event.target.value)} className={inputClass} />
            <input required type="password" minLength={10} placeholder={t('password')} aria-label={t('password')} value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} />
            <select aria-label={t('role')} value={role} onChange={(event) => setRole(event.target.value as 'USER' | 'ADMIN')} className={inputClass}>
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <Button type="submit" variant="primary" icon="plus">{t('createUser')}</Button>
          </form>
        </Card>
      )}

      {tab === 'library' && (
        <Card>
          <SectionHeading
            title={t('library')}
            action={<Button icon="refresh" loading={Boolean(busyNotice)} onClick={() => void reparse()}>{t('reparse')}</Button>}
          />
          <div className="overflow-hidden rounded-control border border-ink">
            <ul className="divide-y divide-dash">
              {schematics?.items.map((schematic) => (
                <li key={schematic.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 hover:bg-canvas">
                  <Link to={`/schematic/${schematic.id}`} className="min-w-0 truncate font-mono text-[13px] font-bold uppercase tracking-[0.06em] text-ink hover:underline decoration-accent decoration-2 underline-offset-4">{schematic.name}</Link>
                  <span className="tabular flex flex-wrap items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                    <Badge tone="ink">{schematic.format}</Badge>
                    <span>{schematic.userId.slice(0, 8)}</span>
                    <span>{schematic.widthX}×{schematic.heightY}×{schematic.lengthZ}</span>
                    <Link to={`/schematic/${schematic.id}`} className="inline-flex items-center gap-1 text-ink underline decoration-accent decoration-2 underline-offset-4">{t('edit')}<Icon name="external" size={12} /></Link>
                  </span>
                </li>
              ))}
            </ul>
            {schematics && schematics.items.length === 0 && <EmptyState icon="box" title={t('emptyLibrary')} />}
          </div>
        </Card>
      )}

      <PromptModal
        open={dialog?.kind === 'resetPassword'}
        title={dialog ? `${t('resetPassword')} — ${dialog.user.username}` : t('resetPassword')}
        label={t('newPassword')}
        hint={t('minLengthError', { count: 10 })}
        value={passwordDraft}
        onChange={setPasswordDraft}
        onSubmit={(value) => void submitResetPassword(value)}
        onClose={closeDialog}
        confirmLabel={t('save')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        type="password"
        autoComplete="new-password"
        error={dialogError}
        loading={dialogBusy}
      />

      <ConfirmModal
        open={dialog?.kind === 'deleteUser'}
        title={t('deleteUser')}
        description={t('confirmDeleteUser')}
        confirmLabel={t('deleteUser')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        loading={dialogBusy}
        error={dialogError}
        onConfirm={() => void confirmDeleteUser()}
        onClose={closeDialog}
      />
    </div>
  );
}
