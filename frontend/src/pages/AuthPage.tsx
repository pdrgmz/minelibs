import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

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
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-panel p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-accent">{t('appName')}</h1>
          <LanguageSwitcher />
        </div>
        <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-300">{t('username')}</span>
            <input
              required
              minLength={3}
              maxLength={32}
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded border border-slate-600 bg-surface px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-300">{t('password')}</span>
            <input
              required
              type="password"
              minLength={mode === 'register' ? 10 : 1}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded border border-slate-600 bg-surface px-3 py-2"
            />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button disabled={busy} className="w-full rounded bg-accent px-4 py-2 font-semibold disabled:opacity-50">
            {mode === 'login' ? t('login') : t('register')}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-400">
          {mode === 'login' ? (
            <>
              {t('register')}: <Link to="/register" className="text-accent underline">{t('register')}</Link>
            </>
          ) : (
            <>
              {t('login')}: <Link to="/login" className="text-accent underline">{t('login')}</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
