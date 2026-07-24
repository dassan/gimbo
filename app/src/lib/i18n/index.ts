import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ptBR from './locales/pt-BR.json'
import enUS from './locales/en-US.json'
import { loadWorkspace, detectBrowserLocale } from '@/lib/storage/workspace'

// A previously persisted choice (via Settings/Onboarding) always wins over the browser's
// language; only a first-ever launch (no saved workspace) falls back to detection.
const initialLocale = loadWorkspace()?.locale ?? detectBrowserLocale()

void i18n.use(initReactI18next).init({
  resources: {
    'pt-BR': { translation: ptBR },
    'en-US': { translation: enUS },
  },
  lng: initialLocale,
  fallbackLng: 'pt-BR',
  interpolation: { escapeValue: false },
})

export default i18n
