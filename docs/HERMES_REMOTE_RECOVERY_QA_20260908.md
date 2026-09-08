# Hermes v1 Remote Recovery Acceptance

Date: 2026-09-08. Product version: 1.0.0. Base commit: `ffbbf1a6`.
This is a bounded remote-result recovery acceptance, not full Multica parity.

## Delivered

- Private, atomic result outbox with credential-generation binding and one
  Worker lock per directory.
- Claim journal before execution; saved result before HTTP delivery; stable
  idempotency key across retries; no automatic rerun of uncertain execution.
- Transient backoff, permanent-rejection quarantine, strict acknowledgement
  checks, bounded Unicode output, corrupt-file/FIFO/link rejection.
- `--outbox-status`, `--flush-only`, `--outbox-dir` and stdin pairing through
  both the packaged Core and `sop system remote-worker`.
- Clean filesystem failure diagnostics and a documented recovery procedure.

## Fresh Automated Evidence

| Check | Result |
| --- | --- |
| Final Core + CLI + Python SDK suite | 149 passed in 33.41s: Core 105, CLI 21, SDK 23 |
| Ruff on all changed Python files | Passed, no complexity suppression added |
| Independent final review | No findings; focused filesystem regression passed |
| Full readiness | 47 passed, 1 failed: `flutter.build.macos` |
| Web tests / typecheck / production build | 178 tests passed; typecheck and build passed |
| Flutter tests / analyze | 57 tests passed; analyze clean |
| Core-only package | Built; real executor smoke completed; 481-file manifest verified |

Full readiness ran before the final filesystem and malformed-credential
regressions were added: its Core result is 103 passed. The final 149-test command
above reran the full Core suite after the last production edit. The final
reviewer reran both added regressions.

The readiness report is `/private/tmp/hermes-outbox-readiness.json`.
The macOS GUI build failed because `xcrun` could not find `xcodebuild`. Existing
Vite chunk-size warnings and a Manager `datetime.utcnow()` deprecation warning
remain. Neither prevents this bounded Worker verification, but the release
gate is not green and no five-platform release claim is made.

## Actual Fault Injection

An isolated real Core, HTTP fault proxy, actual Go agentd and separate Worker
processes were used. The command increments a project-local counter and emits
the count. The proxy drops only result traffic; it does not fabricate an
executor result or a server acknowledgement.

| Fault | First Worker | Recovery | Observed outcome |
| --- | --- | --- | --- |
| Connection closes before result reaches Core | Exit 1, pending result | `--flush-only`, exit 0 | Core completed; counter remains 1; zero new claims |
| Core commits result but response is lost | Exit 1, pending result | `--flush-only`, exit 0 | Same result acknowledged; counter remains 1; zero new claims |
| Device revoked while result is pending | Exit 1, pending result | `--flush-only`, exit 1 / HTTP 403 | Result retained in quarantine; no new claims; no fabricated Core result |

Each flush used a deliberately absent agentd path and no workspace mapping.
The source Worker and the newly packaged Worker both passed all three cases.
The top-level `sop system remote-worker --outbox-status` also returned valid
metadata JSON after the isolated servers had stopped, proving local diagnosis
does not require an active Core connection.

Packaged run evidence:

- Before-forward run: `89cf8b4c198c44e79a81ca2bf64c38c4`.
- Lost-response run: `e915217e3bec478ab2928f07014f9f86`.
- Revoked run: `c088ee2bff96402397c494a3c17d13ed`.
- All command counters remained 1. All flush claim counts were 0.
- Output SHA-256: `4b2bc4190aae3198d619d2cb06ef13f8ec261d83618ab5cc2f9789392350e554`.

Local reproducibility artifacts:

- Harness: `/private/tmp/hermes-outbox-qa.py`.
- Source report: `/private/tmp/hermes-outbox-qa-report-1788868221-39283.json`.
- Packaged report: `/private/tmp/hermes-outbox-qa-report-1788868533-48078.json`.
- Packaged evidence directory: `/private/tmp/hermes-outbox-qa-zh4j9ioz`.
- Runtime bundle: `dist/hermes-1.0.0/macos-arm64-core-only.hKuiM0`.

The package is an unsigned development runtime bundle, not a signed installer
and not a Flutter GUI distribution. The test command used a local Python
runtime as a workload dependency; the packaged Worker itself used its bundled
runtime. No claim of a clean-machine five-platform installation follows.

## Remaining Boundaries

Real multi-host transport, Windows ACL/process recovery, mobile integration,
remote Agent/worktree/approval execution and signed installation still require
their own acceptance. Crash-uncertain commands, expired leases and corrupt
journals intentionally require operator review; they are not automatically
converted to success. Acknowledged evidence has no automatic retention job.

See [recovery runbook](HERMES_REMOTE_RECOVERY.md) and the
[Multica alignment matrix](HERMES_MULTICA_ALIGNMENT.md) for the full backlog.
Unrelated configuration, login changes, runtime memory and `uv.lock` were not
included in this stage.
