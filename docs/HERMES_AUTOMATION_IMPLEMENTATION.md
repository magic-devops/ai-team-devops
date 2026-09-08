# Hermes v1 Automation Implementation

Version: 1.0.0. Work starts from `857e89ed`.

## Execution Plan

1. External agents and Squads: typed configuration, explicit provider adapters,
   version-pinned task dispatch, execution evidence and human delivery review.
2. Scheduling: transactional due-time admission, overlap prevention, durable
   run history, pause/resume and explicitly authorized execution.
3. Remote execution: expiring pairing challenge, scoped revocable device
   credential, outbound polling, fenced leases and verified result admission.
4. Product surfaces: Web and Flutter operation forms, matching SDK/CLI actions,
   generated contracts and permission-aware error/offline states.
5. Verification: regression tests, actual process execution, browser operation,
   readiness and independent review before the stage commit.

Resource registration alone is not execution evidence. Tests using provider
fixtures establish protocol behavior, not a successful paid provider call.
Platform signing and external credentials remain separate acceptance gates.
Local configuration, runtime memory and unrelated lockfile changes are not
part of this implementation commit.

## Stage Outcome

The five implementation slices above are delivered for the explicitly bounded
automation stage. Actual Codex and Squad execution, browser-created interval
scheduling, paired command execution and revocation were exercised. Web,
Flutter, CLI and SDK contracts were verified together; the macOS Flutter GUI
build remains blocked by missing Xcode. This is not full Multica parity.

See [acceptance evidence](HERMES_AUTOMATION_QA_20260908.md) and the
[remaining parity matrix](HERMES_MULTICA_ALIGNMENT.md). The next parity work
must implement Cron/webhooks, remote Agent execution, additional runtimes,
chat, skills and team/channel workflows before changing those rows to complete.

## Remote Recovery Stage

Starting from `ffbbf1a6`, close the result-delivery crash gap without changing
the server's lease or authorization boundary:

1. Journal ownership before command execution and persist the result before
   transmission in a private, credential-bound outbox.
2. Retry the same result and idempotency key before accepting another claim.
   Unknown execution outcomes and permanent rejection block new execution.
3. Expose local status and result-only recovery through the packaged Worker
   and `sop system remote-worker`, without requiring an executor for recovery.
4. Verify real command execution with HTTP failures before and after server
   commit, plus revoked credentials; then review and commit this stage.

This does not promise exactly-once arbitrary command side effects. A crash
between command execution and result persistence requires operator diagnosis.
It does not extend leases, auto-repair credentials, or automatically rerun an
uncertain command. Unrelated local changes remain outside the stage commit.

The retry contract follows caller-provided intent identifiers, not matching
payloads alone: [AWS guidance on idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).

This bounded recovery stage is implemented and verified through source and
packaged Workers with real HTTP fault injection. See the
[acceptance record](HERMES_REMOTE_RECOVERY_QA_20260908.md). The full readiness
gate still reports the missing macOS Xcode build tool; this does not close the
remaining Multica parity or signed-distribution requirements.
