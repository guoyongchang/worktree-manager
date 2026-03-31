# Pre-commit Quality Gates for worktree-manager

**Date:** 2026-03-31
**Status:** Approved
**Reference:** [surge-configuration-manager](https://github.com/guoyongchang/surge-configuration-manager)

## Goal

Introduce automated quality gates via Husky pre-commit/pre-push hooks, matching the enforcement level of the reference project. The system will run linting, type checking, architecture boundary validation, i18n key verification, and tests before code enters the repository.

## Architecture

```
pre-commit hook (lint-staged driven)
├── *.ts, *.tsx (staged) → ESLint (architecture boundaries) + tsc --noEmit
├── src/locales/*.json (staged) → check-i18n
├── src-tauri/**/*.rs (staged, conditional) → cargo fmt --check + cargo clippy
└── (no test files run at commit time — tests deferred to pre-push)

pre-push hook
└── Full vitest run + cargo test (safety net)
```

## Layer Architecture (eslint-plugin-boundaries)

### Layers

| Layer | Path Pattern | Description |
|-------|-------------|-------------|
| `components` | `src/components/**/*` (excluding `ui/`) | Business components |
| `ui-lib` | `src/components/ui/**/*` | Radix UI base components |
| `hooks` | `src/hooks/**/*` | React hooks |
| `service` | `src/lib/**/*`, `src/utils/**/*` | Service/utility layer |
| `types` | `src/types.ts`, `src/i18n.d.ts` | Type definitions |

### Dependency Rules (default deny, explicitly allow)

| From | Allowed imports |
|------|----------------|
| `components` | `ui-lib`, `hooks`, `service`, `types` |
| `hooks` | `service`, `types` |
| `ui-lib` | `ui-lib` only |
| `service` | `types` |
| `types` | nothing |

### Import Restrictions

- Direct `import { invoke } from '@tauri-apps/api/core'` is forbidden — must use `src/lib/backend.ts` wrapper
- Direct `import ... from '@tauri-apps/plugin-*'` is forbidden — must be wrapped in `src/lib/`
- Exception: files in `src/lib/**/*` may import Tauri APIs directly

### File-specific Overrides

- `src/components/ui/**/*` — boundaries and import restrictions off (Radix generated files)
- Test files (`*.test.ts`, `*.test.tsx`, `src/test/**/*`) — all restrictions off
- Root app files (`src/*.ts`, `src/*.tsx` except those in layers) — boundaries off

## Dependencies

### Frontend devDependencies

| Package | Version | Role |
|---------|---------|------|
| `husky` | `^9.1.7` | Git hooks management |
| `lint-staged` | `^16.4.0` | Staged files only checking |
| `eslint` | `^10.1.0` | Linter |
| `@eslint/js` | `^10.0.1` | ESLint JS recommended rules |
| `typescript-eslint` | `^8.57.2` | TypeScript ESLint integration |
| `eslint-plugin-boundaries` | `^6.0.1` | Architecture layer enforcement |
| `vitest` | `^4.1.2` | Test runner |
| `@testing-library/react` | `^16.3.2` | React testing utilities |
| `@testing-library/jest-dom` | `^6.9.1` | DOM matchers |
| `jsdom` | `^29.0.1` | DOM environment for tests |

## File Changes

### New files

| File | Purpose |
|------|---------|
| `.husky/pre-commit` | lint-staged driven smart checks |
| `.husky/pre-push` | Full test run as safety net |
| `.lintstagedrc` | lint-staged configuration |
| `eslint.config.js` | ESLint flat config with boundaries |
| `vitest.config.ts` | Vitest configuration |
| `src/test/setup.ts` | Test setup (jest-dom) |
| `scripts/check-i18n.mjs` | i18n key validation script |

### Modified files

| File | Change |
|------|--------|
| `package.json` | Replace `prepare` script with `husky`, add scripts (lint, check-i18n, test), add devDependencies |

### Deleted files

| File | Reason |
|------|--------|
| `.githooks/pre-commit` | Replaced by Husky |
| `.githooks/pre-push` | Replaced by Husky |

## Configuration Details

### package.json scripts

```json
{
  "prepare": "husky",
  "lint": "eslint src/",
  "lint:fix": "eslint src/ --fix",
  "check-i18n": "node scripts/check-i18n.mjs",
  "test": "vitest run --passWithNoTests",
  "test:watch": "vitest"
}
```

### .lintstagedrc

```json
{
  "src/**/*.{ts,tsx}": [
    "eslint --fix",
    "bash -c 'tsc --noEmit'"
  ],
  "src/locales/*.json": [
    "node scripts/check-i18n.mjs"
  ],
  "src-tauri/**/*.rs": [
    "bash -c 'cd src-tauri && cargo fmt -- --check && cargo clippy -- -D warnings'"
  ]
}
```

### .husky/pre-commit

```bash
pnpm lint-staged
```

### .husky/pre-push

```bash
cd src-tauri && cargo test
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

### scripts/check-i18n.mjs

Logic:
1. Scan all `.ts`/`.tsx` files in `src/` for `t("key")` and `` t(`key`) `` calls
2. Load and flatten `en-US.json` and `zh-CN.json` from `src/locales/`
3. Verify every key used in source exists in at least one locale file
4. Exit 1 if any keys are missing (blocks commit)
5. Skip `node_modules/`, `.git/`, `components/ui/`, dynamic keys (containing `/` or starting with `@`)

## Out of Scope

- CI pipeline updates (separate task)
- Writing actual test cases (infrastructure only)
- Rust-side `[dev-dependencies]` additions
- `.editorconfig` or Prettier setup
