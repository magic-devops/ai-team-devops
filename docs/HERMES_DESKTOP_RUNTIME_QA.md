# Hermes 1.0.0 Desktop Runtime Verification

Date: 2026-09-08. Host: macOS arm64. This stage covers desktop bootstrap,
owned-process lifecycle, runtime diagnostics and verified portable installation.
It does not certify all five native platforms or replace the broader business
acceptance matrix in `HERMES_1_0_0_QA.md`.

## Delivered Contracts

- Flutter uses platform user-data paths and starts the bundled Core on an
  ephemeral loopback port. A successful connection requires authenticated
  readiness, not just a PID or startup line. Mobile remains remote-only.
- A data-directory process lock rejects duplicate Core instances. Abrupt exit
  releases the OS lock; restart preserves the database and token.
- `/api/hermes/v1/system/diagnostics` and `system/readiness` perform actual
  database, LangGraph checkpointer, executable-version and free-space probes.
  A degraded check is an authenticated HTTP 200 envelope with `ok=false`;
  unauthorized and malformed responses are errors, not empty diagnostics.
- Web presents status rows with collapsible evidence and a copyable CLI command.
  Responses from a previous identity or workspace cannot reopen its evidence.
- `sop hermes diagnostics --json` and `sop hermes readiness --json` retain failed
  checks and exit 1 when degraded. The Python SDK exposes `system_diagnostics()`.
- Distribution manifests and installation boundaries are described in
  `HERMES_INSTALLATION.md`. File integrity is separate from publisher trust.

## Manual Evidence

Isolated source Core at `127.0.0.1:8791` with the real Go executor:

- CLI diagnostics: exit 0, four checks passed, `summary.version=1.0.0`.
- Browser `http://127.0.0.1:5198/#/workspace`: connected to that Core, opened
  the diagnostics drawer, inspected four passed rows and collapsed evidence.
  Final 1280x720 screenshot showed the fully expanded drawer without overlapping
  text or controls. Opening-animation frames were not used as layout evidence.
- Replaced the token with an invalid test value: prior evidence disappeared,
  an authentication error with trace ID appeared, and create/diagnostics buttons
  were disabled. Restored the valid isolated connection afterward.

A separate isolated Core at `127.0.0.1:8792` used a missing executor:

- CLI diagnostics and readiness: exit 1, three passed and one failed check.
- Browser showed `需要处理` and the failed executor row, not a success or empty
  state. No production workspace data was used.

The Core subprocess regression starts two real processes against the same data
directory, verifies duplicate refusal (`core_already_running`, exit 2), kills
the owned test process and starts it again with the existing token/database.

The real Dart `BundledLocalRuntime` smoke started the frozen macOS Core in a
Chinese-named data directory, obtained four passed diagnostics, created a
workspace, restarted Core, confirmed that workspace and token survived, and
observed the owned process exit on stop. No development Python process was used
to serve those API requests. This verifies the Dart service, not the native GUI
or OS credential-store plugin.

The final package command exited 0 and completed a real frozen Graph Loop
command node through Go agentd. The tar archive was installed into a fresh
directory, all 477 manifest entries passed verification, and the same Dart
start/restart/stop smoke passed against the installed files. A second install
to that destination exited 1 without replacing it.

Artifact: `dist/hermes-1.0.0-macos-arm64-core-only.tar.gz`.
SHA-256: `ea7d13f72daa2b7bc07654efc502267111e0137b074deb7aeb74043b0df7b019`.
This is an unsigned development runtime archive, not a native desktop installer.

## Verification Results

| Gate | Result |
| --- | --- |
| Core pytest with real Go executor | 36 passed |
| CLI and Python SDK contracts | 20 passed |
| Manager scope, permissions and page registration | 3 passed |
| SDK generator regression | 1 passed |
| Portable distribution safety regressions | 25 passed |
| Web Vitest | 139 passed |
| Web typecheck and production build | Passed |
| Flutter analyze | No issues found |
| Flutter unit and widget tests | 33 passed |
| New Python runtime/diagnostics/distribution Ruff checks | Passed |
| Full readiness | 24 passed, 1 failed: native macOS build lacks Xcode |

The full gate exits 1 and keeps `release_ready=false`. Its machine-readable
evidence is `/private/tmp/hermes-desktop-readiness-full.json` on this host.
Existing warnings remain: Manager's `datetime.utcnow()` deprecation, Web large
chunks, and the secure-storage plugin's future Swift Package Manager support.

One cold frozen-runtime startup exceeded the package QA's former 30-second
deadline. Package QA now allows up to 90 seconds; this is a bounded verification
timeout, not a claim that the 10-second runtime readiness target is met.

## Repeatable Verification

```bash
env HERMES_TEST_AGENTD=/path/to/sop-agentd \
  .venv/bin/python -m pytest packages/hermes-core/tests \
  packages/sop-sdk-python/tests/test_hermes_client.py \
  packages/sop-cli/tests/test_hermes_cli_contract.py -q

.venv/bin/python -m pytest scripts/tests/test_hermes_distribution.py -q

env FLUTTER_BIN=/path/to/flutter \
  .venv/bin/python scripts/hermes-readiness.py --full --json \
  --output /tmp/hermes-desktop-readiness-full.json

# From apps/hermes-client, after building or installing a matching runtime:
dart run tool/runtime_smoke.dart /path/to/Hermes/runtime
```

## Release Boundaries

This host lacks a usable Xcode installation. Native macOS Flutter build,
signing, notarization and a clean-machine GUI installation are not verified.
Windows, Linux, Android and iOS native builds and real-device acceptance remain
separate release gates. A frozen macOS Core runtime and component tests do not
prove those gates. Performance targets, Chinese IME, accessibility certification,
editor/terminal stress and signed auto-update are not certified by this stage.

No legacy API aliases or automatic historical-data migration were introduced.
User-local `.codex/config.toml` and `memory/current_state.json` remain outside
this stage's commit.
