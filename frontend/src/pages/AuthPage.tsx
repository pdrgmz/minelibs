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
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <div className="mb-8 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent"><Icon name="layers" size={22} /></span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white">{t('appName')}</h1>
              <p className="mt-0.5 text-xs text-slate-500">{mode === 'login' ? t('loginSubtitle') : t('registerSubtitle')}</p>
            </div>
          </div>
          <LanguageSwitcher />
        </div>

        <form onSubmit={(event) => void onSubmit(event)} className="space-y-5">
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

        <p className="mt-6 border-t border-slate-800 pt-5 text-center text-sm text-slate-400">
          {mode === 'login' ? t('noAccount') : t('haveAccount')}{' '}
          <Link to={mode === 'login' ? '/register' : '/login'} className="font-medium text-accent hover:underline">
            {mode === 'login' ? t('register') : t('login')}
          </Link>
        </p>
      </Card>
    </div>
  );
}
