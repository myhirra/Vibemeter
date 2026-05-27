// Node loader hook for the test runner.
//
// The license source files use TypeScript-style imports that Node's plain
// strip-types resolver doesn't understand:
//   1. `import { ... } from '@/lib/foo'`     ← tsconfig path alias
//   2. `import { ... } from './provider'`    ← extensionless ESM specifier
// We rewrite both to fully-qualified file URLs so `node --test` can load
// `src/lib/license/service.ts` directly, without us having to touch the
// production code or add a build step.
//
// Registered from the top of each test file via `node:module#register` so the
// existing `node --test tests/*.test.ts` glob still picks up only the test
// files (this loader's name doesn't end in `.test.ts`).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

function tryExtensions(base) {
  const candidates = [base, base + '.ts', base + '.tsx', base + '.mts', base + '.js', base + '/index.ts'];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = path.join(SRC_DIR, specifier.slice(2));
    const resolved = tryExtensions(base);
    if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const ext = path.extname(specifier);
    if (!ext) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const resolved = tryExtensions(path.join(parentDir, specifier));
      if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
    }
  }
  return nextResolve(specifier, context);
}
