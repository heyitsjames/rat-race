/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' turns on the optional race stats (src/analytics.ts). */
  readonly VITE_RACE_STATS?: string;
}
