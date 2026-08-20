# shaman

[![CI](https://github.com/johnklaumann/shaman/actions/workflows/ci.yml/badge.svg)](https://github.com/johnklaumann/shaman/actions/workflows/ci.yml)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> Tribe elder for your AI agent. Speaks little. Builds less. Scores the prompt before it costs you — and checks the work before it says "done".

Four capabilities in one plugin:

1. **Talk less** — terse output that cuts the fat, never the facts (caveman DNA)
2. **Build less** — decision ladder before any code: YAGNI > reuse > stdlib > native > installed dependency > one line > minimum build. Root-cause fixes, no over-engineering, best practices always (ponytail DNA)
3. **Score the prompt** — the part nobody else does. A local hook scores every prompt **0–100** *before it reaches the model*. Weak prompt? By default the agent **pauses** and shows you the scorecard plus a preview of the context it would add — resend to proceed, or rewrite. Want it stricter or quieter? `coach` blocks outright; `enrich` passes silently and just makes the model state its assumptions and ask one clarifying question instead of guessing.
4. **Verify the "done"** *(new in v0.4.0)* — a `Stop` hook that, when the agent claims completion after editing code, runs your project's checks and scans the changed files for high-severity issues (secrets, injection, unsafe `eval`/`shell`). A "done" contradicted by a red check or a real finding is **blocked with the evidence** — the agent keeps working instead of handing you a false done.

Plus **benchmarks**: per-session token stats so you can see the difference instead of believing a README.

Most engineers don't have a token problem. They have a prompt problem that presents as a token problem. Shaman works both ends — the prompt going in, the code and prose coming out — and then checks the "done" before you trust it.

## The score

```
$ npx github:johnklaumann/shaman score "fix it"
score 20/100 · weak — would be blocked in coach mode

  target     ░░░░░░  0/30   name a file, function, or paste the error text
  action     ██████ 20/20   action verb present
  constraint ░░░░░░  0/20   add "must / should / keep / without..." criteria
  context    ░░░░░░  0/15   describe current vs expected behavior
  detail     ░░░░░░  0/15   add specifics: numbers, names, exact messages

$ npx github:johnklaumann/shaman score "Fix token expiry in auth/middleware.ts — expired tokens still pass. Must reject with 401."
score 93/100 · strong — passes silently
```

Five dimensions, one number, concrete suggestions. The same engine drives the gate hook, `/shaman-score`, and the CLI — local regex + structure checks, no API call, English + Portuguese. Works with **any tool and any model**, because scoring happens before the model is involved.

## Install

**Claude Code** (hooks: gate + scoring + verify + per-session benchmarks + subagent rules):

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
npx github:johnklaumann/shaman init
```

Requires Node.js ≥ 18. Zero dependencies.

## Commands

| Command | What it does |
|---------|--------------|
| `/shaman [lite\|full\|ultra\|ab\|off]` | Talk level. `full` (default) drops articles, allows fragments. `lite` keeps full sentences. `ultra` — one word when one word enough. `ab` — self-measuring A/B: alternates whole-plugin on/off by calendar-day parity and auto-stamps each session's arm, so `/shaman-bench` builds your own on-vs-off numbers from normal work. |
| `/shaman-gate [confirm\|coach\|enrich\|off]` | Prompt gate. `confirm` (default) pauses weak prompts (score < 20) and previews the context it will add — resend to proceed. `coach` blocks them outright. `enrich` passes silently, injecting the score + forcing stated assumptions + max one clarifying question. |
| `/shaman-score <prompt>` | Score a prompt 0–100 with the dimension breakdown, without sending it. |
| `/shaman-bench` | Token stats per session, split by mode — your own numbers, on vs off. |
| `/shaman-init` | Generate rule files for 8 other tools in the current repo. |
| `/shaman-help` | Quick reference card. |

CLI twins for any environment: `npx github:johnklaumann/shaman score "..."` (exit 2 on weak — scriptable), `npx github:johnklaumann/shaman init`, `npx github:johnklaumann/shaman bench`.

## The prompt gate

`"fix it"` → **paused** (confirm mode, the default) before a single token is spent — stderr shows the scorecard above plus a preview of the context it will add; resend to proceed, or rewrite. Switch to `coach` and the same prompt is blocked outright with a rewrite example.

Design constraints, so it never gets in your way:

- Strong prompts pass **silently** — zero overhead, nothing injected. A prompt that names a target and an action is strong by structure, even when short (`update README.md with the install steps`).
- Never gated: slash commands, questions (enriched at most, never blocked), acknowledgements ("yes", "sounds good, go ahead", "pode"), and anything with neither an action verb nor a code/file reference — no action and no target means conversation, not a task.
- Confirm and coach interrupt at most once per 3 minutes per session, then the resend falls through to enrich. No block loops.
- Local heuristic: regex + structure checks, no API calls, fails open on its own errors.

Why not rewrite the prompt automatically? Claude Code's `UserPromptSubmit` hook [can block or inject context, but cannot replace the prompt](https://code.claude.com/docs/en/hooks) — and that's the better design anyway: confirm and coach show you what was thin so you learn to write it stronger; silent rewriting would teach you nothing.

## Verify the "done"

`"All fixed, tests pass."` — but are they? When a session **edited code** and the agent's final message **claims completion**, a `Stop` hook checks that claim against reality. A "done" contradicted by a red check or a real finding is **blocked (exit 2)** with the evidence, so the agent keeps working instead of reporting done.

Two checks:

- **Your project's checks** (opt-in) — configure `.shaman.json` at the repo root:
  ```json
  { "verify": { "checks": ["npm test", "npm run lint"] } }
  ```
  A non-zero exit while the agent claims done → blocked.
- **Security/quality scan** (always on) — the edited files, high-severity only: hardcoded secrets, interpolated SQL, `eval` / `new Function`, `shell=true` / `os.system`, unsafe deserialization. Calibrated on a 649-file corpus of real agent-authored code — **~0.8% block rate**, not the ~17% noise of a generic scanner. Findings in test files never block.

Conservative by design, same as the gate: silent unless completion is explicitly claimed, WIP wording ("still failing", "next step") never blocks, one confrontation per issue per session, fail-open. Findings logged to `~/.claude/shaman/verify.jsonl`. Disable with `verify: "off"` in `.shaman.json` or state.json.

**Honest scope.** Verify catches a false "done" only when it has a *mechanical* signal — a red check or a security finding. Subjective or behavioral incompleteness ("the UX isn't right", "these two parts don't talk to each other") is out of reach; no automated check catches that. This is a verification aid at the agent→human boundary, in the spirit of CI / pre-commit — not a correctness guarantee.

## vs caveman & ponytail

Shaman stands on their shoulders — both are credited below, and their best hard-won rules are folded into shaman's ruleset. Honest positioning:

| | [caveman](https://github.com/JuliusBrussee/caveman) | [ponytail](https://github.com/DietrichGebert/ponytail) | **shaman** |
|---|---|---|---|
| Focus | terse prose + input compression (Go proxy, 26 compressors) | minimal code (decision ladder) | both pillars + **prompt scoring** |
| Prompt gate / scoring | — | — | **0–100 score, block/enrich, CLI** |
| Verify the agent's "done" | — | — | **checks + security scan on a completion claim** |
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

**n=10 trials per arm** (280 calls, `claude-haiku-4-5`, $2.15) — large enough that single-run noise stops dominating:

| tier | tasks | output tokens | saved | LOC | correctness off → on | time/task |
|---|---|---|---|---|---|---|
| small | 4 | 2120 → 1818 | **14%** | 41 → 40 | 97.5% → **100%** | 8.0s → 7.6s |
| medium | 6 | 9294 → 8848 | 5% | 175 → 151 | 98.3% → 96.7% | 18.3s → 18.6s |
| large | 4 | 7168 → 6700 | 7% | 129 → 111 | 82.5% → **90.0%** | 20.6s → 20.2s |
| **all** | **14** | **18582 → 17366** | **7%** | **344 → 302 (−12%)** | **93.6% → 95.7%** | **16.0s → 15.9s** |

The three findings that matter:

- **Single-shot token savings are real but modest: ~7% pooled** (95% CI in the report). Earlier n=3 runs of this same suite gave 19% and 1% — that spread is why we ran n=10 and report the CI instead of cherry-picking. Anyone quoting a single n=3 run at you is selling.
- **Correctness improves, and most where it's hardest** — 95.7% vs 93.6% overall (140 gated executions per arm), and on the large tier **90.0% vs 82.5%**: the discipline rules help the model finish hard tasks correctly more often. "Build less" means comment lines halved (23 → 12) and fewer speculative variants — not fewer guards; the adversarial gates (eviction order, quote escaping, per-key isolation) still pass.
- **12% less code at equal-or-better correctness** — the ponytail thesis, reproduced independently at smaller scale.

Honest limits: one model, per-task variance still visible at n=10 (`bench/results/live2.json` stores every trial, failure reason, and a sample per arm; failures are genuine model errors, quoted verbatim). Full breakdown incl. bootstrap CI: [`bench/results/REPORT.md`](bench/results/REPORT.md). Rerun `bench/live-ab2.mjs`, or `/shaman-bench` on real sessions, for your own numbers.

### Whole-session agentic — the number that actually hits your bill

Single-shot benches miss where real cost lives: multi-turn sessions re-reading context every turn. `node bench/agentic.mjs` runs **real Claude Code sessions with tools** (read/edit/bash) over a pinned zero-dep fixture app (`bench/fixtures/notes-api`), one ticket per session — bugfix with a seeded root cause, three HTTP features, input hardening, a dedup refactor. Each session's work is verified twice: the fixture test suite must stay green AND a black-box acceptance check must pass (every check is proven in CI to fail on the pristine fixture — a check that passes before the work is done measures nothing). Isolated per session: own workspace, own git repo, `--setting-sources project,local` so no user-level plugins contaminate either arm.

6 tickets × 2 arms × 2 trials, `claude-haiku-4-5`, $1.55:

| metric | off | on | delta |
|---|---|---|---|
| **completion (verified)** | **100%** | **100%** | 24/24 sessions each arm |
| **session cost** (the bill) | $0.424 | $0.353 | **−17%** |
| output tokens | 23202 | 17999 | −22% |
| total input+output+cache-write | 94383 | 81983 | −13% |
| cache reads | 1.98M | 1.66M | −16% |
| mean session time | 87s | 63s | **−28%** |
| turns (e.g. feat-delete) | 24.0 | 15.5 | fewer round-trips |

This is the mechanism single-shot benches can't see: terse output means **fewer and shorter turns**, and every turn avoided is a full context re-read avoided — that's why cache reads drop 16% and sessions finish 28% faster at identical completion. The savings compound in agentic work instead of shrinking.

Limits: small fixture app (5 files), 6 tickets, n=2, one model — the shape of the result (cost down, completion held) matters more than the exact percentages. Scale it up with `node bench/agentic.mjs claude-haiku-4-5 4`.

## Other tools

`/shaman-init` (or `npx github:johnklaumann/shaman init`) generates rule files for:

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

All eight are **generated from `rules/core.md`** by `src/lib/adapters.js` — one canonical ruleset, no hand-synced copies, and CI fails if the committed adapters drift from the source. The gate, scoring, and per-session benchmarks need hooks: Claude Code and Codex get them via the plugin; everything else gets the static ruleset plus `npx github:johnklaumann/shaman score` for manual gating.

## Design principles (dogfooded)

- **No skills, no MCP server.** Skill descriptions cost context in every session; shaman is hooks + commands only. The injected ruleset is 642 tokens (measured, `bench/footprint.mjs`), once per session.
- **Zero dependencies.** Plain Node stdlib — engine, hooks, CLI, tests. Nothing to install, nothing to audit.
- **One source of truth.** Every tool adapter is generated from `rules/core.md`; the scoring engine behind the hook, the command, and the CLI is one module.
- **Fail open.** Every hook wraps in try/catch and exits 0 on its own errors — a style plugin must never break your session.
- **Tested and gated.** 102 tests (`node --test`, zero frameworks) including the verify hook, the security scanner, and self-tests for every benchmark correctness gate; CI on Linux + Windows × Node 20/22/24, and the gate benchmark runs as a regression gate: one false block fails the build.
- **No silent claims.** Benchmarks come from committed scripts and your own transcripts, not our marketing.

## Credits

- [caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee (MIT) — the token-economy DNA and several hard-won rules folded into shaman v0.2: never invent abbreviations (the tokenizer splits them — zero saved), no arrow chains, compression must never add words. Caveman's own benchmark reports ~65% output reduction; shaman measures ~47% on its matched-content corpus and claims nothing more until your `/shaman-bench` says so.
- [ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert (MIT) — the decision ladder and the lazy-senior-dev philosophy, plus v0.2 refinements from ponytail v4: understand before you climb, root-cause over symptom, deliberate shortcuts marked with their ceiling, non-trivial logic leaves one runnable check.
- Shaman adds what neither has: scoring the prompt itself (v0.2), and verifying the agent's "done" against your checks plus a security scan (v0.4).

## License

[MIT](LICENSE)
