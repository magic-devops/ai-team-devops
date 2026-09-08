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
