---
name: realtime-review
description: Review HomeSpace chat and real-time messaging changes for authorization, delivery, duplicate events, ordering, persistence and regressions. Use when explicit real-time code review is requested.
disable-model-invocation: true
---

# Real-Time Messaging Review

## Mode

Review-only.

## Checklist

- Conversation authorization
- Message ownership
- Event payload consistency
- Duplicate message handling
- Retry behavior
- Message ordering
- Persistence correctness
- Reconnection handling
- Sensitive data exposure

## Verification

Inspect affected handlers and services first.

Use targeted tests where necessary.

Do not start all infrastructure by default.

Avoid unrelated review findings.

## Output

Report confirmed or credible defects with severity, location, failure scenario and proposed fix.
