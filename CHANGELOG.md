# Changelog

All notable changes to shaman. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/johnklaumann/shaman/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/johnklaumann/shaman/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/johnklaumann/shaman/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/johnklaumann/shaman/releases/tag/v0.1.0
