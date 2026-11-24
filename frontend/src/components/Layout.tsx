import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Button, Card, ErrorBanner, Field, Icon, IconButton, inputClass, type IconName } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  admin?: boolean;
}

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');

  const navItems = [
    { to: '/', label: t('library'), icon: 'library', end: true },
    { to: '/new', label: t('newSchematic'), icon: 'plus' },
    { to: '/import-export', label: t('importExport'), icon: 'archive' },
    { to: '/admin', label: t('admin'), icon: 'shield', admin: true },
  ] satisfies NavItem[];

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

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors duration-100 ${
      isActive ? 'bg-accent/15 font-medium text-accent' : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
    }`;

  const renderNav = (mobile = false) => (
    <nav className={mobile ? 'flex gap-1 overflow-x-auto px-2 py-2' : 'flex flex-1 items-center gap-1'} aria-label={mobile ? undefined : t('library')}>
      {navItems.filter((item) => !item.admin || user?.role === 'ADMIN').map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
          <Icon name={item.icon} size={15} />
          <span className={mobile ? 'whitespace-nowrap' : 'hidden lg:inline'}>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b border-slate-800 bg-panel">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex shrink-0 items-center gap-2 rounded-lg text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent"><Icon name="layers" size={18} /></span>
            <span className="font-semibold tracking-tight">{t('appName')}</span>
          </Link>
          <div className="hidden md:flex md:flex-1">{renderNav()}</div>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher />
            <span className="hidden items-center gap-1.5 rounded-lg border border-slate-800 bg-surface px-2.5 py-1.5 text-xs text-slate-300 sm:inline-flex">
              <Icon name="user" size={14} className="text-slate-500" />
              {user?.username}
            </span>
            <Button variant="ghost" size="sm" icon="logout" onClick={() => void onLogout()} aria-label={t('logout')}>
              <span className="hidden sm:inline">{t('logout')}</span>
            </Button>
          </div>
        </div>
        <div className="border-t border-slate-800 md:hidden">{renderNav(true)}</div>
      </header>

      {showPasswordForm && (
        <div className="border-b border-slate-800 bg-panel/60">
          <Card className="mx-auto my-4 max-w-2xl">
            <form onSubmit={(event) => void onChangePassword(event)} className="grid gap-3 sm:grid-cols-2">
              <Field label={t('currentPassword')} className="sm:col-span-2">
                <input type="password" required autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputClass} />
              </Field>
              <Field label={t('newPassword')} hint={t('minLengthError', { count: 10 })} className="sm:col-span-2">
                <input type="password" required minLength={10} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputClass} />
              </Field>
              <ErrorBanner>{error}</ErrorBanner>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button type="submit" variant="primary" icon="check">{t('changePassword')}</Button>
                <Button variant="ghost" onClick={() => setShowPasswordForm(false)}>{t('cancel')}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="mx-auto w-full max-w-6xl px-4 pb-8">
        <div className="flex items-center justify-between border-t border-slate-800 pt-4 text-xs text-slate-500">
          <span>{t('appName')}</span>
          <IconButton label={t('changePassword')} icon="key" size="sm" onClick={() => setShowPasswordForm((value) => !value)} />
        </div>
      </footer>
    </div>
  );
}
