# HomeSpace Chat Service — Codex Instructions

## Engineering standards

- Preserve business invariants, public contracts and backward compatibility. Keep authentication, authorization, input validation and error handling intact.
- Protect secrets and sensitive data in code, commits, tests, logs and reports. Treat third-party hooks as untrusted until reviewed and explicitly authorized.
- Change production configuration, deploy or run destructive data operations only when explicitly authorized for the target environment.
- Keep review tasks read-only unless the developer requests fixes.
- Run targeted verification first. Broaden coverage when the risk or affected interfaces warrant it. Report checks that ran and any unverified behavior.

## Scope

Chat and real-time communication service.

Inspect package.json and existing application architecture.

## Development

- Preserve messaging contracts.
- Preserve conversation membership and ownership.
- Follow existing controller, service and data-access patterns.
- Preserve event names and event payload schemas.
- Handle duplicate events and retries correctly.
- Avoid unnecessary dependencies and unrelated refactoring.

## Security

- Do not trust client-supplied identity without verification.
- Enforce conversation authorization.
- Prevent cross-conversation data exposure.
- Do not expose messaging credentials.

## Verification

- Prefer focused existing tests.
- Do not launch MongoDB or external infrastructure for ordinary unit tests.
- Do not automatically run all integration tests.
- Expand verification for permissions, message ordering, event delivery and persistence changes.

## Skills

Use realtime-review for explicit review of real-time messaging changes.

## Completion

Report changed behavior, relevant tests and integration limitations.
