/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "live" or "staging": which Firebase project this build talks to (see firebase.ts). */
  readonly VITE_NUCLEUS_ENV?: string;
}
