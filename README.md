# shaman

> Tribe elder for your AI agent. Speaks little. Builds less. Blocks the bad hunt before it starts.

Three pillars in one plugin:

1. **Talk less** — terse output that cuts the fat, never the facts (caveman DNA)
2. **Build less** — decision ladder before any code: YAGNI > reuse > stdlib > native > installed dependency > one line > minimum build. Root-cause fixes, no over-engineering, best practices always (ponytail DNA)
3. **Score the prompt** — the part nobody else does. A local hook scores every prompt **0–100** *before it reaches the model*. Weak prompt? Blocked with a scorecard showing exactly which dimension to fill — zero tokens spent — or enriched so the model states its assumptions and asks exactly one clarifying question instead of guessing.

Plus **benchmarks**: per-session token stats so you can see the difference instead of believing a README.

Most engineers don't have a token problem. They have a prompt problem that presents as a token problem. Shaman fixes both ends: the prompt going in, the code and prose coming out.

## The score

```
$ npx shaman-ai score "fix it"
score 20/100 · weak — would be blocked in coach mode

  target     ░░░░░░  0/30   name a file, function, or paste the error text
  action     ██████ 20/20   action verb present
  constraint ░░░░░░  0/20   add "must / should / keep / without..." criteria
  context    ░░░░░░  0/15   describe current vs expected behavior
  detail     ░░░░░░  0/15   add specifics: numbers, names, exact messages

$ npx shaman-ai score "Fix token expiry in auth/middleware.ts — expired tokens still pass. Must reject with 401."
score 93/100 · strong — passes silently
```

Five dimensions, one number, concrete suggestions. The same engine drives the gate hook, `/shaman-score`, and the CLI — local regex + structure checks, no API call, English + Portuguese. Works with **any tool and any model**, because scoring happens before the model is involved.

## Install

**Claude Code** (hooks: gate + scoring + per-session benchmarks + subagent rules):

```
claude plugin marketplace add johnklaumann/shaman
claude plugin install shaman@shaman
```

**Codex CLI** (same hooks — the plugin ships a Codex manifest):

```
codex plugin marketplace add johnklaumann/shaman
codex plugin add shaman@shaman
```

**Any other tool / any model** (Cursor, Copilot, Windsurf, Cline, Kiro, Qoder, Gemini CLI, Roo — static ruleset, generated into your repo):

```
npx shaman-ai init
```

Requires Node.js ≥ 18. Zero dependencies.

## Commands

| Command | What it does |
|---------|--------------|
| `/shaman [lite\|full\|ultra\|off]` | Talk level. `full` (default) drops articles, allows fragments. `lite` keeps full sentences. `ultra` — one word when one word enough. |
| `/shaman-gate [coach\|enrich\|off]` | Prompt gate. `coach` blocks weak prompts (score < 20) before they burn tokens. `enrich` (default) lets them pass but injects the score + forces stated assumptions + max one clarifying question. |
| `/shaman-score <prompt>` | Score a prompt 0–100 with the dimension breakdown, without sending it. |
| `/shaman-bench` | Token stats per session, split by mode — your own numbers, on vs off. |
| `/shaman-init` | Generate rule files for 8 other tools in the current repo. |
| `/shaman-help` | Quick reference card. |

CLI twins for any environment: `npx shaman-ai score "..."` (exit 2 on weak — scriptable), `npx shaman-ai init`, `npx shaman-ai bench`.

## The prompt gate

`"fix it"` → **blocked** (coach mode), before a single token is spent — stderr shows the scorecard above plus a rewrite example.

Design constraints, so it never gets in your way:

- Strong prompts pass **silently** — zero overhead, nothing injected. A prompt that names a target and an action is strong by structure, even when short (`update README.md with the install steps`).
- Never gated: slash commands, questions (enriched at most, never blocked), acknowledgements ("yes", "sounds good, go ahead", "pode"), and anything with neither an action verb nor a code/file reference — no action and no target means conversation, not a task.
- Coach blocks at most once per 3 minutes per session, then falls back to enrich. No block loops.
- Local heuristic: regex + structure checks, no API calls, fails open on its own errors.

Why not rewrite the prompt automatically? Claude Code's `UserPromptSubmit` hook [can block or inject context, but cannot replace the prompt](https://code.claude.com/docs/en/hooks) — and that's the better design anyway: coach mode teaches you to write better prompts; silent rewriting would teach you nothing.

## vs caveman & ponytail

Shaman stands on their shoulders — both are credited below, and their best hard-won rules are folded into shaman's ruleset. Honest positioning:

| | [caveman](https://github.com/JuliusBrussee/caveman) | [ponytail](https://github.com/DietrichGebert/ponytail) | **shaman** |
|---|---|---|---|
| Focus | terse prose + input compression (Go proxy, 26 compressors) | minimal code (decision ladder) | both pillars + **prompt scoring** |
| Prompt gate / scoring | — | — | **0–100 score, block/enrich, CLI** |
| Per-session user benchmarks | `/caveman-stats` | — (published medians only) | `/shaman-bench` on your transcripts |
| Multi-tool rules | 40+ agents, hand-written profiles | 20+ tools, 16 hand-synced copies + CI check | 8+ tools, **generated from one source** — drift impossible by construction |
| Injected ruleset size | ~1–1.5k tokens/turn (their own honest number) | ~750 tokens | **642 tokens, once per session** (measured) |
| Runtime deps | Go binaries + SQLite for proxy features | zero (Node hooks) | **zero** (Node stdlib only) |
| Their headline | 65% output-token cut (10-prompt bench) | −54% LOC, 100% safe (real agentic bench) | measured below, smaller n — no inflated claims |

If you want maximum input-token compression infrastructure, caveman is the deep stack. If you want the most battle-tested code-minimalism benchmark, ponytail's agentic suite is the reference. If you want both disciplines plus the only gate that scores your prompt before it costs you anything — that's shaman.

## Benchmarks

A `Stop` hook parses the session transcript and appends a snapshot to `~/.claude/shaman/bench.jsonl`: input/output/cache tokens, request count, mode, gate. `/shaman-bench` aggregates and compares modes.

Honesty notes:

- Usage is deduplicated by `requestId` — one API response is stored once per content block in the transcript, so a naive sum overcounts ~3x.
- Each session is stamped with the mode it **started** under; switch modes mid-session and it's tagged `mixed` and excluded from comparisons.
- The transcript format is internal to Claude Code and may change between versions. Numbers are estimates; `/usage` is the source of truth.
- The measured cases below come from the scripts in [`bench/`](bench/); `/shaman-bench` gives your own per-session numbers.

## Real cases (measured)

Every number here is produced by a script in [`bench/`](bench/) — run them and they overwrite `bench/results/*.json`. Token counts use `tiktoken` cl100k as a proxy for Claude's (non-public) tokenizer; treat as estimates within ~10-15%.

### Prompt gate — 57 prompts (EN+PT) including complex briefs, zero false blocks

`node bench/gate-bench.mjs` runs a hand-labeled corpus through the **real** `gate.js` and reads each verdict from the hook's actual exit contract:

| category | n | blocked | enriched | passed |
|----------|---|---------|----------|--------|
| vague (`fix it`, `arruma isso`, `make it faster`) | 16 | 16 | 0 | 0 |
| underspecified (`add validation`, `escreve testes`) | 6 | 0 | 6 | 0 |
| **verbose-but-vague** (long "modernize everything" asks) | 5 | 0 | 5 | 0 |
| strong (target + constraint) | 9 | 0 | 0 | 9 |
| **complex multi-requirement briefs** (rate-limit + headers + isolation, zero-downtime UUID migration, SKIP LOCKED race fix...) | 8 | 0 | 0 | 8 |
| questions / acks / conversation | 13 | 0 | 0 | 13 |

- **100%** of vague prompts caught, all hard-blocked before a token is spent; verbose-but-vague all enriched — word count alone never buys a silent pass.
- **100%** of strong prompts pass silently, including every complex multi-requirement brief — the gate scales up without friction.
- **0 / 41** false blocks on legitimate prompts.
- **~68 ms** per prompt end-to-end (mostly node cold-start); the scoring itself is sub-millisecond, no API call.
- This exact suite runs in CI (`--ci`): one false block fails the build.

The corpus is ours: it shows the heuristic behaves as designed on clear-cut cases, not that it is perfect on every phrasing. Extend `bench/corpus/prompts.jsonl` and re-run.

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

### Footprint — 642 tokens, injected once

`node bench/footprint.mjs`: full **642**, lite 618, ultra 654, off 0 tokens (cl100k proxy) — injected once at SessionStart (and to each subagent), not per turn. Roughly half of caveman's ~1–1.5k skill overhead; the delta vs v0.1's 385 bought the root-cause rule, the shortcut-marking convention, and the anti-abbreviation rule, each of which pays for itself in avoided rework.

### Code generation — 14 live tasks in 3 tiers, correctness-gated

`node bench/live-ab2.mjs` is the professional run and the only bench that calls the model. 14 tasks (`bench/corpus/tasks2.jsonl`) in three tiers — 4 small utilities, 6 medium components (LRU cache, rate limiter, RFC 4180 CSV parser...), 4 large modules (TODO store with validation, layered config loader, state machine...) — each with an explicit export contract, identical for both arms. Every trial's code is **executed against adversarial asserts** (`bench/checks.mjs`: quoted-CSV edge cases, LRU eviction order, per-key rate-limit isolation, invalid-input rejection). A smaller answer that fails its gate is a loss, not a saving. Every gate is self-tested against committed reference implementations in CI before any API spend.

One run, `claude-haiku-4-5`, 3 trials/arm, $0.65:

| tier | tasks | output tokens | saved | LOC | correctness off → on | time/task |
|---|---|---|---|---|---|---|
| small | 4 | 1995 → 1925 | 4% | 47 → 42 | 92% → **100%** | 7.9s → 8.7s |
| medium | 6 | 10059 → 8306 | **17%** | 175 → 155 | 94% → 94% | 19.0s → 17.1s |
| large | 4 | 8776 → 6615 | **25%** | 130 → 118 | 92% → 92% | 23.5s → 19.8s |
| **all** | **14** | **20831 → 16846** | **19%** | **352 → 315 (−11%)** | **93% → 95%** | **17.1s → 15.4s** |

The three findings that matter:

- **Savings grow with task size** — 4% on small tasks, 17% on medium, 25% on large. The bigger the task, the more prose, options, and boilerplate there is to not write. This is where a real workload lives.
- **Correctness never paid for it** — 95% pass rate with shaman on vs 93% off (84 gated executions per arm). Small tier went to 100%. "Build less" here means fewer comment lines (25 → 13) and fewer speculative variants, not fewer guards — the adversarial gates (path isolation, eviction order, quote escaping) still pass.
- **Faster too** — mean time per task dropped 17.1s → 15.4s; fewer output tokens is also less generation time.

Honest limits: one model, n=3, high per-task variance (a task can swing ±30% between runs — see per-task ranges in `bench/results/live2.json`, which stores every trial, failure reason, and a sample per arm). The 5 remaining gate failures (of 168 executions) are genuine model errors, quoted verbatim in the results file. Directional, not a guarantee. Full breakdown: [`bench/results/REPORT.md`](bench/results/REPORT.md). Rerun `bench/live-ab2.mjs`, or `/shaman-bench` on real sessions, for your own numbers.

## Other tools

`/shaman-init` (or `npx shaman-ai init`) generates rule files for:

| Tool | File |
|------|------|
| Codex CLI, Gemini CLI, generic agents | `AGENTS.md` |
| Cursor | `.cursor/rules/shaman.mdc` (`alwaysApply: true`) |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurf/rules/shaman.md` |
| Cline | `.clinerules/shaman.md` |
| Kiro | `.kiro/steering/shaman.md` (`inclusion: always`) |
| Qoder | `.qoder/rules/shaman.md` |
| Roo / generic | `.agents/rules/shaman.md` |

All eight are **generated from `rules/core.md`** by `src/lib/adapters.js` — one canonical ruleset, no hand-synced copies, and CI fails if the committed adapters drift from the source. The gate, scoring, and per-session benchmarks need hooks: Claude Code and Codex get them via the plugin; everything else gets the static ruleset plus `npx shaman-ai score` for manual gating.

## Design principles (dogfooded)

- **No skills, no MCP server.** Skill descriptions cost context in every session; shaman is hooks + commands only. The injected ruleset is 642 tokens (measured, `bench/footprint.mjs`), once per session.
- **Zero dependencies.** Plain Node stdlib — engine, hooks, CLI, tests. Nothing to install, nothing to audit.
- **One source of truth.** Every tool adapter is generated from `rules/core.md`; the scoring engine behind the hook, the command, and the CLI is one module.
- **Fail open.** Every hook wraps in try/catch and exits 0 on its own errors — a style plugin must never break your session.
- **Tested and gated.** 59 tests (`node --test`, zero frameworks) including self-tests for every benchmark correctness gate, CI on Linux + Windows × Node 20/22/24, and the gate benchmark runs as a regression gate: one false block fails the build.
- **No silent claims.** Benchmarks come from committed scripts and your own transcripts, not our marketing.

## Credits

- [caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee (MIT) — the token-economy DNA and several hard-won rules folded into shaman v0.2: never invent abbreviations (the tokenizer splits them — zero saved), no arrow chains, compression must never add words. Caveman's own benchmark reports ~65% output reduction; shaman measures ~47% on its matched-content corpus and claims nothing more until your `/shaman-bench` says so.
- [ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert (MIT) — the decision ladder and the lazy-senior-dev philosophy, plus v0.2 refinements from ponytail v4: understand before you climb, root-cause over symptom, deliberate shortcuts marked with their ceiling, non-trivial logic leaves one runnable check.
- Shaman adds the third pillar neither has: scoring the prompt itself.

## License

[MIT](LICENSE)
