// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      boundaries,
      "react-hooks": reactHooks,
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
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: { type: "components" }, allow: ["ui-lib", "hooks", "service", "types"] },
            { from: { type: "hooks" }, allow: ["service", "types"] },
            { from: { type: "ui-lib" }, allow: ["ui-lib"] },
            { from: { type: "service" }, allow: ["types"] },
            { from: { type: "types" }, allow: [] },
          ],
        },
      ],
      "react-hooks/exhaustive-deps": "warn",
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
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
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
      "boundaries/dependencies": "off",
      "no-restricted-imports": "off",
    },
  },
  {
    // Test files: exempt from boundaries and import restrictions
    files: ["src/**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
    rules: {
      "boundaries/dependencies": "off",
      "no-restricted-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Root-level app files (main.tsx, App.tsx, etc.) — not in any layer
    files: ["src/*.{ts,tsx}"],
    rules: {
      "boundaries/dependencies": "off",
    },
  }
);
