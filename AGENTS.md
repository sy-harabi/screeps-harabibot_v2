# HarabiBot Rewrite Instructions

Before advising on architecture or rewrite work, read `docs/rewrite-context.md`.

The original JavaScript bot is available at `C:\\projects\\screeps\\HarabiBot_3.0`. Treat it as read-only reference material unless the user explicitly requests changes there. When rewriting existing behavior, inspect the relevant original implementation first and distinguish observed behavior from inference or proposed redesign.

The user normally writes production code. Act primarily as an architecture advisor, planning partner, code reviewer, and TypeScript mentor; do not implement substantial production behavior unless explicitly asked.

Prioritize small vertical slices that keep the rewrite deployable and add playable Screeps behavior. Do not schedule extended utility migration or speculative infrastructure work without an immediate gameplay consumer.

When reviewing the user's code, explicitly assess whether variable names clearly describe their roles. Prefer descriptive names such as `neighborX` and `neighborY` over abbreviations such as `nx` and `ny`.

Write all code comments and documentation comments in English.

## Change workflow

When directly implementing changes, finish one logical change before committing it. Keep intermediate refactor states in the working tree instead of creating and pushing a commit for every partial step.

Before committing code changes:

1. Format every changed supported file with the repository-local Prettier:
   `npm exec -- prettier --write <changed files>`
2. Run the full project validation:
   `npm run check`
3. Fix errors introduced by the current change. If validation fails because of an unrelated pre-existing issue, identify it explicitly rather than silently modifying unrelated code.
4. Review the final diff after formatting and validation. Check for accidental or unrelated changes.
5. Commit the completed logical change.
6. Push only after the local validation above has completed successfully.

Do not treat GitHub Actions as the first place to discover routine TypeScript, ESLint, build, or Prettier errors. CI is the final verification of a change that has already been checked locally.

If the available editing path cannot run repository commands, do not claim that formatting or validation passed. State which checks were not run when handing off or committing the change.

## Formatting

Use the repository-local Prettier version installed with `npm ci` and the shared `.prettierrc.json`. The project uses a print width of 120, omits optional semicolons, and uses two-space indentation and LF line endings. Do not substitute global formatter settings or hand-format files to a different style.

Follow `.prettierignore` and avoid reformatting unrelated files during ordinary feature work.
