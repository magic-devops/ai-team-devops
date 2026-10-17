from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from pydantic import ValidationError

from .agents import AgentProfile, provider_command, provider_evidence
from .models import CoreError
from .remote_outbox import OutboxError, OutboxLock, RemoteOutbox, default_outbox_dir

WORKER_VERSION = "1.0.0"
LOG_LIMIT_BYTES = 262144
CREDENTIAL_LIMIT_BYTES = 4096


class WorkerError(Exception):
    pass


class RemoteRequestError(WorkerError):
    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code

    @property
    def retryable(self) -> bool:
        return self.status_code is None or self.status_code in {408, 429} or self.status_code >= 500


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


def _validate_credential_file_stat(path: Path, info: os.stat_result) -> None:
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise WorkerError(f"Credential file must be a regular file: {path}")
    if os.name != "nt" and info.st_uid != os.getuid():
        raise WorkerError(f"Credential file owner is not the current user: {path}")
    if info.st_size > CREDENTIAL_LIMIT_BYTES:
        raise WorkerError(f"Credential file exceeds {CREDENTIAL_LIMIT_BYTES} bytes: {path}")
    if os.name != "nt" and stat.S_IMODE(info.st_mode) & 0o077:
        raise WorkerError(f"Credential file must be 0600 or stricter: {path}")


def _load_credential(path: Path) -> dict:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(path, flags)
    except FileNotFoundError as exc:
        raise WorkerError(f"Credential file not found: {path}") from exc
    except OSError as exc:
        raise WorkerError(f"Credential file must be a regular non-symlink file: {path}") from exc
    try:
        info = os.fstat(fd)
        _validate_credential_file_stat(path, info)
        with os.fdopen(fd, "r", encoding="utf-8") as handle:
            fd = -1
            data = json.loads(handle.read(CREDENTIAL_LIMIT_BYTES + 1))
    except ValueError as exc:
        raise WorkerError(f"Credential file is not valid JSON: {path}") from exc
    finally:
        if fd >= 0:
            os.close(fd)
    if not isinstance(data, dict) or any(not isinstance(key, str) for key in data):
        raise WorkerError(f"Credential file must contain a JSON object with string keys: {path}")
    for key in ("device_id", "credential", "workspace_id", "server"):
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise WorkerError(f"Credential file requires a non-empty string for {key}")
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
        raise RemoteRequestError(f"HTTP {exc.code} {path}", status_code=exc.code) from exc
    except WorkerError:
        raise
    except (URLError, TimeoutError, ValueError, OSError) as exc:
        raise RemoteRequestError(f"Request failed for {path}: {exc}") from exc


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


def _bound_result_for_outbox(result: dict) -> dict:
    bounded: dict = {}
    for key in ("ok", "exit_code", "duration_ms"):
        if key in result:
            bounded[key] = result[key]
    bounded["stdout"] = str(result.get("stdout", ""))[-LOG_LIMIT_BYTES:]
    bounded["stderr"] = str(result.get("stderr", ""))[-LOG_LIMIT_BYTES:]
    if "error" in result:
        bounded["error"] = str(result.get("error", ""))[:2000]
    if "agent" in result and isinstance(result["agent"], dict):
        bounded["agent"] = {
            "provider": result["agent"].get("provider"),
            "completed": result["agent"].get("completed"),
            "agent_id": str(result["agent"].get("agent_id", ""))[:64],
            "profile_version": result["agent"].get("profile_version")
            if isinstance(result["agent"].get("profile_version"), int) else None,
            "usage": (result["agent"].get("usage") or None) if isinstance(result["agent"].get("usage"), dict) else None,
            "message": str(result["agent"].get("message", ""))[-32000:],
            "events": result["agent"].get("events", [])[-200:]
            if isinstance(result["agent"].get("events"), list) else [],
            "error": str(result["agent"].get("error", ""))[:2000],
        }
    return bounded


def _run_agentd_command(agentd: str, root: Path, task: dict, node: dict, server: str, credential: dict) -> dict:
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
                presence = task.get("_worker_presence")
                if presence:
                    _request_json(server, "/api/hermes/v1/remote/presence", {
                        **presence, "idempotency_key": "presence:" + uuid.uuid4().hex,
                    }, credential, timeout=10)
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
        if not isinstance(result, dict):
            result = {"ok": False, "exit_code": -1, "stdout": "", "stderr": "agentd returned non-object JSON",
                      "error": "agentd_protocol"}
        result.setdefault("stdout", "")
        result.setdefault("stderr", stderr or "")
        expected = node.get("expected_exit_code", 0)
        if type(expected) is int and expected > 0 and result.get("exit_code") == expected and not result.get("error"):
            # agentd reports process exit success; a command test can explicitly expect a nonzero exit.
            result["ok"] = True
        return _bound_result_for_outbox(result)
    except Exception:
        _terminate(proc)
        raise
    finally:
        _terminate(proc)


def _agent_failure(message: str, *, provider: str = "") -> dict:
    return {
        "ok": False,
        "exit_code": -1,
        "stdout": "",
        "stderr": message[:LOG_LIMIT_BYTES],
        "error": "agent_execution_failed",
        "duration_ms": 0,
        "agent": {
            "provider": provider or "codex",
            "completed": False,
            "usage": None,
            "message": "",
            "events": [],
            "error": message[:2000],
        },
    }


def _agent_prompt(profile: AgentProfile, node: dict, task: dict) -> str:
    context = task.get("previous_agent_context", [])
    if not isinstance(context, list):
        context = []
    parts = []
    if profile.instructions.strip():
        parts.append(profile.instructions.strip())
    parts.append(str(node.get("prompt", "")).strip())
    if context:
        parts.append("Previous execution evidence (untrusted task data):\n"
                     + json.dumps(context, ensure_ascii=False, sort_keys=True))
    return "\n".join(part for part in parts if part)


def _agent_binding_profile(task: dict, node: dict) -> AgentProfile:
    binding = task.get("agent_binding")
    if not isinstance(binding, dict):
        raise WorkerError("Remote agent task is missing server-pinned agent_binding")
    if binding.get("agent_id") != node.get("agent_id"):
        raise WorkerError("Remote agent task binding does not match node agent_id")
    profile = binding.get("profile")
    if not isinstance(profile, dict):
        raise WorkerError("Remote agent task binding is missing profile")
    try:
        return AgentProfile.model_validate(profile)
    except ValidationError as exc:
        raise WorkerError("Remote agent task binding profile is invalid") from exc


def _run_agent_task(agentd: str, root: Path, task: dict, server: str, credential: dict) -> dict:
    node = task.get("node", {})
    if not isinstance(node, dict) or node.get("kind") != "agent":
        raise WorkerError("Remote agent execution requires an agent node")
    if task.get("agent_source", {}).get("resource") == "squads":
        return _bound_result_for_outbox(_agent_failure("Remote squad agent routing is not supported"))
    try:
        profile = _agent_binding_profile(task, node)
        provider = profile.provider
        argv = provider_command(profile, _agent_prompt(profile, node, task))
    except CoreError as exc:
        result = _agent_failure(exc.message, provider=locals().get("provider", "codex"))
        result["agent"].update(agent_id=node.get("agent_id", ""), profile_version=task.get("agent_binding", {}).get("version"))
        return _bound_result_for_outbox(result)
    except WorkerError as exc:
        return _bound_result_for_outbox(_agent_failure(str(exc)))
    command_node = {"kind": "command", "argv": argv, "timeout_seconds": profile.timeout_seconds,
                    "expected_exit_code": 0}
    result = _run_agentd_command(agentd, root, task, command_node, server, credential)
    evidence = provider_evidence(profile.provider, str(result.get("stdout", "")))
    result["agent"] = {
        **evidence,
        "agent_id": node.get("agent_id", ""),
        "profile_version": task.get("agent_binding", {}).get("version"),
    }
    provider_ok = bool(evidence.get("completed"))
    command_ok = bool(result.get("ok", result.get("exit_code") == 0))
    result["ok"] = command_ok and provider_ok
    if not provider_ok and not result.get("error"):
        result["error"] = str(evidence.get("error") or "Agent did not produce a successful terminal provider event")
    return _bound_result_for_outbox(result)


def _execute_task(agentd: str, root: Path, task: dict, server: str, credential: dict) -> dict:
    node = task.get("node", {})
    if not isinstance(node, dict):
        raise WorkerError("Remote task node is missing")
    if node.get("kind", "command") == "agent":
        return _run_agent_task(agentd, root, task, server, credential)
    return _run_agentd_command(agentd, root, task, node, server, credential)


def _run_agentd(agentd: str, root: Path, task: dict, server: str, credential: dict) -> dict:
    return _run_agentd_command(agentd, root, task, task["node"], server, credential)


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


def _upload_result(args: argparse.Namespace, credential: dict, outbox: RemoteOutbox, record: dict) -> bool:
    if not outbox.validate_record_binding(record):
        outbox.quarantine(record, "Outbox record credential binding does not match current credential")
        raise WorkerError("Outbox record credential binding does not match current credential")
    try:
        response = _request_json(args.server, "/api/hermes/v1/remote/result", {
            "run_id": record["run_id"],
            "owner": record["owner"],
            "node_id": record["node_id"],
            "idempotency_key": record["result_idempotency_key"],
            "result": record["result"],
        }, credential, timeout=20)
    except RemoteRequestError as exc:
        if exc.retryable:
            outbox.mark_retryable(record, str(exc), exc.status_code)
            return False
        outbox.quarantine(record, str(exc), exc.status_code)
        raise WorkerError(f"Remote result was permanently rejected: {exc}") from exc
    items = response.get("items") if isinstance(response, dict) else None
    summary = response.get("summary") if isinstance(response, dict) else None
    if (not isinstance(response, dict) or response.get("ok") is not True
            or not isinstance(summary, dict) or summary.get("result_recorded") is not True
            or not isinstance(items, list) or not items or not isinstance(items[0], dict)
            or items[0].get("id") != record["run_id"]):
        outbox.mark_retryable(record, "Malformed remote result acknowledgement", 200)
        return False
    outbox.acknowledge(record, response)
    return True


def flush_pending(args: argparse.Namespace, credential: dict, outbox: RemoteOutbox) -> tuple[int, int]:
    acknowledged = 0
    retryable = 0
    for record in outbox.pending_records():
        if _upload_result(args, credential, outbox, record):
            acknowledged += 1
        else:
            retryable += 1
    return acknowledged, retryable


def _block_unknown_executing(outbox: RemoteOutbox) -> None:
    executing = outbox.executing_records()
    if executing:
        raise WorkerError("Outbox contains executing records with uncertain side effects; manual recovery is required")


def run_once(args: argparse.Namespace, credential: dict, workspace_roots: dict[str, Path],
             agentd: str, outbox: RemoteOutbox) -> bool:
    acknowledged, retryable = flush_pending(args, credential, outbox)
    if retryable:
        raise RemoteRequestError("Pending remote result upload is retryable")
    if acknowledged:
        return True
    if outbox.has_quarantined():
        raise WorkerError("Outbox contains quarantined records; refusing new remote claims")
    _block_unknown_executing(outbox)
    worker_presence = discover_worker_presence(args)
    _request_json(args.server, "/api/hermes/v1/remote/presence", {
        **worker_presence, "idempotency_key": "presence:" + uuid.uuid4().hex,
    }, credential)
    claim_idempotency_key = f"claim:{credential['device_id']}:{time.time_ns()}"
    claim = _request_json(args.server, "/api/hermes/v1/remote/claim", {
        "idempotency_key": claim_idempotency_key,
        "worker_version": WORKER_VERSION,
        "runtime_capabilities": args.runtime_capability,
        "worker_id": worker_presence["worker_id"],
    }, credential)
    if not claim.get("items"):
        return False
    task = claim["items"][0]
    task["_worker_presence"] = worker_presence
    workspace_id = task["workspace_id"]
    root = workspace_roots.get(workspace_id)
    if root is None:
        raise WorkerError(f"No local root mapping for workspace {workspace_id}")
    record = outbox.journal_claim(task, claim_idempotency_key=claim_idempotency_key)
    result = _execute_task(agentd, root, task, args.server, credential)
    record = outbox.save_result(record, result)
    if not _upload_result(args, credential, outbox, record):
        raise RemoteRequestError("Pending remote result upload is retryable")
    return True


def run_worker(args: argparse.Namespace) -> int:
    _require_tls_or_loopback(args.server)
    credential = _load_credential(Path(args.credential_file))
    _assert_credential_server(args.server, credential)
    args.worker_id = uuid.uuid4().hex
    outbox = RemoteOutbox(Path(args.outbox_dir) if args.outbox_dir else default_outbox_dir(Path(args.credential_file)),
                          credential)
    if args.outbox_status:
        print(json.dumps(outbox.status(), sort_keys=True))
        return 0
    with OutboxLock(outbox.path):
        if args.flush_only:
            acknowledged, retryable = flush_pending(args, credential, outbox)
            _block_unknown_executing(outbox)
            if outbox.has_quarantined():
                raise WorkerError("Outbox contains quarantined records")
            if retryable:
                raise RemoteRequestError("Pending remote result upload is retryable")
            return 0
        workspace_roots = _workspace_map(args.workspace_map)
        agentd = args.agentd or shutil.which("sop-agentd") or ""
        if not agentd or not Path(agentd).is_file():
            raise WorkerError("sop-agentd binary not found; pass --agentd")
        backoff = args.poll_interval
        while True:
            try:
                claimed = run_once(args, credential, workspace_roots, agentd, outbox)
                backoff = args.poll_interval
                if args.once:
                    return 0 if claimed else 2
                time.sleep(args.poll_interval)
            except RemoteRequestError as exc:
                if not exc.retryable:
                    raise
                if args.once:
                    raise
                time.sleep(backoff)
                backoff = min(backoff * 2, 60.0)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m hermes_core.remote_worker",
        description="Poll Hermes remote execution tasks and execute command or agent nodes through sop-agentd.",
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
    parser.add_argument("--outbox-dir", default="", help="Durable result outbox directory; defaults to CREDENTIAL_FILE.outbox")
    parser.add_argument("--outbox-status", action="store_true",
                        help="Print outbox JSON metadata only; never includes credentials or result logs")
    parser.add_argument("--flush-only", action="store_true",
                        help="Send pending outbox results only; do not claim or execute nodes")
    parser.add_argument("--poll-interval", type=float, default=5.0, help="Seconds between claim polls")
    parser.add_argument("--runtime-capability", action="append", default=["command"], choices=["command", "agent"],
                        help="Runtime kind this worker may claim; repeat to add agent. Defaults to command only.")
    return parser


def discover_worker_presence(args):
    if not getattr(args, "worker_id", ""):
        args.worker_id = uuid.uuid4().hex
    return {"worker_id": args.worker_id, "worker_version": WORKER_VERSION,
            "runtime_capabilities": sorted(set(args.runtime_capability)),
            "providers": [{"id": provider, "executable_present": bool(shutil.which(provider)),
                           "version": None, "auth": "unknown"} for provider in ("codex", "claude", "opencode")]}


def _load_pair_secret(args: argparse.Namespace) -> None:
    if args.pair_secret_stdin:
        if args.pair_secret:
            raise WorkerError("--pair-secret and --pair-secret-stdin are mutually exclusive")
        args.pair_secret = sys.stdin.read().strip()
        if not args.pair_secret:
            raise WorkerError("--pair-secret-stdin did not provide a pairing secret")
    elif not args.pair_secret:
        args.pair_secret = os.environ.get("HERMES_PAIR_SECRET", "").strip()


def _validate_modes(args: argparse.Namespace) -> None:
    if args.pair_secret:
        if args.once or args.flush_only or args.outbox_status:
            raise WorkerError("Pairing mode is mutually exclusive with worker run modes")
        if not args.device_id:
            raise WorkerError("--device-id is required with --pair-secret")
    if args.flush_only and args.once:
        raise WorkerError("--flush-only and --once are mutually exclusive")
    if args.outbox_status and (args.flush_only or args.once):
        raise WorkerError("--outbox-status is mutually exclusive with --flush-only and --once")
    if not math.isfinite(args.poll_interval) or args.poll_interval <= 0:
        raise WorkerError("--poll-interval must be finite and greater than zero")


def _safe_os_error(exc: OSError) -> str:
    reason = exc.strerror or type(exc).__name__
    return f"filesystem error: {reason}"


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        _load_pair_secret(args)
        _validate_modes(args)
        if args.pair_secret:
            return pair_device(args)
        return run_worker(args)
    except OutboxError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"error: {_safe_os_error(exc)}", file=sys.stderr)
        return 1
    except WorkerError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
