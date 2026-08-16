---
description: Generate shaman rule files for Cursor, Codex CLI, and GitHub Copilot in this repo
---

Set up shaman for other AI tools in the current repository. Templates live in the shaman plugin under `${CLAUDE_PLUGIN_ROOT}/templates/` (if that variable is not substituted, locate the installed shaman plugin under `~/.claude/plugins/` and use its `templates/` directory).

1. `.cursor/rules/shaman.mdc` — create from `templates/cursor.mdc`. If it already exists and differs, show the diff and ask before overwriting.
2. `AGENTS.md` at the repo root — Codex CLI, Cursor, and Copilot all read this file. If missing, create from `templates/AGENTS.md`. If it exists and has no `## Shaman rules` section, append that section from the template. If the section exists, leave it untouched.
3. `.github/copilot-instructions.md` — same create-or-append logic using `templates/copilot-instructions.md`.
4. Report one line per file: created / appended / skipped (already present).
5. Close with: prompt gate and benchmarks are Claude Code-only (they need hooks); Cursor/Codex/Copilot get the static ruleset.
