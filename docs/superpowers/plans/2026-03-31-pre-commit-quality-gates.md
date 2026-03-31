# Pre-commit Quality Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up Husky v9 + lint-staged + ESLint (with architecture boundaries) + Vitest + i18n validation as pre-commit quality gates for worktree-manager.

**Architecture:** Replace the existing `.githooks/` custom hooks with Husky v9. Use lint-staged to run only on staged files for speed. ESLint with `eslint-plugin-boundaries` enforces layer dependency rules. Rust checks (fmt, clippy) run conditionally only when `src-tauri/` files are staged.

**Tech Stack:** Husky v9, lint-staged, ESLint v10 (flat config), eslint-plugin-boundaries, typescript-eslint, Vitest, @testing-library/react

---

## Task 1: Install dependencies and update package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install all devDependencies**

```bash
cd projects/worktree-manager
npm install --save-dev husky@^9.1.7 lint-staged@^16.4.0 eslint@^10.1.0 @eslint/js@^10.0.1 typescript-eslint@^8.57.2 eslint-plugin-boundaries@^6.0.1 vitest@^4.1.2 @testing-library/react@^16.3.2 @testing-library/jest-dom@^6.9.1 jsdom@^29.0.1
```

Expected: All packages install successfully, `package.json` updated with new devDependencies.

- [ ] **Step 2: Update package.json scripts**

Replace the `prepare` script and add new scripts. The final scripts section should be:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "contracts": "npm run verify:contracts && npm run docs:contracts",
    "verify:contracts": "node scripts/command-contracts.mjs check",
    "docs:contracts": "node scripts/command-contracts.mjs generate",
    "prepare": "husky",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "check-i18n": "node scripts/check-i18n.mjs",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add husky, lint-staged, eslint, vitest devDependencies"
```

---

## Task 2: Create ESLint configuration with architecture boundaries

**Files:**
- Create: `eslint.config.js`

This adapts the reference project's config for worktree-manager's directory structure. Key differences:
- No `pages` layer (worktree-manager doesn't have pages/)
- Added `hooks` layer for `src/hooks/**/*`
- `service` layer covers `src/lib/**/*` and `src/utils/**/*`
- `types` layer covers `src/types.ts` and `src/i18n.d.ts` (flat files, not a directory)
- Locale files are `en-US.json` and `zh-CN.json` (not `en.json`/`zh.json`)

- [ ] **Step 1: Create eslint.config.js**

```javascript
// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        {
          type: "components",
          pattern: ["src/components/**/*", "!src/components/ui/**/*"],
        },
        { type: "ui-lib", pattern: "src/components/ui/**/*" },
        { type: "hooks", pattern: "src/hooks/**/*" },
        { type: "service", pattern: ["src/lib/**/*", "src/utils/**/*"] },
        { type: "types", pattern: ["src/types.ts", "src/i18n.d.ts"] },
      ],
      "boundaries/ignore": [
        "**/*.test.*",
        "**/*.spec.*",
        "src/test/**/*",
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            {
              from: ["components"],
              allow: ["ui-lib", "hooks", "service", "types"],
            },
            { from: ["hooks"], allow: ["service", "types"] },
            { from: ["ui-lib"], allow: ["ui-lib"] },
            { from: ["service"], allow: ["types"] },
            { from: ["types"], allow: [] },
          ],
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              message:
                "Do not import from @tauri-apps/api/core directly. Use src/lib/backend.ts instead.",
            },
          ],
          patterns: [
            {
              group: ["@tauri-apps/plugin-*"],
              message:
                "Do not import Tauri plugins directly. Wrap them in src/lib/backend.ts.",
            },
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Service layer is allowed to import @tauri-apps directly
    files: ["src/lib/**/*.{ts,tsx}", "src/utils/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // Radix UI generated files: exempt from all boundaries
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "boundaries/element-types": "off",
      "no-restricted-imports": "off",
    },
  },
  {
    // Test files: exempt from boundaries and import restrictions
    files: ["src/**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
    rules: {
      "boundaries/element-types": "off",
      "no-restricted-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Root-level app files (main.tsx, App.tsx, etc.) — not in any layer
    files: ["src/*.{ts,tsx}"],
    rules: {
      "boundaries/element-types": "off",
    },
  }
);
```

- [ ] **Step 2: Verify ESLint loads without errors**

```bash
cd projects/worktree-manager
npx eslint --print-config src/App.tsx > /dev/null
```

Expected: No errors (may print warnings about unused configs for unmatched files — that's fine).

- [ ] **Step 3: Run ESLint on src/ and check baseline**

```bash
npx eslint src/ 2>&1 | head -50
```

Expected: Some warnings/errors from the new rules. This establishes the baseline. The initial run may show many issues — that's expected since ESLint was never configured before. Do NOT fix all issues now; the goal is to prevent NEW violations.

- [ ] **Step 4: Commit**

```bash
git add eslint.config.js
git commit -m "feat: add ESLint with architecture boundary enforcement"
```

---

## Task 3: Create i18n validation script

**Files:**
- Create: `scripts/check-i18n.mjs`

Adapted from the reference project for worktree-manager's locale file names (`en-US.json` / `zh-CN.json`).

- [ ] **Step 1: Create scripts/check-i18n.mjs**

```javascript
#!/usr/bin/env node
/**
 * check-i18n.mjs
 *
 * Validates that every t() key used in source files exists in the locale files.
 * Checks against en-US.json + zh-CN.json (flat key format).
 *
 * Run: node scripts/check-i18n.mjs
 */
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "../src");
const LOCALES_DIR = join(__dirname, "../src/locales");

function loadLocales() {
  const en = JSON.parse(
    readFileSync(join(LOCALES_DIR, "en-US.json"), "utf-8")
  );
  const zh = JSON.parse(
    readFileSync(join(LOCALES_DIR, "zh-CN.json"), "utf-8")
  );
  return { en, zh };
}

function flattenObject(obj, prefix = "") {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

function extractKeysFromFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const tCallRegex =
    /\bt\s*\(\s*(["'`])([^"'`\\]+?)\1\s*(?:,|\))/g;
  const results = [];
  let match;
  while ((match = tCallRegex.exec(content)) !== null) {
    const key = match[2];
    if (!key) continue;
    // Skip dynamic keys
    if (key.includes("/") || key.startsWith("@")) continue;
    results.push(key);
  }
  return results;
}

function scanSource(dir) {
  const allKeys = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git"].includes(entry.name)) continue;
      // Skip components/ui directory (Radix generated, no i18n)
      if (dir.endsWith("components") && entry.name === "ui") continue;
      allKeys.push(...scanSource(fullPath));
    } else if (
      entry.name.endsWith(".tsx") ||
      entry.name.endsWith(".ts")
    ) {
      allKeys.push(...extractKeysFromFile(fullPath));
    }
  }
  return allKeys;
}

function validate() {
  const { en, zh } = loadLocales();
  const enFlat = flattenObject(en);
  const zhFlat = flattenObject(zh);
  const sourceKeys = scanSource(SRC_DIR);
  const allKeys = new Set([
    ...Object.keys(enFlat),
    ...Object.keys(zhFlat),
  ]);
  let hasErrors = false;
  for (const key of sourceKeys) {
    if (!allKeys.has(key)) {
      console.error(
        `❌ Missing key: '${key}' — not found in any locale file`
      );
      hasErrors = true;
    }
  }
  if (hasErrors) {
    console.error(
      "\n💥 i18n validation failed — missing keys above"
    );
    process.exit(1);
  } else {
    console.log(
      `✅ All ${sourceKeys.length} i18n keys are valid (checked against en-US.json + zh-CN.json)`
    );
    process.exit(0);
  }
}

validate();
```

- [ ] **Step 2: Test the i18n script**

```bash
cd projects/worktree-manager
node scripts/check-i18n.mjs
```

Expected: Either `✅ All N i18n keys are valid` or a list of missing keys. If keys are missing, that's a real issue the script is designed to catch.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-i18n.mjs
git commit -m "feat: add i18n key validation script"
```

---

## Task 4: Create Vitest configuration and test setup

**Files:**
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 2: Create src/test/setup.ts**

```typescript
import "@testing-library/jest-dom";
```

- [ ] **Step 3: Verify vitest runs (with no tests)**

```bash
cd projects/worktree-manager
npx vitest run --passWithNoTests
```

Expected: Output shows `No test files found` but exits with code 0.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts src/test/setup.ts
git commit -m "feat: add Vitest configuration and test setup"
```

---

## Task 5: Create lint-staged configuration

**Files:**
- Create: `.lintstagedrc`

- [ ] **Step 1: Create .lintstagedrc**

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

Notes:
- `eslint --fix` auto-fixes what it can on staged TS/TSX files
- `tsc --noEmit` validates types project-wide (can't run on individual files)
- i18n check runs when locale JSON files are modified
- Rust fmt + clippy only run when `.rs` files in `src-tauri/` are staged

- [ ] **Step 2: Commit**

```bash
git add .lintstagedrc
git commit -m "feat: add lint-staged configuration for smart file filtering"
```

---

## Task 6: Set up Husky hooks and remove old .githooks

**Files:**
- Create: `.husky/pre-commit`
- Create: `.husky/pre-push`
- Delete: `.githooks/pre-commit`
- Delete: `.githooks/pre-push`

- [ ] **Step 1: Initialize Husky**

```bash
cd projects/worktree-manager
npx husky init
```

Expected: `.husky/` directory created with a default `pre-commit` file.

- [ ] **Step 2: Write .husky/pre-commit**

Replace the default content with:

```bash
npx lint-staged
```

- [ ] **Step 3: Create .husky/pre-push**

```bash
cd src-tauri && cargo test
```

- [ ] **Step 4: Delete old .githooks directory**

```bash
rm -rf .githooks
```

- [ ] **Step 5: Verify Husky is active**

```bash
git config core.hooksPath
```

Expected: Should NOT output `.githooks` anymore. Husky manages hooks via `.husky/_/` internally.

- [ ] **Step 6: Commit**

```bash
git add .husky/ .githooks/
git commit -m "feat: replace .githooks with Husky v9 + lint-staged pre-commit"
```

---

## Task 7: Smoke test the full pipeline

**Files:** None (validation only)

- [ ] **Step 1: Run ESLint manually**

```bash
cd projects/worktree-manager
npx eslint src/ 2>&1 | tail -5
```

Expected: ESLint runs. May show existing issues — that's the baseline. New code will be prevented from introducing more.

- [ ] **Step 2: Run tsc manually**

```bash
npx tsc --noEmit
```

Expected: Type check passes (existing code should already be type-safe).

- [ ] **Step 3: Run i18n check manually**

```bash
node scripts/check-i18n.mjs
```

Expected: Reports key status (pass or lists missing keys).

- [ ] **Step 4: Run vitest manually**

```bash
npx vitest run --passWithNoTests
```

Expected: Exits 0 with "no test files found" message.

- [ ] **Step 5: Run Rust checks manually**

```bash
cd src-tauri && cargo fmt -- --check && cargo clippy -- -D warnings
```

Expected: Both pass (existing code should already be formatted and clippy-clean).

- [ ] **Step 6: Test the pre-commit hook with a trivial change**

Make a minor change (e.g., add a comment) to any `.ts` file, stage it, and try to commit:

```bash
echo "// quality gate test" >> src/constants.ts
git add src/constants.ts
git commit -m "test: verify pre-commit quality gates"
```

Expected: lint-staged runs ESLint and tsc on the staged file. If all checks pass, the commit succeeds. If there are pre-existing ESLint issues in that file, the commit may fail — that's the gates working.

- [ ] **Step 7: Clean up (if Step 6 committed)**

If the test commit went through and you want to remove it:

```bash
git reset HEAD~1
git checkout src/constants.ts
```

---

## Notes

### Existing code and ESLint

Since ESLint was never configured before, the first `eslint src/` run will likely produce many warnings/errors from existing code. This is expected. Two approaches:

1. **Strict (recommended):** Fix violations as they're encountered during normal development. Use `eslint --fix` to auto-fix what's possible.
2. **Gradual:** Add `"boundaries/element-types": "warn"` initially, then promote to `"error"` after cleanup.

### Package manager

The project uses **npm** (not pnpm). All commands use `npx` instead of `pnpm`.
