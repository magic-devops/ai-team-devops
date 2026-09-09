# Hermes 1.0.0 Multica alignment execution plan

Status: local stage verified; native release acceptance remains blocked. This is
not a parity or signed-release claim.

## Scope and ownership

Preserve unrelated edits, including local Codex configuration, runtime memory,
login/SQLite work, and the existing lockfile. No compatibility layer or version
bump. Independently implement behavior; do not copy reference source.

1. Completed: implement typed Cron/Webhook triggers, capability-aware remote
   Agent execution, membership-scoped collaboration, and verifiable distribution.
   Keep existing transactional receipts, resource versions, pinned authority,
   provider completion evidence, and durable remote result recovery.
2. Completed: integrate native API actions, Web/Dart/Python clients, CLI commands,
   compact desktop/mobile interactions, and generated contracts.
3. Completed locally; native build blocked by missing Xcode: run focused regression, permission and failure-path tests; typecheck,
   build, and readiness. Drive scheduling, remote execution, and messaging through
   actual API/CLI/browser surfaces. Verify local signing with ephemeral keys.
4. Completed: independently review security and interactions, update the gap matrix
   with observed evidence and remaining external release requirements, and scope
   the stage commit to verified files only.

## Behavioral boundaries

- Cron uses an IANA timezone and returns a bounded UTC preview. Webhook requests
  authenticate the raw body, timestamp, and delivery identifier before mutation.
- Device capabilities constrain remote claims; provider credentials remain on
  the execution host. A successful process exit alone is not Agent completion.
- Channel membership is checked by every message, thread, inbox and sync read.
  Writes use the authenticated actor, versions and idempotency receipts.
- Signing and update verification fail closed. Locally generated test signatures
  are not Apple notarization, Windows publisher signing, or store approval.
- Dry-run never persists business state. Editing a preview invalidates it;
  confirmation uses the same request and idempotency key.
- Each surface retains loading, empty, error, offline, permission and success
  states. Evidence and advanced configuration expand on demand.

## Verification evidence

- Core/Manager/distribution/release/generated-contract aggregate: 207 tests passed.
- `pnpm --dir apps/manager-web test`: 185 tests passed; production build passed.
- Flutter analyze: no issues; Flutter test: 68 tests passed.
- CLI/SDK contracts: 48 tests passed.
- Red-to-green fixes: re-signed Webhook retries, restricted-message sync metadata,
  stale Flutter scope responses and previews, and mobile post-send trace overflow.
- Independent security review: approved after the recipient-scoped sync fix.
- Focused Ruff passes. Broad scan retains 24 pre-existing B008/C901 diagnostics in
  `api.py` and an unrelated import-order diagnostic in `sql_models.py`; no rule
  suppression or unrelated cleanup was performed.
- `scripts/hermes-readiness.py --full --json`: 63 passed, one required unavailable
  (`flutter.build.macos`, missing Xcode), zero executed check failures. The gate
  correctly exits 1 and retains `release_ready=false`.
- Actual browser QA: channel/thread/message preview and apply, archive history
  read-only, Cron timezone preview invalidation, pause, desktop/mobile layouts.
- Actual remote Codex + Go worker: completed provider event, expected file,
  acknowledged durable outbox. Evidence paths are in the alignment matrix.
- `bash scripts/hermes-package.sh --core-only`: 502 manifest files verified;
  frozen Core starts, diagnostics pass 4/4, a real command run completes.
- Actual signed install/repair of that current bundle passes; wrong-key and tamper
  attempts leave the installed tree digest unchanged. Installed Core returns
  scoped collaboration identities and five Asia/Shanghai Cron occurrences.
- Remaining platform validation is blocked by missing full Xcode, other OS test
  environments, publisher credentials and store access, not waived by this phase.
