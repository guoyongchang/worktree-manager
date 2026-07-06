# Worktree Manager Design System

**Worktree Manager** — "The missing GUI for Git Worktrees." A cross-platform desktop app (Tauri 2 + React 19 + TypeScript + Tailwind CSS 4 + Rust) for working on multiple branches simultaneously across multiple repos: create a worktree, and every linked project checks out that branch in an isolated directory with `node_modules` shared via symlink. Built-in terminal (xterm.js + PTY), one-click git operations (sync / pull / push / merge-to-test / merge-to-main), safe archiving, browser remote access (LAN / ngrok, password-protected), voice input with AI refinement, and an MCP server for AI coding agents. Open source (MIT), by guoyongchang.

**Two surfaces, two palettes:**
1. **Desktop app** — near-black `#0A0A0F` canvas, indigo `#6366F1` accent, Inter UI font, shadcn/Radix-style primitives. 8 user themes.
2. **Docs/marketing site** (GitHub Pages) — Tailwind slate palette (`#0f172a`), blue `#3b82f6` primary, gradient CTAs, emoji feature icons. Bilingual, Chinese primary / English secondary.

## Sources

- GitHub repo: https://github.com/guoyongchang/worktree-manager (all tokens, components, and screens recreated from this source — explore it to go deeper; key files: `src/index.css`, `src/design-tokens.ts`, `src/themes/definitions.ts`, `src/components/ui/*`, `src/components/Icons.tsx`, `docs/en/index.html`)
- Live docs site: https://guoyongchang.github.io/worktree-manager/
- Reference screenshots copied to `reference/screenshots/` (main view, create-worktree modal, worktree detail + terminal)

## CONTENT FUNDAMENTALS

- **Voice:** direct, practical, developer-to-developer. Second person ("Your feature branch keeps running"), imperative headlines ("Fix, push, archive."). Never corporate.
- **Story-driven marketing copy:** pain-point narration in vivid scenarios ("You're deep in a feature branch. Fifteen files changed. Dev server running. Then Slack pings: **production is down**"), then the before/after contrast with concrete numbers ("8 steps · 15+ minutes" vs "4 steps · 30-second switch"). Time and step counts are the core persuasion device.
- **In-app copy:** terse and functional. Sentence case everywhere ("New Worktree", "Sync main", "Merge to test"). Buttons are verb-first, 1–3 words. Progressive labels while busy ("Syncing…", "Verifying…", "Creating…"). Counts in parentheses: "Active (5)", "Archive (0)", "Create (3)".
- **Git vocabulary is used verbatim**, in mono where inline: `git stash`, `node_modules`, branch names like `feature/checkout-v2`, `hotfix-payment`.
- **Errors** are specific and actionable: "Conflict in 3 files: a.ts, b.ts, c.ts. Resolve in editor or terminal." Errors persist until dismissed; successes auto-dismiss.
- **Emoji:** YES on the docs site (feature icons 🔀 🔗 📊 💻 and section table rows in README) — NO inside the app UI itself.
- **Bilingual:** zh-CN is the primary locale, en-US complete. UI strings live in `src/locales/*.json`. This design system's recreations use the English voice.
- **Proper nouns:** "Worktree" capitalized as a product concept; "worktree" lowercase in git-technical prose; "Workspace" capitalized as the container concept.

## VISUAL FOUNDATIONS

- **Color model:** three background layers (`--bg-base` #0A0A0F → `--bg-surface` #141419 → `--bg-elevated` #1A1A22), one hairline `--border` #1E1E26, three text tiers (#E8E8ED / #8B8B9E / #55556A). One indigo accent #6366F1 (hover #818CF8). Semantic success/warning/error each with a `-light` hover step. All eight themes (`data-theme` attr) remap the same 18 variables — components never hardcode colors.
- **Tint system:** accents are applied at fixed alphas — 10% backgrounds, 15% badge fills, 20–30% tinted borders (`color-mix`). "Merge to main" gets a special orange danger treatment (orange-800/40 border, orange-300 text).
- **Type:** Inter (variable 100–900) for everything; Maple Mono NF CN for terminal/paths/code (see Iconography for substitution note). Sizes actually used: 10 (badges), 11 (uppercase section labels, +0.05em tracking), 12, 13, 14 (default), 16, 20, 24. Weights: 400/500/600 only. Titles use tracking -0.025em, leading-none.
- **Spacing:** strict Tailwind 4px grid. Cards & dialogs pad 24px (dense app cards 16px); list rows 10–12px vertical; gaps 6–8px between related controls.
- **Radii:** 2px menu items · 4px inline alerts · 6px buttons/inputs/menus · 8px cards/dialogs/toasts · 16px hero icon tile · full badges/dots.
- **Backgrounds:** flat solid layers, NO imagery, no textures, no patterns. Gradients only in two places: animated accent progress bars (app) and blue CTA/step gradients (docs site). Dialog overlay is black/60 with heavy 24px backdrop blur.
- **Shadows:** deep black, dark-theme tuned — subtle `0 1px 3px rgba(0,0,0,0.3)` on controls, `0 4px 24px rgba(0,0,0,0.4)` on card hover, `0 8px 32px rgba(0,0,0,0.6)` on modals. Never colored (except docs-site blue CTA glow).
- **Selection pattern:** selected list rows get `--bg-elevated` + a 2px accent left edge. Uncommitted-changes cards get a 3px warning left edge.
- **Hover:** background steps up one layer (surface → elevated); text steps up one tier. No color inversions. **Press:** global `scale(0.98)` on every button. **Focus:** 2px accent/40 ring, no offset, no outlines anywhere else.
- **Motion:** fast and restrained — 150ms transitions, 150–200ms zoom-in (0.95→1) + fade entrances for menus/dialogs, 300ms slide-in-from-bottom for toasts, slide-out-to-right exits. Easing `cubic-bezier(0.16,1,0.3,1)`. One decorative loop: 3s subtle-pulse on the welcome hero tile. Indeterminate progress = animated accent gradient.
- **Empty/affordance pattern:** dashed accent/40 border + accent/70 text, filling to accent/10 on hover ("+ New Worktree", "+ Add project").
- **Density:** compact desktop-tool density; 288px sidebar (resizable 200–500), 32px terminal strip, 2-col auto-fill project-card grid (min 380px).
- **Scrollbars:** custom 8px, muted 50% alpha thumb, transparent track.

## ICONOGRAPHY

- **Icon system: Lucide** (`lucide-react` in source) — stroke icons, 24-grid, stroke-width 2, round caps, `currentColor`. Sizes 12/14/16/20. ~45 icons used (see `components/icons/Icon.prompt.md` for the list). No icon font, no PNG icons, no emoji in-app.
- This design system ships an `Icon` component that renders Lucide from the CDN UMD build (`lucide@0.462.0`) — same glyphs as the app.
- **StatusDot** (10px solid circle: emerald/amber/accent/purple) is the only non-Lucide glyph primitive.
- **App icon:** `assets/app-icon.svg` (+ `assets/app-icon-128.png`) — copied from the repo, the only brand mark. There is **no logotype**; the name is set in plain Inter semibold everywhere. Do not invent one.
- **Docs site exception:** feature cards use emoji as icons (🔀 🔗 📂 📊 🚀 💻 📦 🔌 🪟 🔍 ⌨️ 🔄 ⚡ 🎙️ 🧠 📱 🌐) and inline GitHub/platform SVGs — faithful to source.
- **Editor icons** (VS Code, Cursor, IntelliJ) are extracted from the OS at runtime in the real app; recreations use the Lucide `code` glyph fallback, as the app itself does.

## Components

All primitives are ports of `src/components/ui/*` (shadcn-style + Radix) and `src/components/Toast.tsx`, exposed on `window.WorktreeManagerDesignSystem_e60f48`:

- **forms/** — `Button` (7 variants × 4 sizes), `Input`, `Checkbox`, `Select`
- **display/** — `Badge` (6 variants), `Card` + `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter`, `StatusDot`
- **overlays/** — `Dialog` + `DialogHeader` / `DialogTitle` / `DialogDescription` / `DialogFooter`, `DropdownMenu` + `DropdownMenuItem` / `DropdownMenuLabel` / `DropdownMenuSeparator` / `DropdownMenuShortcut`, `Tooltip`, `Popover`
- **feedback/** — `Toast`, `ToastStack`, `TOAST_DURATION`
- **icons/** — `Icon` (Lucide wrapper)

**Intentional additions** (not in source inventory): `Icon` (bridges lucide-react to the browser runtime); `label` prop on Checkbox and `options` prop on Select (flatten Radix composition into cosmetic equivalents); `ToastStack` (presentational stand-in for the app's ToastProvider context).

**Not built** (in source but out of scope as primitives): the Radix scroll-area internals, `BranchCombobox`, and app screens like SettingsView — see UI kits for screen-level recreations.

## Index

| Path | Contents |
|---|---|
| `styles.css` | Global entry — imports everything below |
| `tokens/` | `colors.css` (18 vars × 8 themes), `typography.css`, `spacing.css`, `effects.css`, `motion.css` (keyframes + utilities), `base.css` (scrollbars, press effect), `fonts.css`, `docs-site.css` (`--docs-*`) |
| `components/` | forms / display / overlays / feedback / icons (see above) — each with `.jsx`, `.d.ts`, `.prompt.md`, and a `*.card.html` |
| `guidelines/` | 15 foundation specimen cards (colors, type, spacing, effects, brand) |
| `templates/` | Seedable starting points for consuming projects: `app-shell/` (interactive main view), `welcome/` (first-run), `landing-page/` (docs site) |
| `ui_kits/worktree-manager/` | Interactive desktop-app recreation: `index.html` (main view + modals + terminal), `welcome.html`, `login.html` |
| `ui_kits/docs-site/` | Marketing landing page recreation (`index.html`, `site.css`) |
| `assets/` | `app-icon.svg`, `app-icon-128.png`, `fonts/Inter-Variable.woff2` |
| `reference/screenshots/` | Original app screenshots for comparison |
| `SKILL.md` | Agent-skill entry point |

## Caveats & substitutions

- **Maple Mono NF CN** (the bundled terminal font) is not in the repo (only Inter is committed). `--font-mono` keeps `'Maple Mono NF CN'` first in the stack and currently falls back to **JetBrains Mono** (Google Fonts) — the app's own declared fallback. Upload the real woff2 to `assets/fonts/` and add an `@font-face` in `tokens/fonts.css` to fix.
- The old `docs/design-system.html` in the repo describes an earlier slate/blue app palette; the shipped app uses the indigo/near-black tokens in `src/index.css` — this design system follows the shipped app.
- Settings view, mobile layouts, voice-input overlay, and the multi-cell workspace grid are not recreated (large, out of scope); UI-kit buttons that lead there show a "not in this mock" toast instead of invented designs.
