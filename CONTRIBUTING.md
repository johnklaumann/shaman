# Contributing

Shaman practices what it injects: zero dependencies, minimum code, no unverified claims. PRs are welcome when they hold that line.

## Ground rules

- **Zero runtime dependencies.** Node stdlib only — engine, hooks, CLI, tests, benches. A PR that adds a dependency needs an argument the decision ladder can't beat.
- **Every behavior claim is tested.** `npm test` (node:test, no frameworks). The gate corpus (`bench/corpus/prompts.jsonl`) is the scoring contract — if you change lexicons or thresholds, the corpus tells you what broke.
- **No benchmark numbers by hand.** Numbers in the README come from `bench/` scripts writing `bench/results/*.json`, and `node bench/report.mjs` regenerates the report. PRs editing result numbers without the script run are rejected.
- **Rules have one source.** Edit `rules/core.md`, then `node scripts/build-adapters.mjs`. CI fails if `adapters/` drifts.

## Good first contributions

- **Grow the gate corpus**: add labeled prompts (especially real vague/strong prompts from your own usage, any supported language) to `bench/corpus/prompts.jsonl`. CI enforces the invariants: 100% vague caught, 0 false blocks.
- **New language lexicons**: verbs/constraints/questions arrays in `src/lib/score.js` are designed for extension (bounded stems so English decoys don't match).
- **New tool adapters**: add an entry to `src/lib/adapters.js` TOOLS.

## Workflow

```
npm test                              # 60+ tests, must be green
node scripts/build-adapters.mjs --check
node bench/gate-bench.mjs --ci        # the promise: 0 false blocks
```

Run all three before opening a PR (CI runs them anyway). Keep diffs small; deletion beats addition; state what you verified in the PR description.

## Releases (maintainers)

1. Update CHANGELOG.md, bump the version in `package.json` + `.claude-plugin/plugin.json` + `.codex-plugin/plugin.json` (CI's version-sync check enforces agreement)
2. Tag `vX.Y.Z` and push the tag — the release workflow runs tests, checks, publishes to npm with provenance, and creates the GitHub Release
