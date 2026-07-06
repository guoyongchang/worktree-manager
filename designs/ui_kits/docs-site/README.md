# Worktree Manager — Docs Site UI Kit

Recreation of the GitHub Pages landing site (`docs/en/index.html`, live at https://guoyongchang.github.io/worktree-manager/).

**Important:** the docs site uses a *different* palette than the desktop app — Tailwind slate (#0f172a / #1e293b / #334155) with blue-500 primary (#3b82f6), gradient CTAs with glow shadows, and **emoji as feature icons** (🔀 🔗 📊 💻 🧠 🌐 — verbatim from the source). Tokens live in `tokens/docs-site.css` (`--docs-*`).

Sections recreated in `index.html`: fixed blurred nav, gradient hero, download section (gradient CTA + platform badges + auto-update note), one "Sound familiar?" pain-point card with the red/green workflow-comparison chips, 6 of the 17 feature cards, "Three Steps to Start", footer. The guide page, remaining pain-point scenarios, feature cards, browser-sharing highlight grid, tech grid, and FAQ exist in the source but are not duplicated here — extend by copying patterns from `docs/en/index.html` in the repo.

The site is bilingual (Chinese primary at `docs/index.html`, English at `docs/en/`); this kit recreates the English version.
