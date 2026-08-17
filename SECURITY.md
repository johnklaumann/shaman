# Security Policy

## What shaman runs on your machine

- Three Node hooks (SessionStart/SubagentStart, UserPromptSubmit, Stop) and a CLI — all plain Node stdlib, **zero dependencies**, no network calls, no telemetry.
- The prompt gate is local regex; your prompts never leave your machine because of shaman.
- State lives in `~/.claude/shaman/` (mode, gate, per-session bench snapshots).
- Every hook fails open (try/catch, exit 0) so a shaman bug can never block your session.

## Supported versions

Latest minor release. Older versions: upgrade.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/johnklaumann/shaman/security/advisories/new) on GitHub. Please do not open public issues for exploitable problems. Expect an acknowledgment within a week.

In scope: anything that makes the hooks execute unexpected code, exfiltrate prompt content, corrupt state outside `~/.claude/shaman/`, or bypass the fail-open guarantee.
