---
description: Generate shaman rule files for Cursor, Copilot, Windsurf, Cline, Kiro, Qoder, Codex/Gemini (AGENTS.md) in this repo
---

Set up shaman for other AI tools in the current repository by running the bundled CLI:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli/index.js" init
```

(If `${CLAUDE_PLUGIN_ROOT}` is not substituted, locate the installed shaman plugin under `~/.claude/plugins/` and use its `src/cli/index.js`.)

The CLI writes one rule file per tool (AGENTS.md, .cursor/rules/, .github/copilot-instructions.md, .windsurf/rules/, .clinerules/, .kiro/steering/, .qoder/rules/, .agents/rules/), all generated from the same canonical ruleset. It skips files that already exist.

1. Show the CLI output verbatim.
2. For any file it skipped: show the diff between the existing file and the generated content (`node .../index.js init --force` in a temp dir if needed for comparison) and ask before overwriting with `--force`.
3. Close with: the prompt gate, scoring, and benchmarks need hooks — Claude Code and Codex get those via the plugin; the other tools get the static ruleset.
