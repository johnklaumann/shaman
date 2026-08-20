---
description: Report token benchmarks collected by shaman across sessions
---

Report shaman token benchmarks.

1. Read `$CLAUDE_CONFIG_DIR/shaman/bench.jsonl` (default `~/.claude/shaman/bench.jsonl`). Each line is a cumulative per-session snapshot written at every Stop; **keep only the last record per `session`**.
2. If the file is missing or empty: say benchmarks appear after the first completed session, then stop.
3. Exclude records with `mode: "mixed"` (the user switched modes mid-session; their tokens can't be attributed to one mode) — report how many were excluded. Aggregate the rest, split by `mode` (`off` vs `lite`/`full`/`ultra`):
   - sessions, total requests, total user turns
   - output tokens per request (the number shaman mainly reduces)
   - input, cache read, cache creation totals
4. Render a compact table: `mode | sessions | requests | out/req | in/req | cache read`. If both `off` and active-mode sessions exist, add a comparison line with the % difference in output tokens per request.
5. **Convergence** (records with `sawEdit: true` and a `callsBeforeFirstEdit` field — only sessions after the instrumentation shipped): per mode, report the **median** `callsBeforeFirstEdit`, `exploreCalls`, and `readTokens`. Use the median, not the mean — one mega-session skews pooled totals. This is the baseline the retrieval/scout work must beat: with the plugin doing nothing to exploration yet, `on` and `off` should be roughly equal; after `code_search` lands, `on` should fall below `off`.
6. **Gate telemetry**: if `$CLAUDE_CONFIG_DIR/shaman/gate.jsonl` exists, summarize it — count by `band` (share weak/medium/strong) and by `action` (`pass`/`enrich`/`pause`/`block`), and a confirm **proceed-rate**: of `pause` events, how many were followed later in the same session by an `enrich` (a resend). Label proceed-rate a proxy — a later enrich may be a different weak prompt.
7. Close with caveats, one line each: numbers are transcript-derived estimates (format is internal to Claude Code, may drift between versions); `/usage` is the source of truth; comparisons are only meaningful across similar tasks.
