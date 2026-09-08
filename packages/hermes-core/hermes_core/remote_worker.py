from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

WORKER_VERSION = "1.0.0"
LOG_LIMIT_BYTES = 262144
CREDENTIAL_LIMIT_BYTES = 4096


class WorkerError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise WorkerError("HTTP redirects are not allowed for remote worker requests")


def _is_loopback(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "http" and host in {"127.0.0.1", "::1", "localhost"}


def _require_tls_or_loopback(url: str) -> None:
    parsed = urlparse(url)
    if parsed.username or parsed.password:
        raise WorkerError("Remote worker server URL must not contain userinfo")
    if parsed.query or parsed.fragment:
        raise WorkerError("Remote worker server URL must not contain query or fragment")
    if parsed.scheme == "https":
        return
    if _is_loopback(url):
        return
    raise WorkerError("Remote worker requires HTTPS unless the server URL is loopback")


def _server_binding(url: str) -> tuple[str, str, int | None, str]:
    _require_tls_or_loopback(url)
    parsed = urlparse(url)
    port = parsed.port
    if port is None and parsed.scheme == "https":
        port = 443
    if port is None and parsed.scheme == "http":
        port = 80
    return parsed.scheme, (parsed.hostname or "").lower(), port, parsed.path.rstrip("/")


def _assert_credential_server(server: str, credential: dict) -> None:
    stored = str(credential.get("server", "")).strip()
    if not stored:
        raise WorkerError("Credential file missing server binding")
    if _server_binding(stored) != _server_binding(server):
        raise WorkerError("Credential file is bound to a different Hermes server")


def _load_credential(path: Path) -> dict:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except FileNotFoundError as exc:
        raise WorkerError(f"Credential file not found: {path}") from exc
    except OSError as exc:
        raise WorkerError(f"Credential file must be a regular non-symlink file: {path}") from exc
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise WorkerError(f"Credential file must be a regular file: {path}")
        if info.st_size > CREDENTIAL_LIMIT_BYTES:
            raise WorkerError(f"Credential file exceeds {CREDENTIAL_LIMIT_BYTES} bytes: {path}")
        if os.name != "nt":
            mode = stat.S_IMODE(info.st_mode)
            if mode & 0o077:
                raise WorkerError(f"Credential file must be 0600 or stricter: {path}")
        with os.fdopen(fd, "r", encoding="utf-8") as handle:
            fd = -1
            data = json.loads(handle.read(CREDENTIAL_LIMIT_BYTES + 1))
    except ValueError as exc:
        raise WorkerError(f"Credential file is not valid JSON: {path}") from exc
    finally:
        if fd >= 0:
            os.close(fd)
    for key in ("device_id", "credential", "workspace_id", "server"):
        if not str(data.get(key, "")).strip():
            raise WorkerError(f"Credential file missing {key}")
    _server_binding(str(data["server"]))
    return data


def _write_credential(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags, 0o600)
    except FileExistsError as exc:
        raise WorkerError(f"Credential file already exists; choose a fresh path: {path}") from exc
    except OSError as exc:
        raise WorkerError(f"Credential file must be a regular non-symlink file: {path}") from exc
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, sort_keys=True)
        handle.write("\n")
    if os.name != "nt":
        os.chmod(path, 0o600)


def _workspace_map(values: list[str]) -> dict[str, Path]:
    mapping: dict[str, Path] = {}
    for value in values:
        if "=" not in value:
            raise WorkerError("--workspace-map must be WORKSPACE_ID=/absolute/path")
        workspace, raw_path = value.split("=", 1)
        if not workspace:
            raise WorkerError("Workspace map key cannot be empty")
        path = Path(raw_path).expanduser().resolve()
        if not path.is_dir():
            raise WorkerError(f"Mapped workspace root is not a directory: {path}")
        mapping[workspace] = path
    return mapping


def _request_json(server: str, path: str, body: dict, credential: dict | None = None, timeout: float = 15) -> dict:
    _require_tls_or_loopback(server)
    url = server.rstrip("/") + path
    headers = {"Content-Type": "application/json", "User-Agent": f"hermes-remote-worker/{WORKER_VERSION}"}
    if credential is not None:
        _assert_credential_server(server, credential)
        headers["Authorization"] = "Bearer " + credential["credential"]
        headers["X-Hermes-Device-Id"] = credential["device_id"]
    req = Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")  # noqa: S310
    opener = build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=timeout) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise WorkerError(f"HTTP {exc.code} {path}") from exc
    except WorkerError:
        raise
    except (URLError, TimeoutError, ValueError, OSError) as exc:
        raise WorkerError(f"Request failed for {path}: {exc}") from exc


def _validate_node(node: dict) -> tuple[list[str], int]:
    if node.get("kind", "command") != "command":
        raise WorkerError("Remote worker only supports command nodes")
    argv = node.get("argv")
    timeout_seconds = node.get("timeout_seconds", 60)
    if not isinstance(argv, list) or not argv or len(argv) > 128:
        raise WorkerError("Command node requires 1 to 128 argv entries")
    clean_argv: list[str] = []
    for arg in argv:
        if not isinstance(arg, str) or not arg or "\x00" in arg:
            raise WorkerError("Command argv entries must be non-empty strings without NUL")
        clean_argv.append(arg)
    if not isinstance(timeout_seconds, int) or timeout_seconds < 1 or timeout_seconds > 3600:
        raise WorkerError("Command timeout must be between 1 and 3600 seconds")
    return clean_argv, timeout_seconds


def _terminate(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        proc.terminate()
    else:
        os.killpg(proc.pid, signal.SIGTERM)
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def _run_agentd(agentd: str, root: Path, task: dict, server: str, credential: dict) -> dict:
    node = task["node"]
    argv, timeout_seconds = _validate_node(node)
    request = json.dumps({"argv": argv, "timeout_seconds": timeout_seconds})
    started = time.monotonic()
    heartbeat_at = started
    proc = subprocess.Popen(  # noqa: S603
        [agentd, "run-tool", "--root", str(root)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={key: value for key, value in os.environ.items() if not key.startswith("GIT_")},
        start_new_session=os.name != "nt",
    )
    try:
        assert proc.stdin is not None
        proc.stdin.write(request)
        proc.stdin.close()
        proc.stdin = None
        while True:
            if time.monotonic() - started > timeout_seconds + 10:
                raise WorkerError("agentd did not return within the node time budget")
            if time.monotonic() - heartbeat_at >= 2:
                _request_json(server, "/api/hermes/v1/remote/heartbeat", {
                    "run_id": task["run_id"],
                    "owner": task["owner"],
                    "idempotency_key": f"heartbeat:{task['owner']}:{int(time.time())}",
                }, credential, timeout=10)
                heartbeat_at = time.monotonic()
            try:
                stdout, stderr = proc.communicate(timeout=0.25)
                break
            except subprocess.TimeoutExpired:
                continue
        try:
            result = json.loads(stdout)
        except ValueError:
            result = {"ok": False, "exit_code": -1, "stdout": stdout[-LOG_LIMIT_BYTES:],
                      "stderr": (stderr or "agentd returned invalid JSON")[-LOG_LIMIT_BYTES:],
                      "error": "agentd_protocol"}
        result.setdefault("stdout", "")
        result.setdefault("stderr", stderr or "")
        return result
    except Exception:
        _terminate(proc)
        raise
    finally:
        _terminate(proc)


def pair_device(args: argparse.Namespace) -> int:
    _require_tls_or_loopback(args.server)
    response = _request_json(args.server, "/api/hermes/v1/devices/pair", {
        "device_id": args.device_id,
        "secret": args.pair_secret,
    })
    item = response["items"][0]
    credential = {
        "device_id": item["device_id"],
        "workspace_id": item["workspace_id"],
        "credential": item["credential"],
        "server": args.server,
    }
    _write_credential(Path(args.credential_file), credential)
    print(json.dumps({"ok": True, "credential_file": args.credential_file, "workspace_id": item["workspace_id"]}))
    return 0


def run_once(args: argparse.Namespace, credential: dict, workspace_roots: dict[str, Path], agentd: str) -> bool:
    claim = _request_json(args.server, "/api/hermes/v1/remote/claim", {
        "idempotency_key": f"claim:{credential['device_id']}:{time.time_ns()}",
        "worker_version": WORKER_VERSION,
    }, credential)
    if not claim.get("items"):
        return False
    task = claim["items"][0]
    workspace_id = task["workspace_id"]
    root = workspace_roots.get(workspace_id)
    if root is None:
        raise WorkerError(f"No local root mapping for workspace {workspace_id}")
    result = _run_agentd(agentd, root, task, args.server, credential)
    _request_json(args.server, "/api/hermes/v1/remote/result", {
        "run_id": task["run_id"],
        "owner": task["owner"],
        "node_id": task["node"]["id"],
        "idempotency_key": f"result:{task['owner']}:{task['node']['id']}",
        "result": result,
    }, credential, timeout=20)
    return True


def run_worker(args: argparse.Namespace) -> int:
    _require_tls_or_loopback(args.server)
    credential = _load_credential(Path(args.credential_file))
    _assert_credential_server(args.server, credential)
    workspace_roots = _workspace_map(args.workspace_map)
    agentd = args.agentd or shutil.which("sop-agentd") or ""
    if not agentd or not Path(agentd).is_file():
        raise WorkerError("sop-agentd binary not found; pass --agentd")
    while True:
        claimed = run_once(args, credential, workspace_roots, agentd)
        if args.once:
            return 0 if claimed else 2
        time.sleep(args.poll_interval)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m hermes_core.remote_worker",
        description="Poll Hermes remote execution tasks and execute command nodes through sop-agentd.",
    )
    parser.add_argument("--server", required=True, help="Hermes server URL; HTTPS required except localhost/127.0.0.1")
    parser.add_argument("--credential-file", required=True, help="JSON credential file, read/write mode 0600")
    parser.add_argument("--device-id", default="", help="Device id for --pair-secret redemption")
    parser.add_argument("--pair-secret", default="", help="Redeem a short-lived one-use pairing secret and write credentials")
    parser.add_argument("--pair-secret-stdin", action="store_true",
                        help="Read the pairing secret from stdin instead of process argv")
    parser.add_argument("--workspace-map", action="append", default=[],
                        help="Explicit local mapping WORKSPACE_ID=/absolute/root; may be repeated")
    parser.add_argument("--agentd", default="", help="Path to sop-agentd; defaults to PATH lookup")
    parser.add_argument("--once", action="store_true", help="Claim at most one node then exit")
    parser.add_argument("--poll-interval", type=float, default=5.0, help="Seconds between claim polls")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.pair_secret_stdin:
            if args.pair_secret:
                raise WorkerError("--pair-secret and --pair-secret-stdin are mutually exclusive")
            args.pair_secret = sys.stdin.read().strip()
        elif not args.pair_secret:
            args.pair_secret = os.environ.get("HERMES_PAIR_SECRET", "").strip()
        if args.pair_secret:
            if not args.device_id:
                raise WorkerError("--device-id is required with --pair-secret")
            return pair_device(args)
        return run_worker(args)
    except WorkerError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
