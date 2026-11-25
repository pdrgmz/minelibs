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
    `inline-flex h-11 shrink-0 items-center gap-2 border-b-[3px] px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
      isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
    }`;

  const renderNav = (mobile = false) => (
    <nav className={mobile ? 'flex gap-1 overflow-x-auto px-2' : 'flex flex-1 items-center gap-1'} aria-label={mobile ? undefined : t('library')}>
      {navItems.filter((item) => !item.admin || user?.role === 'ADMIN').map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
          <Icon name={item.icon} size={14} />
          <span className="whitespace-nowrap">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b-2 border-ink bg-canvas">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex shrink-0 items-center gap-2 rounded-control">
            <span className="flex h-8 w-8 items-center justify-center rounded-control border border-ink bg-terminal text-accent"><Icon name="layers" size={18} /></span>
            <span className="font-mono text-sm font-bold uppercase tracking-[0.12em] text-ink">{t('appName')}</span>
          </Link>
          <div className="hidden h-full md:flex md:flex-1">{renderNav()}</div>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher />
            <span className="hidden items-center gap-1.5 rounded-full border border-ink bg-ink px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-paper sm:inline-flex">
              <Icon name="user" size={12} className="text-accent" />
              {user?.username}
            </span>
            <Button variant="ghost" size="sm" icon="logout" onClick={() => void onLogout()} aria-label={t('logout')}>
              <span className="hidden lg:inline">{t('logout')}</span>
            </Button>
          </div>
        </div>
        <div className="border-t border-ink md:hidden">{renderNav(true)}</div>
      </header>

      {showPasswordForm && (
        <div className="border-b border-ink bg-surface/60">
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
        <div className="flex items-center justify-between border-t border-ink pt-4 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
          <span>{t('appName')} / {t('library')}</span>
          <IconButton label={t('changePassword')} icon="key" size="sm" onClick={() => setShowPasswordForm((value) => !value)} />
        </div>
      </footer>
    </div>
  );
}
