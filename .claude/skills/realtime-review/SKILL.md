---
name: realtime-review
description: Review HomeSpace chat and real-time messaging changes for authorization, delivery, duplicate events, ordering, persistence and regressions. Use when explicit real-time code review is requested.
---

# realtime-review (Claude Code adapter for hs-chat-service)

This is an adapter. It does not contain the workflow itself. The source workflow is the Codex skill at:

```text
../../../.agents/skills/realtime-review/SKILL.md
```

(relative to this directory; it resolves to `.agents/skills/realtime-review/SKILL.md` in the `hs-chat-service` repository root).

Claude Code does not import that file automatically. When this skill is triggered:

1. Read the source file above with the Read tool.
2. Follow its workflow exactly, together with the `AGENTS.md` rules of this repository.
3. The source skill has no `references/` or `scripts/` directories. If they are added later, read them from the source skill directory when the workflow requires them.
