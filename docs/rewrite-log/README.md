# Rewrite Log

This directory is a development diary for the HarabiBot v2 rewrite.

Its main purpose is to preserve useful history for the author: what was tried, what changed, what failed, what was learned, and material that may later be useful when writing blog posts or reconstructing the development process.

Entries are historical snapshots. They are **not a source of truth for the current implementation or architecture**, and they should not be rewritten merely because the project has moved on.

Agents should not read this directory by default. Consult it only when the user asks about development history, previous experiments, earlier approaches, lessons learned, or material for a blog or retrospective.

Create an entry when there is something worth remembering later, not as a required step for every coding session. Use `YYYY-MM-DD-short-topic.md` as the filename.

Entries may be informal, but useful details include the starting point, approaches tried, decisions made at the time, completed work, failures, measurements, lessons, and possible next steps. Include related commit hashes or experimental evidence when they are useful.

Suggested structure:

```markdown
# Milestone title

Date: YYYY-MM-DD
Related commits: `commit`

## Goal

## Starting point

## Decisions

## Work completed

## Problems encountered

## What we learned

## Result

## Next step
```
