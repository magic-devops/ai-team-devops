# Hermes Runtime Tool Protocol

`sop-agentd` exposes the local execution surface consumed by Hermes core. The core is responsible for user/workspace authorization; `sop-agentd` enforces local root containment, timeouts, output bounds, and structured results.

## One-shot bridge

Command:

```bash
sop-agentd run-tool --root /absolute/workspace/root
```

Stdin:

```json
{"argv":["command","arg"],"timeout_seconds":60}
```

Stdout:

```json
{"ok":true,"exit_code":0,"stdout":"","stderr":"","duration_ms":12,"error":""}
```

Rules:

- `--root` must exist and be a directory.
- `argv` must contain at least one non-empty command.
- The process runs with working directory set to `--root`.
- Timeout defaults to 60 seconds and is capped at 3600 seconds.
- `stdout` and `stderr` are each bounded to 64 KiB and include `[truncated]` when capped.

Built-in argv commands:

- `workspace-file-list [path] [limit]`
- `workspace-file-read <path>`
- `workspace-file-write <path> <expected_sha256|missing> <content>`
- `git-status`
- `git-diff [path ...]`

All workspace paths are relative to `--root`; absolute paths and `..` escapes are rejected. File writes require the caller to pass the current SHA-256 hash, or `missing` when creating a new file.

## Long-lived JSONL server

Command:

```bash
sop-agentd tool-server --root /absolute/workspace/root
```

Each stdin line is one request:

```json
{"id":"req-1","op":"run_tool","data":{"argv":["pwd"],"timeout_seconds":5}}
```

Each stdout line is one event:

```json
{"id":"req-1","ok":true,"op":"run_tool","event":"tool.completed","data":{"ok":true,"exit_code":0,"stdout":"/workspace\n","stderr":"","duration_ms":5}}
```

Supported ops:

- `run_tool` with `data` matching one-shot bridge stdin.
- `workspace.file.list` with `data.path` and optional `data.limit`.
- `workspace.file.read` with `data.path`.
- `workspace.file.write` with `data.path`, `data.expected_sha256`, and `data.content`.
- `git.status`.
- `git.diff` with optional `data.paths`.
- `terminal.spawn` with `data.session_id`, `data.argv`, and optional `data.timeout_seconds`.
- `terminal.write` with `data.session_id` and `data.input`.
- `terminal.resize` with `data.session_id`, `data.cols`, and `data.rows`.
- `terminal.close` with `data.session_id`.

Terminal events:

- `terminal.started` returns `session_id`, `pid`, `backend`, and `native_pty`.
- `terminal.output` emits line-framed PTY output text.
- `terminal.wrote`, `terminal.resized`, `terminal.closed`, and `terminal.exited` confirm lifecycle changes.

Current backend status:

- Unix/macOS uses `github.com/creack/pty` and reports `backend:"creack/pty"`, `native_pty:true`.
- Windows IPC uses `github.com/Microsoft/go-winio` named pipes.
- Windows terminal sessions use `github.com/UserExistsError/conpty` and report `backend:"conpty"`, `native_pty:true`.
