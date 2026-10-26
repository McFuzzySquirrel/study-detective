/**
 * Backward-compatible entry point. The composition root lives in
 * `src/app/App.tsx` beside the shell and capability notice it mounts; this
 * module keeps existing imports stable.
 */
export { default } from './app/App';
export type { AppProps } from './app/App';
