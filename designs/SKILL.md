---
name: worktree-manager-design
description: Use this skill to generate well-branded interfaces and assets for Worktree Manager (Git worktree desktop app + docs site), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

Key facts: dark desktop app (bg #0A0A0F, indigo accent #6366F1, Inter, Lucide icons, shadcn-style primitives in `components/`, tokens as CSS custom properties reachable from `styles.css`); separate slate/blue palette for the docs site (`tokens/docs-site.css`, emoji feature icons). Full-screen recreations live in `ui_kits/worktree-manager/` (app) and `ui_kits/docs-site/` (landing page).

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.
