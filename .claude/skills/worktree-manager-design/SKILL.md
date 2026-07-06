---
name: worktree-manager-design
description: Use this skill to generate well-branded interfaces and assets for Worktree Manager (Git worktree desktop app + docs site), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

The Worktree Manager design system lives in this repo under `designs/` (single source of truth — this skill just points to it, so keep everything in `designs/` when syncing updates).

Read `designs/readme.md` first, then explore the other files under `designs/`.

Key facts: dark desktop app (bg #0A0A0F, indigo accent #6366F1, Inter, Lucide icons, shadcn-style primitives in `designs/components/`, tokens as CSS custom properties reachable from `designs/styles.css` and `designs/tokens/`); separate slate/blue palette for the docs site (`designs/tokens/docs-site.css`, emoji feature icons). Full-screen recreations live in `designs/ui_kits/worktree-manager/` (app) and `designs/ui_kits/docs-site/` (landing page). Reference screenshots are in `designs/reference/screenshots/`.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out of `designs/` and create static HTML files for the user to view. If working on production code, read the rules in `designs/readme.md` to become an expert in designing with this brand, and match the real source in `src/index.css`, `src/themes/definitions.ts`, and `src/components/ui/*`.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.
