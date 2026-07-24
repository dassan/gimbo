/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_DEMO_MODE: string
  // F-28 Nível 2, Fase 2 (CS-01) — OAuth2 client id for the Gimbo Google Cloud project.
  // Unset in dev/CI: Google Drive sync is simply hidden (see isGoogleSyncConfigured()).
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
