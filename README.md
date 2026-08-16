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
- The measured cases below come from the scripts in [`bench/`](bench/); `/shaman-bench` gives your own per-session numbers.

## Real cases (measured)

Every number here is produced by a script in [`bench/`](bench/) — run them and they overwrite `bench/results/*.json`. Token counts use `tiktoken` cl100k as a proxy for Claude's (non-public) tokenizer; treat as estimates within ~10-15%.

### Prompt gate — 44 prompts (EN+PT), zero false blocks

`node bench/gate-bench.mjs` runs a hand-labeled corpus through the **real** `gate.js` and reads each verdict from the hook's actual exit contract:

| category | n | blocked | enriched | passed |
|----------|---|---------|----------|--------|
| vague (`fix it`, `arruma isso`, `make it faster`) | 16 | 16 | 0 | 0 |
| medium (`add validation`, `escreve testes`) | 6 | 0 | 6 | 0 |
| strong (target + constraint) | 9 | 0 | 0 | 9 |
| questions | 5 | 0 | 0 | 5 |
| acknowledgements | 5 | 0 | 0 | 5 |
| plain conversation | 3 | 0 | 0 | 3 |

- **100%** of vague prompts caught — all 16 hard-blocked before a token is spent.
- **0 / 22** false blocks on legitimate prompts (strong tasks, questions, acks, conversation) — the "never gets in your way" promise holds on this corpus.
- **~93 ms** per prompt end-to-end (73 ms node cold-start + ~20 ms heuristic); the regex itself is sub-millisecond, no API call.

The corpus is ours and small: it shows the heuristic behaves as designed on clear-cut cases, not that it is perfect on every phrasing. Extend `bench/corpus/prompts.jsonl` and re-run.

### Talk economy — 47% fewer output tokens on matched content

`node bench/compress-bench.mjs` measures output tokens on 7 pairs holding technical content constant, default prose vs shaman full:

| response kind | default | shaman | saved |
|---|---|---|---|
| explanation | 119 | 63 | 47% |
| diagnosis | 99 | 60 | 39% |
| status update | 90 | 38 | 58% |
| recommendation | 111 | 62 | 44% |
| **pooled (7 pairs)** | **792** | **419** | **47%** |

Facts, code, and numbers are preserved by construction — the pairs live in `bench/corpus/pairs.jsonl` for inspection. This measures the **style**, not your workload; it is not a live session delta. (Caveman reports ~65% on its own corpus; shaman's rule "if terse isn't shorter, use plain" trades some compression for readability.)

### Footprint — 385 tokens, injected once

`node bench/footprint.mjs`: full **385**, lite 361, ultra 397, off 0 tokens (cl100k proxy) — injected once at SessionStart, not per turn.

### End-to-end + code generation — 8 live tasks, 3 trials each

`node bench/live-ab.mjs` is the only bench that calls the model. For each task in `bench/corpus/tasks.jsonl` it runs `claude -p` — plugin off, then on (`rules/core.md` appended as system prompt) — and compares real `output_tokens` plus lines across all emitted code blocks. Model output is high-variance, so each task runs 3 trials per side and the numbers below are means. One run, `claude-haiku-4-5`, ~$0.22:

| task | off tok | on tok | saved | off LOC | on LOC |
|---|---|---|---|---|---|
| debounce | 306 | 383 | −25% | 9.0 | 8.7 |
| slugify | 782 | 600 | 23% | 22.0 | 12.0 |
| retry helper | 681 | 648 | 5% | 34.7 | 19.3 |
| email validate | 728 | 577 | 21% | 22.3 | 8.7 |
| flatten array | 583 | 533 | 9% | 27.0 | 14.7 |
| read config | 836 | 686 | 18% | 31.3 | 20.7 |
| explain closure | 587 | 538 | 8% | – | – |
| explain index | 578 | 457 | 21% | – | – |
| **pooled mean** | **5081** | **4422** | **13%** | **146** | **84** |

- **~13% fewer output tokens** end-to-end — real but modest and noisy (debounce went the other way; per-task token ranges span ±30%). Code is incompressible by design — the ruleset never compresses code — so the savings come from the prose around it, not the code.
- **~43% fewer lines of code** across the 6 coding tasks (146 → 84), and every code task dropped. This is the "build less" pillar, and it is the more stable code-gen signal.

Concretely, the email task (22 → 9 lines, both correct, same regex): the off run wraps it in a multi-line docstring and a bulleted breakdown; the on run gives the same function with a one-line docstring, then adds the senior-dev call — *"if you need stricter validation (DNS checks, RFC 5322), use the `email-validator` package; for most cases regex is sufficient"* — pointing at the dependency instead of hand-rolling more.

Honest limits: one run, one model, small n, high variance — directional, not a guarantee. Fewer lines is only a win when correctness holds (spot-checked here; `bench/results/live.json` stores every trial and a sample output for inspection). And the ruleset trims prose more reliably than it prevents over-answering — on the array-flatten task both sides offered several variants. Re-run `bench/live-ab.mjs`, or use `/shaman-bench` on real sessions, for your own numbers.

## Other tools (Cursor, Codex CLI, GitHub Copilot)

Run `/shaman-init` in a repo to generate:

| Tool | File | Coverage |
|------|------|----------|
| Cursor | `.cursor/rules/shaman.mdc` (`alwaysApply: true`) + `AGENTS.md` | static rules |
| Codex CLI | `AGENTS.md` | static rules |
| GitHub Copilot | `.github/copilot-instructions.md` + `AGENTS.md` | static rules |

The prompt gate and benchmarks need hooks, which only Claude Code wires up in v0.1. Cursor (`beforeSubmitPrompt`) and Codex CLI (`UserPromptSubmit`) both have hook systems with near-identical semantics — gate adapters for them are the v0.2 roadmap. Copilot has no hooks; static rules are its ceiling.

## Design principles (dogfooded)

- **No skills, no MCP server.** Skill descriptions cost context in every session; shaman is hooks + commands only. The entire injected ruleset is ~385 tokens (measured, `bench/footprint.mjs`) — compare ~1–1.5k for comparable plugins.
- **Zero dependencies.** Plain Node stdlib. Nothing to install, nothing to audit.
- **Fail open.** Every hook wraps in try/catch and exits 0 on its own errors — a style plugin must never break your session.
- **No silent claims.** Benchmarks come from your transcripts, not our marketing.

## Credits

- [caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee (MIT) — the token-economy DNA and the SessionStart persistence pattern. Caveman's own benchmark reports ~65% average output-token reduction for this style; shaman measures ~47% on its own matched-content corpus (`bench/compress-bench.mjs`) and claims nothing more until your `/shaman-bench` says so.
- [ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert — the decision ladder and the lazy-senior-dev philosophy.
- Shaman adds the third pillar: gating the prompt itself.

## License

[MIT](LICENSE)
