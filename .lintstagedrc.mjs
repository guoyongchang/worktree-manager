const quoteFiles = (files) => files.map((file) => JSON.stringify(file)).join(' ');

export default {
  'src/**/*.{ts,tsx}': (files) => [
    `eslint --fix ${quoteFiles(files)}`,
    'pnpm exec tsc --noEmit',
    'node scripts/check-i18n.mjs',
  ],
  'src/locales/*.json': () => [
    'node scripts/check-i18n.mjs',
  ],
  'src-tauri/**/*.rs': () => [
    'cargo fmt --manifest-path src-tauri/Cargo.toml -- --check',
    'cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings',
  ],
};
