# Hermes v5 Architecture

Status: ADR accepted for the authorized v5 contract. This is a buildable local
core slice, not a claim of full production readiness.

## Contract

- Base path: `/api/v2`
- Authentication: `Authorization: Bearer <token>`
- Scope selector: `X-Workspace-Id`
- Unauthenticated endpoint: `GET /api/v2/health`
- Health response is intentionally short: `{ok,version,service}`.
- Other API responses use the uniform envelope:
  `{ok,scope,summary,items,actions,permissions,audit,trace_id,agent_consumption,cli,error?}`.
- `items` is always an array, including single-item reads and errors.

## Chosen Decisions

- ADR-001: Flutter is the first desktop/mobile host choice because one UI codebase can target macOS, Windows, Linux, iOS, and Android. It is not the only possible option; native Swift/Kotlin/Electron remain valid future alternatives when platform-specific UX or enterprise controls justify the cost.
- ADR-002: Domain extraction is FastAPI plus a small Python core package. The existing Manager v1 Hermes blueprint remains separate; v5 owns an authorized local control plane with SQLite storage and a frozen wire contract.
- ADR-003: Go remains the `agentd` runtime lane for local IPC/process integration. Python core exposes HTTP and storage; Go agentd owns daemon-grade local execution and IPC.
- ADR-004: Storage starts with SQLite for desktop/local bootstrap and keeps PostgreSQL as the remote/team persistence target. No automatic legacy data migration is performed; migration requires an explicit reviewed plan.

## Runtime Split

Desktop local bootstrap:

```bash
PYTHONPATH=packages/hermes-core PYTHON_BIN=/path/to/python-with-deps bash scripts/hermes-bootstrap.sh /tmp/hermes-v5
```

The process generates a 0600 token file when absent and writes:

```json
{"url":"http://127.0.0.1:PORT","token_file":"/tmp/hermes-v5/token","pid":12345}
```

Mobile remote mode uses a configured base URL and token. Clients fail closed
when no core endpoint/token exists; host clients must not fabricate successful
backend responses.

## State Matrix

| Host | Core location | Token source | Storage | Required QA |
| --- | --- | --- | --- | --- |
| macOS desktop | Local `hermes-core` bootstrap | Generated 0600 token file | SQLite | Core tests, agentd tests, core runtime tar, later real Flutter host build, notarization/signing gate |
| Windows desktop | Local `hermes-core` bootstrap | Generated token file | SQLite | Core tests, agentd tests, core runtime tar, later installer CI, Authenticode signing gate |
| Linux desktop | Local `hermes-core` bootstrap | Generated 0600 token file | SQLite | Core tests, agentd tests, core runtime tar |
| iOS | Remote Hermes base URL | Mobile secure storage | PostgreSQL target | Flutter iOS compile, no local core assumption |
| Android | Remote Hermes base URL | Mobile secure storage | PostgreSQL target | Flutter APK compile, no local core assumption |

## Quality Evidence Model

Run data carries sequential nodes initially:

```json
{
  "data": {
    "title": "quality run",
    "session_id": "session-1",
    "nodes": [
      {"id":"compile","title":"compile core","kind":"command","argv":["python3","-m","compileall","-q","packages/hermes-core/hermes_core"],"expected_exit_code":0,"timeout_seconds":60}
    ]
  },
  "idempotency_key": "quality-run-1"
}
```

`workspace_root` and `workspace_version` are copied from the selected workspace
by the server when the run is created. Clients do not supply them.

Parallel DAG execution is intentionally deferred until the sequential contract,
version checks, idempotency, audit events, and run actions are stable.

## Release Gates

- Native signing is a separate release gate. `HERMES_RELEASE=1` is refused by
  the development bundler even if signing variables exist: it does not implement
  installer signing, notarization or update publication.
- External publish is out of scope for this slice.
- Core-only package layout is host-neutral inside the tar bundle:
  `HermesV5/runtime/hermes-core/hermes-core(.exe)` and
  `HermesV5/runtime/agentd/sop-agentd(.exe)`. The script does not fabricate a
  `.app`, DMG, MSI, MSIX, deb, or full installer.
- `bash scripts/hermes-package.sh --core-only` builds the frozen core and
  agentd. `bash scripts/hermes-package.sh` is the full package lane; it fails
  when host tools are available it builds Flutter in release mode, or accepts
  `--flutter-bundle PATH` from a native build lane. Flutter SDK resolution is
  external via `FLUTTER_BIN` or `PATH`, never a hardcoded temporary SDK path.
  Full macOS bundles place the runtime inside `Contents/Resources/runtime`;
  Windows/Linux place it next to the Flutter executable. This full path remains
  unverified on the current host because full Xcode is absent.
