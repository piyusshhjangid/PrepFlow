import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Environment files are resolved relative to THIS file, never relative to the directory the
 * developer happened to run `npm` from. (`npm run dev -w @prepflow/api` starts the process inside
 * apps/api, while `npm run` at the repository root starts it at the root; both must behave the same.)
 *
 * Works for `src/config` (tsx) and `dist/config` (compiled): two levels up is always apps/api.
 */
export const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_ROOT = resolve(API_DIR, '..', '..');

/** Highest priority first. Variables already present in process.env always win over files. */
export const ENV_FILE_CANDIDATES = [resolve(API_DIR, '.env'), resolve(REPO_ROOT, '.env')];

let loaded: string[] | undefined;

/** Loads every existing candidate file (without overriding anything already set). Idempotent. */
export function loadEnvFiles(): string[] {
  if (loaded) return loaded;
  loaded = [];
  for (const file of ENV_FILE_CANDIDATES) {
    if (!existsSync(file)) continue;
    dotenv.config({ path: file, override: false, quiet: true });
    loaded.push(file);
  }
  return loaded;
}
