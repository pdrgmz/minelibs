import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LanguageSwitcher } from './LanguageSwitcher';

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  const onChangePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await changePassword(currentPassword, newPassword);
      navigate('/login');
    } catch {
      setError(t('error'));
    }
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded px-3 py-2 text-sm ${isActive ? 'bg-accent text-white' : 'text-slate-300 hover:bg-panel'}`;

  return (
    <div className="min-h-screen bg-surface text-slate-100">
      <header className="border-b border-slate-800 bg-panel/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="text-lg font-bold text-accent">
            {t('appName')}
          </Link>
          <nav className="flex flex-1 gap-1">
            <NavLink to="/" end className={linkClass}>
              {t('library')}
            </NavLink>
            <NavLink to="/new" className={linkClass}>
              {t('newSchematic')}
            </NavLink>
            <NavLink to="/import-export" className={linkClass}>
              {t('importExport')}
            </NavLink>
            {user?.role === 'ADMIN' && (
              <NavLink to="/admin" className={linkClass}>
                {t('admin')}
              </NavLink>
            )}
          </nav>
          <LanguageSwitcher />
          <span className="text-sm text-slate-400">{user?.username}</span>
          <button onClick={() => void onLogout()} className="rounded border border-slate-600 px-3 py-1 text-sm hover:bg-slate-700">
            {t('logout')}
          </button>
        </div>
      </header>

      {showPasswordForm && (
        <form onSubmit={(event) => void onChangePassword(event)} className="mx-auto flex max-w-6xl flex-wrap gap-2 px-4 py-3">
          <input type="password" required placeholder={t('currentPassword')} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="rounded bg-panel px-3 py-2" />
          <input type="password" required minLength={10} placeholder={t('newPassword')} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="rounded bg-panel px-3 py-2" />
          <button type="submit" className="rounded bg-accent px-3 py-2">{t('changePassword')}</button>
          <button type="button" onClick={() => setShowPasswordForm(false)} className="rounded border border-slate-600 px-3 py-2">{t('cancel')}</button>
          {error && <span className="text-red-400">{error}</span>}
        </form>
      )}

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-500">
        <button className="underline" onClick={() => setShowPasswordForm((value) => !value)}>{t('changePassword')}</button>
      </footer>
    </div>
  );
}
