---
description: Set prompt-gate mode (coach | enrich | off) or show current status
argument-hint: "[coach|enrich|off]"
---

Set or show the prompt-gate mode. Argument: `$ARGUMENTS` (empty = show status).

1. Read the state file at `$CLAUDE_CONFIG_DIR/shaman/state.json` (default `~/.claude/shaman/state.json`). The gate hook usually persists the change before this command runs.
2. If an argument was given and `gate` in the state file differs, update the file (keep the other fields).
3. Explain the active mode in one line:
   - **coach** — vague prompts are blocked before reaching the model; user gets a template showing what to add. Zero tokens spent on bad prompts. One block per 3 minutes per session, then it falls back to enrich.
   - **enrich** — vague prompts pass, but the model is instructed to state assumptions, ask at most one clarifying question, and build the minimum. (default)
   - **off** — gate disabled.
4. Confirm in one line: `shaman: mode=<mode> gate=<gate>`.
