/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** "true" only in the image the end-to-end tests run against. */
  readonly VITE_E2E_INSPECTOR?: string;
}
