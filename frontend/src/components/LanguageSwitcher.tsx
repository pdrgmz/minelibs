import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const [language, setLanguage] = useState(i18n.language.startsWith('en') ? 'en' : 'es');

  useEffect(() => {
    void i18n.changeLanguage(language);
    localStorage.setItem('minelibs.lang', language);
  }, [language, i18n]);

  return (
    <select
      aria-label={t('language')}
      value={language}
      onChange={(event) => setLanguage(event.target.value)}
      className="rounded-control border border-ink bg-canvas px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink hover:bg-surface"
    >
      <option value="es">ES</option>
      <option value="en">EN</option>
    </select>
  );
}
