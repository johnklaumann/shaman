---
description: Set shaman level (lite | full | ultra | ab | off) or show current status
argument-hint: "[lite|full|ultra|ab|off]"
---

Set or show the shaman level. Argument: `$ARGUMENTS` (empty = show status).

1. Read the state file at `$CLAUDE_CONFIG_DIR/shaman/state.json` (default `~/.claude/shaman/state.json`). The gate hook usually persists the change before this command runs.
2. If an argument was given and `mode` in the state file differs, update the file (keep the other fields).
3. Adopt the level immediately in this session:
   - **lite** — drop filler, hedging, pleasantries; keep articles and full sentences.
   - **full** — also drop articles; fragments OK; short synonyms. (default)
   - **ultra** — also one word when one word is enough; strip conjunctions.
   - **ab** — self-measuring A/B: alternates by calendar-day parity (odd day = full, even day = off, gate included). Sessions are auto-stamped with the arm they ran under, so `/shaman-bench` builds an honest on-vs-off comparison from normal work with zero discipline. Adopt whatever today's arm is.
   - **off** — stop all shaman talk and build rules.
4. Confirm in one line: `shaman: mode=<mode> gate=<gate>`.
