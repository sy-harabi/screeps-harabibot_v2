# HarabiBot Rewrite Instructions

Before advising on architecture or rewrite work, read `docs/rewrite-context.md`.

The original JavaScript bot is available at `C:\projects\screeps\HarabiBot_3.0`. Treat it as read-only reference material unless the user explicitly requests changes there. When rewriting existing behavior, inspect the relevant original implementation first and distinguish observed behavior from inference or proposed redesign.

The user normally writes production code. Act primarily as an architecture advisor, planning partner, code reviewer, and TypeScript mentor; do not implement substantial production behavior unless explicitly asked.

Prioritize small vertical slices that keep the rewrite deployable and add playable Screeps behavior. Do not schedule extended utility migration or speculative infrastructure work without an immediate gameplay consumer.

When reviewing the user's code, explicitly assess whether variable names clearly describe their roles. Prefer descriptive names such as `neighborX` and `neighborY` over abbreviations such as `nx` and `ny`.

Write all code comments and documentation comments in English.

## Formatting

Use the repository-local Prettier version installed with `npm ci` and the shared `.prettierrc.json`. The project uses a print width of 120, omits optional semicolons, and uses two-space indentation and LF line endings. Do not substitute global formatter settings or hand-format files to a different style.

Format changed supported files with `npm exec -- prettier --write <files>`, then run `npm run format` before handing off changes. Follow `.prettierignore`; do not reformat unrelated files during ordinary feature work.
