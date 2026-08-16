# shaman

> Tribe elder for your AI agent. Speaks little. Builds less. Blocks the bad hunt before it starts.

Three pillars in one plugin:

1. **Talk less** — terse output that cuts the fat, never the facts (caveman DNA)
2. **Build less** — decision ladder before any code: reuse > stdlib > native > installed dependency > one line > minimum build. No over-engineering, no workarounds, best practices always (ponytail DNA)
3. **Gate the prompt** — the new part. A hook scores your prompt *before it reaches the model*. Vague prompt? Blocked with a template showing what to add — zero tokens spent — or enriched so the model states its assumptions and asks exactly one clarifying question instead of guessing.

Plus **benchmarks**: per-session token stats so you can see the difference instead of believing a README.

Most engineers don't have a token problem. They have a prompt problem that presents as a token problem. Shaman fixes both ends: the prompt going in, the code and prose coming out.

## Install (Claude Code)

```
claude plugin marketplace add johnklaumann/shaman
claude plugin install shaman@shaman
```

Requires Node.js (any recent version) for the hooks.

## Commands

| Command | What it does |
|---------|--------------|
| `/shaman [lite\|full\|ultra\|off]` | Talk level. `full` (default) drops articles, allows fragments. `lite` keeps full sentences. `ultra` — one word when one word enough. |
| `/shaman-gate [coach\|enrich\|off]` | Prompt gate. `coach` blocks vague prompts before they burn tokens. `enrich` (default) lets them pass but forces stated assumptions + max one clarifying question. |
| `/shaman-bench` | Token stats per session, split by mode — your own numbers, on vs off. |
| `/shaman-init` | Generate static rule files for Cursor, Codex CLI, and GitHub Copilot in the current repo. |
| `/shaman-help` | Quick reference card. |

## The prompt gate

`"fix it"` → **blocked** (coach mode), before a single token is spent:

```
SHAMAN GATE — prompt too vague. Blocked before burning tokens.

Missing: target (file/function/error text), constraint or acceptance criteria, ...

Resend with:
  goal:    what change, where (file / function / error)
  context: current behavior vs expected
  accept:  how you'll know it's done
```

Design constraints, so it never gets in your way:

- Strong prompts pass **silently** — zero overhead, nothing injected.
- Never gated: slash commands, questions (enriched at most, never blocked), acknowledgements ("yes", "sounds good, go ahead", "pode"), and anything with neither an action verb nor a code/file reference — no action and no target means conversation, not a task.
- Coach blocks at most once per 3 minutes per session, then falls back to enrich. No block loops.
- The gate is a local heuristic (regex + structure checks, <50ms, no API calls, English + Portuguese verbs).

Why not rewrite the prompt automatically? Claude Code's `UserPromptSubmit` hook [can block or inject context, but cannot replace the prompt](https://code.claude.com/docs/en/hooks) — and that's the better design anyway: coach mode teaches you to write better prompts; silent rewriting would teach you nothing.

## Benchmarks

A `Stop` hook parses the session transcript and appends a snapshot to `~/.claude/shaman/bench.jsonl`: input/output/cache tokens, request count, mode, gate. `/shaman-bench` aggregates and compares modes.

Honesty notes:

- Usage is deduplicated by `requestId` — one API response is stored once per content block in the transcript, so a naive sum overcounts ~3x.
- Each session is stamped with the mode it **started** under; switch modes mid-session and it's tagged `mixed` and excluded from comparisons, so the on-vs-off numbers stay honest.
- The transcript format is internal to Claude Code and may change between versions. Numbers are estimates; `/usage` is the source of truth.
- No benchmark claims in this README until measured. Run `/shaman-bench` and get your own.

## Other tools (Cursor, Codex CLI, GitHub Copilot)

Run `/shaman-init` in a repo to generate:

| Tool | File | Coverage |
|------|------|----------|
| Cursor | `.cursor/rules/shaman.mdc` (`alwaysApply: true`) + `AGENTS.md` | static rules |
| Codex CLI | `AGENTS.md` | static rules |
| GitHub Copilot | `.github/copilot-instructions.md` + `AGENTS.md` | static rules |

The prompt gate and benchmarks need hooks, which only Claude Code wires up in v0.1. Cursor (`beforeSubmitPrompt`) and Codex CLI (`UserPromptSubmit`) both have hook systems with near-identical semantics — gate adapters for them are the v0.2 roadmap. Copilot has no hooks; static rules are its ceiling.

## Design principles (dogfooded)

- **No skills, no MCP server.** Skill descriptions cost context in every session; shaman is hooks + commands only. The entire injected ruleset is ~350 tokens — compare ~1–1.5k for comparable plugins.
- **Zero dependencies.** Plain Node stdlib. Nothing to install, nothing to audit.
- **Fail open.** Every hook wraps in try/catch and exits 0 on its own errors — a style plugin must never break your session.
- **No silent claims.** Benchmarks come from your transcripts, not our marketing.

## Credits

- [caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee (MIT) — the token-economy DNA and the SessionStart persistence pattern. Caveman's own benchmark reports ~65% average output-token reduction for this style; shaman claims nothing until your `/shaman-bench` says so.
- [ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert — the decision ladder and the lazy-senior-dev philosophy.
- Shaman adds the third pillar: gating the prompt itself.

## License

[MIT](LICENSE)
