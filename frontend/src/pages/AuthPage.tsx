import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Button, Card, ErrorBanner, Field, Icon, inputClass } from '../components/ui';
import { useAuth } from '../context/AuthContext';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { t } = useTranslation();
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
      navigate('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-md overflow-hidden p-0">
        <div className="flex items-start justify-between gap-3 border-b-2 border-ink bg-terminal p-6 text-paper">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-control border border-ink bg-accent text-ink"><Icon name="layers" size={22} /></span>
            <div>
              <h1 className="font-mono text-lg font-bold uppercase tracking-[0.12em]">{t('appName')}</h1>
              <p className="mt-1 font-sans text-xs text-paper/70">{mode === 'login' ? t('loginSubtitle') : t('registerSubtitle')}</p>
            </div>
          </div>
          <LanguageSwitcher />
        </div>

        <form onSubmit={(event) => void onSubmit(event)} className="space-y-5 p-6">
          <Field label={t('username')}>
            <input
              required
              minLength={3}
              maxLength={32}
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t('password')} hint={mode === 'register' ? t('passwordHint') : undefined}>
            <input
              required
              type="password"
              minLength={mode === 'register' ? 10 : 1}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </Field>
          <ErrorBanner>{error}</ErrorBanner>
          <Button type="submit" variant="primary" loading={busy} className="w-full">
            {mode === 'login' ? t('login') : t('register')}
          </Button>
        </form>

        <p className="border-t border-dashed border-dash px-6 py-5 text-center font-sans text-sm text-muted">
          {mode === 'login' ? t('noAccount') : t('haveAccount')}{' '}
          <Link to={mode === 'login' ? '/register' : '/login'} className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-ink underline decoration-accent decoration-2 underline-offset-4">
            {mode === 'login' ? t('register') : t('login')}
          </Link>
        </p>
      </Card>
    </div>
  );
}
