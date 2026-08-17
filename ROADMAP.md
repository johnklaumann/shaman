# Roadmap — from "directional" to "close to 100%"

Confidence-driven: each line names the current evidence gap, the action that closes it,
and what it costs. Checked items are done and verifiable in this repo.

## Tier 1 — gate quality (high confidence, keep it there)

- [x] 57-prompt labeled corpus (EN+PT) incl. complex multi-requirement briefs and verbose-but-vague — 100% catch, 0 false blocks, in CI as a regression gate
- [x] Score engine unit-tested against the corpus as a contract (59 tests)
- [ ] Community corpus growth: accept PRs adding labeled prompts; CI keeps 0-false-blocks invariant
- [ ] Spanish verb/constraint lexicons (structure already supports it) — v0.3

## Tier 2 — single-shot token savings (moderate → high)

- [x] Tiered, correctness-gated live A/B (14 tasks, 3 tiers, adversarial asserts, self-tested gates)
- [x] n=10 trials on haiku (280 calls, $2.15): 7% pooled token savings, LOC −12%, correctness 93.6% → 95.7% (large tier 82.5% → 90.0%) — bench/results/live2.json
- [ ] Second model (sonnet) single run — pricing differs 6x, one command: `node bench/live-ab2.mjs claude-sonnet-4-6 3` (~$4)
- [x] Bootstrap 95% CI on pooled savings in the report (cluster-resample by task)

## Tier 3 — whole-session agentic savings (the honest gap → measured)

- [x] Agentic benchmark run (6 tickets × 2 arms × 2 trials, haiku, $1.55): completion
      100%/100%, session cost −17%, output tokens −22%, session time −28%, cache reads
      −16% — bench/results/agentic.json. Real multi-turn Claude Code sessions with tools over a pinned
      fixture app (`bench/fixtures/notes-api`, zero-dep node app + tests), 6 real tickets
      (bugfix, features over HTTP API, validation, dedup refactor), off vs on,
      measuring TOTAL session tokens (input + output + cache-write), cost, wall time,
      diff LOC — and completion: fixture test suite + per-task hidden acceptance checks
      run after every session
- [x] Acceptance checks self-tested: all must FAIL on the pristine fixture (they test the
      delta) and the fixture suite must pass at baseline — runs in CI, before any API spend
- [ ] Scale to n=4 trials + sonnet arm once the n=2 haiku picture is stable
- [ ] Two-week real-usage collection via `/shaman-bench` (the plugin's own per-session data)

## Release & pipeline (caveman-parity where it matters, zero-dep where it doesn't)

- [x] CI: 59+ tests, Linux+Windows × Node 20/22/24, adapter-drift check, gate regression suite
- [x] npm package `shaman-ai` with `files` allowlist and bin
- [x] Release workflow: tag → tests → npm publish with provenance + GitHub Release with notes
- [x] Version-sync check (package.json = plugin.json = .codex-plugin) in CI
- [x] CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, issue/PR templates
- [ ] npm Trusted Publishing setup (one-time, on npmjs.com; workflow already OIDC-ready)
- [ ] Marketplace listings: Claude Code (done via repo), Codex, opencode plugin — v0.3
- Deliberately NOT doing (our own ladder applied): Go engine/proxy, binary releases,
  browser extension, cloud service. Zero-dep JS needs none of it; caveman's 85k-LOC
  proxy is its moat and its maintenance burden. Ours is the score engine + honesty.

## Cost ledger (API spend on benchmarks, this repo)

| run | spend |
|---|---|
| live A/B v1 (8 tasks × 3) | $0.22 |
| live A/B v2 dev iterations (2 discarded runs, artifacts diagnosed) | $1.48 |
| live A/B v2 definitive (84 calls) | $0.65 |
| agentic 6 tickets × 2 arms × 2 trials | see bench/results/agentic.json |
| live A/B v2 n=10 (280 calls) | see bench/results/live2.json |
