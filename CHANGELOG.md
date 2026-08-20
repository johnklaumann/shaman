# Changelog

All notable changes to shaman. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-08-20

Verification release. The theme shifts from nudging tokens (which we measured at ~1% of real session cost) toward verifying the agent's output.

### Added
- **`verify` — a Stop hook that checks the agent's "done" against reality.** When a session edited code and the final message claims completion, it runs the repo's checks (opt-in via `.shaman.json` → `verify.checks`) and scans the edited files for high-severity issues (hardcoded secrets, interpolated SQL, `eval`/`new Function`, `shell=True`/`shell:true`, `os.system`, unsafe deserialization). A claim contradicted by a red check or a real finding is blocked (exit 2) with the evidence, so the agent keeps working instead of reporting done. Conservative by design: silent unless completion is explicitly claimed, WIP wording never blocks, findings in test files never block, each issue is confronted at most once per session, fully fail-open. Logged to `~/.claude/shaman/verify.jsonl`. Disable via `verify: "off"` in state.json or `.shaman.json`.
- **Convergence instrumentation** — the Stop hook (`bench.js`) now records per-session `callsBeforeFirstEdit`, `exploreCalls`, `readTokens`, and `repo`; `shaman bench` aggregates them (median, on-vs-off) alongside gate telemetry — band shares and confirm proceed-rate — from the new `gate.jsonl`.
- **`bench/autopsy.mjs`** — token autopsy over your real sessions, showing where cost actually goes (context ingest, not output).

### Changed
- Security scanner (`src/lib/scan.js`) is calibrated on a 649-file corpus of real agent-authored code: high-signal rules only, ~0.8% block rate versus a generic scanner's ~17% noise. `med`-severity rules (innerHTML, `yaml.load`, `new Function`) are logged but never block.

### Honest scope
- `verify` catches a false "done" only when it has a **mechanical** signal (a red check or a security finding). Behavioral or subjective incompleteness — "the UX isn't right", "these two parts don't interact well" — is out of reach and no automated check catches it. This is a verification aid at the agent→human boundary, in the spirit of CI/pre-commit, not a guarantee of correctness.

## [0.3.0] - 2026-08-18

### Added
- **`confirm` gate mode, now the default** — a weak prompt (score < 20) pauses the agent before any tokens are spent and shows the scorecard plus a preview of the exact context the gate would add; you resend to proceed with it, or rewrite. The resend lands within the block cooldown and falls through to enrich, so proceeding always injects that context. `enrich` (silent pass) and `coach` (hard block) are still available via `/shaman-gate`; `/shaman-gate off` disables the gate entirely. Existing installs keep whatever gate they had persisted — only fresh installs default to `confirm`.

### Changed
- `UserPromptSubmit` block path generalized to serve both `confirm` and `coach` (one cooldown, one write); CLI `score` and all docs describe the weak-prompt outcome as a pause-to-confirm by default

## [0.2.1] - 2026-08-17

### Added
- `/shaman ab` — self-measuring A/B mode: the plugin alternates whole-plugin on/off by calendar-day parity (gate included on off-days) and stamps each session with the arm it ran under, so `/shaman-bench` accumulates an honest personal on-vs-off comparison from normal work, zero discipline required

### Fixed
- Removed invalid `displayName` key from the Claude plugin manifest (broke `claude plugin install`)

## [0.2.0] - 2026-08-17

The "prove it" release: prompt scoring, any-tool support, and benchmarks with teeth.

### Added
- **Prompt score 0–100** with per-dimension breakdown (target/action/constraint/context/detail), one engine behind the gate hook, `/shaman-score`, and the CLI
- **CLI** `npx shaman-ai` — `score` (exit 2 on weak, scriptable anywhere), `init` (rule files for 8+ tools), `bench`
- **Generated adapters**: one canonical ruleset renders rule files for Cursor, Copilot, Windsurf, Cline, Kiro, Qoder, Codex/Gemini (AGENTS.md), Roo — drift impossible by construction, checked in CI
- **Codex support** via `.codex-plugin/plugin.json` reusing the same hooks
- **Subagent rules**: SubagentStart hook injects the ruleset into subagents
- **Benchmarks**: 57-prompt gate corpus (EN+PT, complex briefs, verbose-vague) run as a CI regression gate; tiered correctness-gated live A/B (adversarial asserts, self-tested against reference implementations); agentic benchmark (real multi-turn sessions with tools over a pinned fixture app, acceptance-checked); regenerable report
- **Test suite**: node:test, zero frameworks, Linux+Windows CI matrix
- Ruleset v2 folding in caveman v2 lessons (no invented abbreviations, no arrow chains, compression never adds words) and ponytail v4 lessons (understand-first, root-cause fixes, `shaman:` ceiling comments, one runnable check)

### Changed
- Gate block message is now a scorecard with filled/missing dimensions
- `/shaman-init` generates 8 tool files (was 3 static templates)

### Removed
- `templates/` directory (replaced by generated `adapters/`)

## [0.1.0] - 2026-08-16

Initial release: terse talk (caveman DNA), decision ladder (ponytail DNA), prompt gate (coach/enrich), per-session token benchmarks, static rule files for Cursor/Codex/Copilot.

[Unreleased]: https://github.com/johnklaumann/shaman/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/johnklaumann/shaman/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/johnklaumann/shaman/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/johnklaumann/shaman/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/johnklaumann/shaman/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/johnklaumann/shaman/releases/tag/v0.1.0
