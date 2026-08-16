# shaman benchmarks

Reproducible measurements for the three pillars. Every number in the main README's
"Real cases" section comes from running these scripts. No hand-typed results.

```
node bench/gate-bench.mjs       # prompt gate accuracy (deterministic, free)
node bench/footprint.mjs        # injected-ruleset token size + hook latency (free)
node bench/compress-bench.mjs   # talk-style output-token reduction (free)
node bench/live-ab.mjs [model]  # real end-to-end on/off A/B (spends tokens, see below)
```

Results are written to `bench/results/*.json`. Requires Node (any recent) and, for
the token-count scripts, Python with `tiktoken` (`pip install tiktoken`).

## What each measures

### 1. Prompt gate — `gate-bench.mjs` (deterministic, real, free)

Pipes a labeled corpus (`corpus/prompts.jsonl`, 44 prompts, EN+PT) through the **real**
`src/hooks/gate.js` and reads the outcome from the hook's actual contract: exit 2 =
blocked, `additionalContext` on stdout = enriched, silent exit 0 = passed. Each prompt
gets a unique `session_id` so the 3-minute block cooldown never hides a block; config is
isolated in a temp dir so your `~/.claude` state is untouched.

The gate is regex + structure checks with no API calls, so this is exact and fully
reproducible — same corpus in, same numbers out. The corpus is **hand-labeled by us**;
the honest metric is not "does the gate match its own logic" (trivially yes) but "does
its verdict match a human's judgment of whether the prompt is answerable."

Headline metrics: share of vague prompts caught (block or enrich), share of strong
prompts passed silently, and — the one that matters most for "never gets in your way" —
**false blocks on legitimate prompts** (strong tasks, questions, acknowledgements,
plain conversation). That number must be 0.

### 2. Ruleset footprint — `footprint.mjs` (real, free)

Runs the **real** `src/hooks/activate.js` for each mode and measures the exact size of
the context it injects at SessionStart. Char and word counts are exact; token counts use
`tiktoken` cl100k (OpenAI) as a **proxy** for Claude's tokenizer, which is not public —
expect within ~10-15%. Also isolates the gate's per-prompt latency from node's cold-start
floor (spawns an empty node process 20× for the baseline).

### 3. Talk compression — `compress-bench.mjs` (real measurement, free)

Measures output-token reduction on **matched-content pairs** (`corpus/pairs.jsonl`): the
same technical facts, code, and numbers on both sides, only the prose style differs
(default assistant prose vs shaman full). This measures the mechanism the "talk less"
pillar controls — the shape of the prose — **not** a live end-to-end session, whose
numbers depend on task, model, and tool use. The pairs are committed so anyone can judge
whether the default side is a fair, natural baseline (it is meant to be — not a strawman)
and re-measure.

### 4. Live A/B — `live-ab.mjs` (real end-to-end, spends tokens)

The only bench that calls the model. For each task in `corpus/tasks.jsonl` it runs
`claude -p` twice with the same model — once plain (plugin **off**), once with
`rules/core.md` appended as a system prompt (plugin **on**, matching what `activate.js`
injects) — and compares `usage.output_tokens`. For code tasks it also counts lines inside
the first fenced code block, so the "build less" pillar shows up as code volume.

**Run it from a plain terminal, not from inside a Claude Code session.** Claude Code
refuses to launch nested ("will crash all active sessions") unless `CLAUDECODE` is unset;
the harness unsets it for its child calls, but the guard exists for a reason. Small n —
treat a single run as directional, not a guarantee. `/usage` is the source of truth.

## Honesty notes

- Token counts from `tiktoken` are estimates for Claude; the transcript-derived numbers in
  `/shaman-bench` and `/usage` are the real per-session record.
- The compression corpus is authored to hold content constant across styles. It measures
  the style, not your specific workload. Run `/shaman-bench` for your own numbers.
- Comparisons are only meaningful across similar tasks.
