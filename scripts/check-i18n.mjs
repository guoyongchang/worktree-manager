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
