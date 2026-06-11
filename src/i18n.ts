import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

const SUPPORTED_LANGS = new Set(['zh-CN', 'en-US']);

function detectLanguage(): string {
  const stored = localStorage.getItem('i18n-lang');
  if (stored && SUPPORTED_LANGS.has(stored)) return stored;

  if (navigator.language.startsWith('en')) return 'en-US';
  return 'zh-CN';
}

i18next
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
    },
    lng: detectLanguage(),
    fallbackLng: 'en-US',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18next;
