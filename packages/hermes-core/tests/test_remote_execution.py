from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import sysconfig
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
from hermes_core.models import Principal
from hermes_core.remote import _credential_row, is_paired_device
from hermes_core.remote_worker import WorkerError, _load_credential, _request_json, _write_credential
from hermes_core.transactional import Store

ROOT = Path(__file__).resolve().parents[3]
CORE = ROOT / "packages" / "hermes-core"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _serve(handler_type):
    server = HTTPServer(("127.0.0.1", 0), handler_type)
    thread = threading.Thread(target=server.serve_forever)
    thread.daemon = True
    thread.start()
    return server, f"http://127.0.0.1:{server.server_port}"


def _json(method: str, url: str, body: dict | None = None, headers: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = Request(url, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})  # noqa: S310
    with urlopen(req, timeout=10) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def _assert_http(code: int, method: str, url: str, body: dict | None = None, headers: dict | None = None) -> dict:
    with pytest.raises(HTTPError) as caught:
        _json(method, url, body, headers)
    assert caught.value.code == code
    return json.loads(caught.value.read().decode("utf-8"))


def test_worker_credential_file_refuses_symlink_and_existing_path(tmp_path: Path):
    if os.name == "nt" or not hasattr(os, "symlink"):
        pytest.skip("symlink credential checks are POSIX-only")
    target = tmp_path / "target.json"
    target.write_text("{}", encoding="utf-8")
    target.chmod(0o600)
    link = tmp_path / "credential.json"
    os.symlink(target, link)
    with pytest.raises(WorkerError, match="regular non-symlink|already exists"):
        _write_credential(link, {"device_id": "d", "workspace_id": "w", "credential": "secret"})
    with pytest.raises(WorkerError, match="regular non-symlink"):
        _load_credential(link)
    existing = tmp_path / "existing.json"
    _write_credential(existing, {"device_id": "d", "workspace_id": "w", "credential": "secret"})
    with pytest.raises(WorkerError, match="already exists"):
        _write_credential(existing, {"device_id": "d", "workspace_id": "w", "credential": "secret2"})


def test_worker_request_rejects_redirect_without_leaking_authorization():
    captured: list[str] = []

    class Target(BaseHTTPRequestHandler):
        def do_POST(self):
            captured.append(self.headers.get("Authorization", ""))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *_args):
            return

    target_server, target_url = _serve(Target)

    class Redirect(BaseHTTPRequestHandler):
        def do_POST(self):
            self.send_response(307)
            self.send_header("Location", target_url + "/capture")
            self.end_headers()

        def log_message(self, *_args):
            return

    redirect_server, redirect_url = _serve(Redirect)
    try:
        with pytest.raises(WorkerError) as caught:
            _request_json(redirect_url, "/start", {"secret": "body-secret"}, {
                "device_id": "device-1",
                "credential": "auth-secret",
                "server": redirect_url,
            })
        assert "redirect" in str(caught.value).lower()
        assert "auth-secret" not in str(caught.value)
        assert "body-secret" not in str(caught.value)
        assert captured == []
    finally:
        redirect_server.shutdown()
        target_server.shutdown()


def test_worker_rejects_ambiguous_server_urls():
    for server in ("https://user@example.test", "https://example.test?x=1", "https://example.test/#frag"):
        with pytest.raises(WorkerError):
            _request_json(server, "/api/hermes/v1/remote/claim", {})


def test_worker_rejects_credential_server_mismatch():
    with pytest.raises(WorkerError, match="different Hermes server"):
        _request_json("https://hermes.example.test", "/api/hermes/v1/remote/claim", {}, {
            "device_id": "device-1",
            "credential": "auth-secret",
            "server": "https://other.example.test",
        })


@pytest.fixture(scope="session")
def agentd_binary(tmp_path_factory: pytest.TempPathFactory) -> Path:
    configured = os.environ.get("HERMES_TEST_AGENTD", "")
    if configured and Path(configured).is_file():
        return Path(configured)
    if not shutil_which("go"):
        pytest.skip("Go is required to build sop-agentd for remote execution integration tests")
    binary = tmp_path_factory.mktemp("agentd") / "sop-agentd"
    subprocess.run([shutil_which("go") or "go", "build", "-o", str(binary), "./cmd/sop-agentd"],  # noqa: S603
                   cwd=ROOT / "apps" / "agent-runtime", check=True, timeout=120)
    return binary


def shutil_which(name: str) -> str | None:
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(directory) / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


@pytest.fixture
def remote_server(tmp_path: Path):
    port = _free_port()
    data_dir = tmp_path / "data"
    server_script = tmp_path / "remote_server.py"
    server_script.write_text(
        "from pathlib import Path\n"
        "import sys\n"
        "import uvicorn\n"
        "from fastapi import FastAPI, Request\n"
        "from hermes_core.api import create_router, install_errors\n"
        "from hermes_core.execution import Execution\n"
        "from hermes_core.models import CoreError, Principal\n"
        "from hermes_core.remote import create_remote_router\n"
        "from hermes_core.transactional import Store\n"
        "\n"
        "def identity(request: Request):\n"
        "    auth = request.headers.get('Authorization', '')\n"
        "    if auth == 'Bearer owner-token':\n"
        "        return Principal('owner')\n"
        "    raise CoreError('unauthorized', 'Workspace token is invalid', 401)\n"
        "\n"
        "data_dir = Path(sys.argv[1])\n"
        "port = int(sys.argv[2])\n"
        "data_dir.mkdir(parents=True, exist_ok=True)\n"
        "store = Store('sqlite:///' + str((data_dir / 'workspace.sqlite').resolve()))\n"
        "execution = Execution(store, data_dir)\n"
        "app = FastAPI(title='Hermes Remote Test')\n"
        "app.state.hermes_store = store\n"
        "app.state.hermes_execution = execution\n"
        "install_errors(app)\n"
        "app.include_router(create_remote_router(store, identity))\n"
        "app.include_router(create_router(store, execution, identity))\n"
        "uvicorn.run(app, host='127.0.0.1', port=port, log_level='warning')\n",
        encoding="utf-8",
    )
    interpreter = sys._base_executable if os.name == "nt" else sys.executable
    package_paths = sorted({sysconfig.get_path("purelib"), sysconfig.get_path("platlib")}) if os.name == "nt" else []
    env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(CORE), *package_paths])}
    proc = subprocess.Popen([interpreter, str(server_script), str(data_dir), str(port)], env=env,  # noqa: S603
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    base = f"http://127.0.0.1:{port}/api/hermes/v1"
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            _json("GET", base + "/health")
            break
        except Exception:
            time.sleep(0.1)
    else:
        stdout, stderr = proc.communicate(timeout=1)
        pytest.fail(f"remote test server did not start\nstdout={stdout}\nstderr={stderr}")
    try:
        yield base, data_dir, proc
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


def _create_workspace_device_run(base: str, root: Path, nodes: list[dict], target_device_id: str = "device-1"):
    owner_headers = {"Authorization": "Bearer owner-token"}
    workspace = _json("POST", base + "/workspaces", {
        "data": {"name": "Remote QA", "root": str(root)},
        "idempotency_key": "workspace",
    }, owner_headers)["items"][0]
    headers = {**owner_headers, "X-Workspace-Id": workspace["id"]}
    device = _json("POST", base + "/devices", {"data": {"title": "CI worker"}, "idempotency_key": "device"}, headers)["items"][0]
    pairing = _json("POST", base + f"/devices/{device['id']}/pairing", {
        "expected_version": device["version"],
        "idempotency_key": "pairing",
        "dry_run": False,
    }, headers)["items"][0]
    paired = _json("POST", base + "/devices/pair", {"device_id": device["id"], "secret": pairing["pairing_secret"]})["items"][0]
    run = _json("POST", base + "/runs", {"data": {"title": "Remote Run", "nodes": nodes}, "idempotency_key": "run"}, headers)["items"][0]
    return workspace, device, paired, run, headers


def _pair_device(base: str, headers: dict, title: str, key: str) -> tuple[dict, dict]:
    device = _json("POST", base + "/devices", {"data": {"title": title}, "idempotency_key": key}, headers)["items"][0]
    pairing = _json("POST", base + f"/devices/{device['id']}/pairing", {
        "expected_version": device["version"],
        "idempotency_key": "pairing-" + key,
        "dry_run": False,
    }, headers)["items"][0]
    paired = _json("POST", base + "/devices/pair", {"device_id": device["id"], "secret": pairing["pairing_secret"]})["items"][0]
    return device, paired


def _review_command_target(base, data_dir, workspace, device, paired):
    from hermes_core.execution_targets import workspace_execution_targets

    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    _json("POST", base + "/remote/presence", {"idempotency_key": "presence:" + device["id"],
        "worker_id": "test-worker", "worker_version": "test", "runtime_capabilities": ["command"], "providers": []}, auth)
    store = Store("sqlite:///" + str((data_dir / "workspace.sqlite").resolve()))
    try:
        return workspace_execution_targets(store, None, Principal("owner"), workspace["id"])["devices"][0]
    finally:
        store.engine.dispose()


def _queue_remote(data_dir: Path, workspace_id: str, run: dict, device_id: str) -> dict:
    store = Store("sqlite:///" + str((data_dir / "workspace.sqlite").resolve()))
    return store.mutate(Principal("owner"), workspace_id, "runs", run["id"], operation="test.remote.queue",
                        key="queue:" + run["id"], request={}, trace="test", expected=run["version"],
                        transform=lambda item: {"status": "queued", "data": {**item["data"],
                            "target_device_id": device_id}})


def test_pairing_secret_is_one_use_and_only_hash_is_stored(remote_server):
    base, data_dir, _proc = remote_server
    workspace, device, paired, _run, headers = _create_workspace_device_run(base, data_dir.parent, [
        {"id": "noop", "argv": [sys.executable, "-c", "print('noop')"]}
    ])
    assert paired["credential"]
    detail = _json("GET", base + f"/devices/{device['id']}", headers=headers)["items"][0]
    raw = Store("sqlite:///" + str((data_dir / "workspace.sqlite").resolve())).get(
        Principal("owner"), workspace["id"], "devices", device["id"])
    assert paired["credential"] not in json.dumps(raw["data"])
    assert pairing_secret_absent(raw)
    credential = _credential_row(Store("sqlite:///" + str((data_dir / "workspace.sqlite").resolve())), device["id"])
    assert credential["credential_hash"]
    assert raw["data"]["pairing_used_at"]
    assert "credential_hash" not in paired["data"]
    assert "credential_hash" not in detail["data"]
    replay = _assert_http(409, "POST", base + f"/devices/{device['id']}/pairing", {
        "expected_version": device["version"],
        "idempotency_key": "pairing",
        "dry_run": False,
    }, headers)
    assert replay["error"]["code"] == "pairing_secret_unavailable"
    _assert_http(409, "POST", base + "/devices/pair",
                 {"device_id": device["id"], "secret": "already-used-secret-value"})
    store = Store("sqlite:///" + str((data_dir / "workspace.sqlite").resolve()))
    with store.transaction() as conn:
        assert is_paired_device(store, Principal("owner"), workspace["id"], device["id"], conn=conn) is True


def test_remote_responses_use_non_secret_cli_commands(remote_server):
    base, data_dir, _proc = remote_server
    owner_headers = {"Authorization": "Bearer owner-token"}
    workspace = _json("POST", base + "/workspaces", {
        "data": {"name": "Remote CLI", "root": str(data_dir.parent)},
        "idempotency_key": "workspace-cli",
    }, owner_headers)["items"][0]
    headers = {**owner_headers, "X-Workspace-Id": workspace["id"]}
    device = _json("POST", base + "/devices", {
        "data": {"title": "CLI worker"},
        "idempotency_key": "device-cli",
    }, headers)["items"][0]
    pairing_response = _json("POST", base + f"/devices/{device['id']}/pairing", {
        "expected_version": device["version"],
        "idempotency_key": "pairing-cli",
        "dry_run": False,
    }, headers)
    secret = pairing_response["items"][0]["pairing_secret"]
    assert pairing_response["cli"]["command"] == f"sop device get {device['id']} --json"
    assert "workspace list" not in pairing_response["cli"]["command"]
    assert secret not in json.dumps(pairing_response["cli"])
    assert secret not in json.dumps(pairing_response["audit"])
    paired_response = _json("POST", base + "/devices/pair", {"device_id": device["id"], "secret": secret})
    credential = paired_response["items"][0]["credential"]
    assert paired_response["cli"]["command"] == f"sop device get {device['id']} --json"
    assert credential not in json.dumps(paired_response["cli"])
    assert credential not in json.dumps(paired_response["audit"])
    run = _json("POST", base + "/runs", {
        "data": {"title": "Remote CLI run", "nodes": [{"id": "one", "argv": [sys.executable, "-c", "print('cli')"]}]},
        "idempotency_key": "run-cli",
    }, headers)["items"][0]
    _queue_remote(data_dir, workspace["id"], run, device["id"])
    auth = {"Authorization": "Bearer " + credential, "X-Hermes-Device-Id": device["id"]}
    claim_response = _json("POST", base + "/remote/claim", {"idempotency_key": "claim-cli",
                                                            "worker_version": "test"}, auth)
    claim = claim_response["items"][0]
    assert claim_response["cli"]["command"] == f"sop run get {run['id']} --json"
    heartbeat_response = _json("POST", base + "/remote/heartbeat", {
        "run_id": run["id"],
        "owner": claim["owner"],
        "idempotency_key": "heartbeat-cli",
    }, auth)
    assert heartbeat_response["cli"]["command"] == f"sop run get {run['id']} --json"
    result_response = _json("POST", base + "/remote/result", {
        "run_id": run["id"],
        "owner": claim["owner"],
        "node_id": "one",
        "idempotency_key": "result-cli",
        "result": {"exit_code": 0, "stdout": "cli", "duration_ms": 1},
    }, auth)
    assert result_response["cli"]["command"] == f"sop run get {run['id']} --json"
    metadata = json.dumps({"cli": result_response["cli"], "audit": result_response["audit"]})
    assert credential not in metadata
    assert secret not in metadata


def test_public_run_create_and_patch_reject_remote_claim_key_forgery(remote_server):
    base, _data_dir, _proc = remote_server
    owner_headers = {"Authorization": "Bearer owner-token"}
    workspace = _json("POST", base + "/workspaces", {
        "data": {"name": "Remote Forgery", "root": str(ROOT)},
        "idempotency_key": "workspace-forgery",
    }, owner_headers)["items"][0]
    headers = {**owner_headers, "X-Workspace-Id": workspace["id"]}
    create_error = _assert_http(422, "POST", base + "/runs", {
        "data": {
            "title": "Forged run",
            "remote_claim_key": "client-forged",
            "nodes": [{"id": "one", "argv": [sys.executable, "-c", "print('nope')"]}],
        },
        "idempotency_key": "run-forged",
    }, headers)
    assert create_error["error"]["code"] == "server_owned_fields"
    run = _json("POST", base + "/runs", {
        "data": {"title": "Patch target", "nodes": [{"id": "one", "argv": [sys.executable, "-c", "print('ok')"]}]},
        "idempotency_key": "run-forgery-target",
    }, headers)["items"][0]
    patch_error = _assert_http(422, "PATCH", base + f"/runs/{run['id']}", {
        "data": {"remote_claim_key": "client-forged"},
        "expected_version": run["version"],
        "idempotency_key": "patch-forged",
    }, headers)
    assert patch_error["error"]["code"] == "server_owned_fields"


def test_public_pair_task_dispatch_then_remote_claim_contract(remote_server):
    base, data_dir, _proc = remote_server
    owner_headers = {"Authorization": "Bearer owner-token"}
    root = data_dir.parent
    workspace = _json("POST", base + "/workspaces", {
        "data": {"name": "Remote Dispatch", "root": str(root)},
        "idempotency_key": "workspace-dispatch",
    }, owner_headers)["items"][0]
    headers = {**owner_headers, "X-Workspace-Id": workspace["id"]}
    device, paired = _pair_device(base, headers, "Dispatch worker", "dispatch-device")
    target = _review_command_target(base, data_dir, workspace, device, paired)
    task = _json("POST", base + "/tasks", {
        "data": {"title": "Public remote task", "acceptance_criteria": "command completes"},
        "idempotency_key": "dispatch-task",
    }, headers)["items"][0]
    try:
        dispatch = _json("POST", base + f"/tasks/{task['id']}/dispatch", {
            "expected_version": task["version"],
            "idempotency_key": "dispatch-plan",
            "dry_run": False,
            "target_device_id": device["id"],
            "target_basis": target["basis"],
            "nodes": [{"id": "one", "argv": [sys.executable, "-c", "print('public')"]}],
        }, headers)["items"][0]
    except HTTPError as exc:
        body = json.loads(exc.read().decode("utf-8"))
        if exc.code == 409 and body.get("error", {}).get("code") == "device_unpaired":
            pytest.skip("Delivery must call is_paired_device(..., conn=conn) after credential hashes moved out of entity data")
        raise
    run = dispatch["run"]
    assert run["data"]["target_device_id"] == device["id"]
    store = Store("sqlite:///" + str((data_dir / "workspace.sqlite").resolve()))
    queued = store.mutate(Principal("owner"), workspace["id"], "runs", run["id"], operation="test.remote.public-start",
                          key="public-start", request={}, trace="test", expected=run["version"],
                          transform=lambda item: {"status": "queued"})
    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    claim = _json("POST", base + "/remote/claim", {
        "idempotency_key": "public-claim",
        "worker_version": "test",
        "worker_id": "test-worker",
    }, auth)["items"][0]
    assert claim["run_id"] == queued["id"]
    assert claim["node"]["id"] == "one"
    assert claim["owner"].startswith("remote:")


def pairing_secret_absent(raw: dict) -> bool:
    data = json.dumps(raw["data"])
    return "pairing_secret" not in data and "pairing_hash" not in raw["data"]


def test_remote_worker_process_claims_executes_and_reports_result(remote_server, agentd_binary, tmp_path: Path):
    base, data_dir, _proc = remote_server
    workspace, device, paired, run, _headers = _create_workspace_device_run(base, tmp_path, [
        {"id": "write", "argv": [sys.executable, "-c", "from pathlib import Path; Path('remote.txt').write_text('ok'); print('done')"]}
    ])
    queued = _queue_remote(data_dir, workspace["id"], run, device["id"])
    credential_file = tmp_path / "remote-credential.json"
    credential_file.write_text(json.dumps({
        "device_id": device["id"],
        "workspace_id": workspace["id"],
        "credential": paired["credential"],
        "server": base.rsplit("/api/hermes/v1", 1)[0],
    }), encoding="utf-8")
    credential_file.chmod(0o600)
    result = subprocess.run([  # noqa: S603
        sys.executable, "-m", "hermes_core.remote_worker",
        "--server", base.rsplit("/api/hermes/v1", 1)[0],
        "--credential-file", str(credential_file),
        "--workspace-map", f"{workspace['id']}={tmp_path}",
        "--agentd", str(agentd_binary),
        "--once",
    ], cwd=ROOT, env={**os.environ, "PYTHONPATH": str(CORE)}, text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr
    assert (tmp_path / "remote.txt").read_text(encoding="utf-8") == "ok"
    finished = Store("sqlite:///" + str((data_dir / "workspace.sqlite").resolve())).get(
        Principal("owner"), workspace["id"], "runs", run["id"])
    assert finished["status"] == "completed"
    node_result = finished["data"]["node_results"]["write"]
    assert node_result["succeeded"] is True
    assert node_result["exit_code"] == 0
    assert node_result["stdout"].strip() == "done"
    assert queued["data"]["target_device_id"] == device["id"]


def test_duplicate_result_is_idempotent_and_conflicting_result_is_rejected(remote_server):
    base, data_dir, _proc = remote_server
    workspace, device, paired, run, _headers = _create_workspace_device_run(base, data_dir.parent, [
        {"id": "one", "argv": [sys.executable, "-c", "print('one')"]}
    ])
    _queue_remote(data_dir, workspace["id"], run, device["id"])
    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    claim = _json("POST", base + "/remote/claim", {"idempotency_key": "claim", "worker_version": "test"}, auth)["items"][0]
    body = {"run_id": run["id"], "owner": claim["owner"], "node_id": "one", "idempotency_key": "result",
            "result": {"exit_code": 0, "stdout": "ok", "stderr": "", "duration_ms": 1}}
    first = _json("POST", base + "/remote/result", body, auth)["items"][0]
    second = _json("POST", base + "/remote/result", body, auth)["items"][0]
    assert second == first
    conflict = {**body, "idempotency_key": "different", "result": {"exit_code": 1, "stdout": "bad"}}
    error = _assert_http(409, "POST", base + "/remote/result", conflict, auth)
    assert error["error"]["code"] == "result_conflict"


def test_claim_retry_returns_same_assignment(remote_server):
    base, data_dir, _proc = remote_server
    workspace, device, paired, run, _headers = _create_workspace_device_run(base, data_dir.parent, [
        {"id": "one", "argv": [sys.executable, "-c", "print('one')"]}
    ])
    _queue_remote(data_dir, workspace["id"], run, device["id"])
    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    first = _json("POST", base + "/remote/claim", {"idempotency_key": "claim", "worker_version": "test"}, auth)["items"][0]
    second = _json("POST", base + "/remote/claim", {"idempotency_key": "claim-retry", "worker_version": "test"}, auth)["items"][0]
    assert second["run_id"] == first["run_id"]
    assert second["owner"] == first["owner"]
    assert second["node"] == first["node"]


def test_claim_key_cannot_be_reused_for_next_node(remote_server):
    base, data_dir, _proc = remote_server
    workspace, device, paired, run, _headers = _create_workspace_device_run(base, data_dir.parent, [
        {"id": "one", "argv": [sys.executable, "-c", "print('one')"]},
        {"id": "two", "argv": [sys.executable, "-c", "print('two')"]},
    ])
    _queue_remote(data_dir, workspace["id"], run, device["id"])
    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    first = _json("POST", base + "/remote/claim", {"idempotency_key": "claim-same", "worker_version": "test"}, auth)["items"][0]
    _json("POST", base + "/remote/result", {
        "run_id": run["id"],
        "owner": first["owner"],
        "node_id": "one",
        "idempotency_key": "result-one",
        "result": {"exit_code": 0, "stdout": "one", "duration_ms": 1},
    }, auth)
    stale = _assert_http(409, "POST", base + "/remote/claim", {
        "idempotency_key": "claim-same",
        "worker_version": "test",
    }, auth)
    assert stale["error"]["code"] == "stale_claim_key"
    second = _json("POST", base + "/remote/claim", {"idempotency_key": "claim-new", "worker_version": "test"}, auth)["items"][0]
    assert second["run_id"] == run["id"]
    assert second["node"]["id"] == "two"
    assert second["owner"] != first["owner"]


def test_failed_remote_node_retry_new_claim_can_supersede_failed_result(remote_server):
    base, data_dir, _proc = remote_server
    owner_headers = {"Authorization": "Bearer owner-token"}
    root = data_dir.parent
    workspace = _json("POST", base + "/workspaces", {
        "data": {"name": "Remote Retry", "root": str(root)},
        "idempotency_key": "workspace-retry",
    }, owner_headers)["items"][0]
    headers = {**owner_headers, "X-Workspace-Id": workspace["id"]}
    device, paired = _pair_device(base, headers, "Retry worker", "retry-device")
    target = _review_command_target(base, data_dir, workspace, device, paired)
    task = _json("POST", base + "/tasks", {
        "data": {"title": "Retry remote task", "acceptance_criteria": "retry can pass after failed attempt"},
        "idempotency_key": "retry-task",
    }, headers)["items"][0]
    dispatch = _json("POST", base + f"/tasks/{task['id']}/dispatch", {
        "expected_version": task["version"],
        "idempotency_key": "retry-dispatch",
        "dry_run": False,
        "target_device_id": device["id"],
        "target_basis": target["basis"],
        "nodes": [{"id": "one", "argv": [sys.executable, "-c", "print('retry')"]}],
    }, headers)["items"][0]
    planned = dispatch["run"]
    queued = _json("POST", base + f"/runs/{planned['id']}/start", {
        "expected_version": planned["version"],
        "idempotency_key": "retry-start",
        "dry_run": False,
    }, headers)["items"][0]
    assert queued["status"] == "queued"
    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    first = _json("POST", base + "/remote/claim", {"idempotency_key": "retry-claim-1",
                                                   "worker_version": "test", "worker_id": "test-worker"}, auth)["items"][0]
    failed = _json("POST", base + "/remote/result", {
        "run_id": planned["id"],
        "owner": first["owner"],
        "node_id": "one",
        "idempotency_key": "retry-result-fail",
        "result": {"exit_code": 1, "stdout": "first failed", "duration_ms": 1,
                   "evidence_binding": {"run_id": "forged", "attempt": 99}},
    }, auth)["items"][0]
    assert failed["status"] == "failed"
    assert failed["data"]["node_results"]["one"]["execution_owner"] == first["owner"]
    from hermes_core.transactional import digest

    assert failed["data"]["node_results"]["one"]["evidence_binding"] == {
        "run_id": planned["id"], "node_id": "one", "attempt": 1,
        "command_sha256": digest(failed["data"]["nodes"][0])}
    retried = _json("POST", base + f"/runs/{planned['id']}/retry", {
        "expected_version": failed["version"],
        "idempotency_key": "retry-action",
        "dry_run": False,
    }, headers)["items"][0]
    assert retried["status"] == "retrying"
    stale = _assert_http(409, "POST", base + "/remote/result", {
        "run_id": planned["id"],
        "owner": first["owner"],
        "node_id": "one",
        "idempotency_key": "retry-result-stale-owner",
        "result": {"exit_code": 0, "stdout": "stale", "duration_ms": 1},
    }, auth)
    assert stale["error"]["code"] == "lease_lost"
    second = _json("POST", base + "/remote/claim", {"idempotency_key": "retry-claim-2",
                                                    "worker_version": "test", "worker_id": "test-worker"}, auth)["items"][0]
    assert second["run_id"] == planned["id"]
    assert second["node"]["id"] == "one"
    assert second["owner"] != first["owner"]
    completed = _json("POST", base + "/remote/result", {
        "run_id": planned["id"],
        "owner": second["owner"],
        "node_id": "one",
        "idempotency_key": "retry-result-success",
        "result": {"exit_code": 0, "stdout": "second passed", "duration_ms": 1},
    }, auth)["items"][0]
    assert completed["status"] == "completed"
    saved = completed["data"]["node_results"]["one"]
    assert saved["succeeded"] is True
    assert saved["stdout"] == "second passed"
    assert saved["execution_owner"] == second["owner"]
    assert saved["attempt"] == 2
    events = _json("GET", base + f"/runs/{planned['id']}/events", headers=headers)["items"]
    supersede_events = [event for event in events if event["action"] == "remote.result"
                        and event["data"].get("superseded_result_sha256")]
    assert supersede_events


def test_old_credential_is_rejected_after_repairing(remote_server):
    base, data_dir, _proc = remote_server
    workspace, device, paired, run, headers = _create_workspace_device_run(base, data_dir.parent, [
        {"id": "one", "argv": [sys.executable, "-c", "print('one')"]}
    ])
    _queue_remote(data_dir, workspace["id"], run, device["id"])
    active = _json("GET", base + f"/devices/{device['id']}", headers=headers)["items"][0]
    pairing = _json("POST", base + f"/devices/{device['id']}/pairing", {
        "expected_version": active["version"],
        "idempotency_key": "repair",
        "dry_run": False,
    }, headers)["items"][0]
    repaired = _json("POST", base + "/devices/pair", {
        "device_id": device["id"],
        "secret": pairing["pairing_secret"],
    })["items"][0]
    old_auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    error = _assert_http(401, "POST", base + "/remote/claim", {
        "idempotency_key": "old-credential",
        "worker_version": "test",
    }, old_auth)
    assert error["error"]["code"] == "unauthorized"
    new_auth = {"Authorization": "Bearer " + repaired["credential"], "X-Hermes-Device-Id": device["id"]}
    claim = _json("POST", base + "/remote/claim", {"idempotency_key": "new-credential", "worker_version": "test"},
                  new_auth)["items"][0]
    assert claim["run_id"] == run["id"]


def test_late_result_after_expired_lease_fails_for_review(remote_server):
    base, data_dir, _proc = remote_server
    workspace, device, paired, run, _headers = _create_workspace_device_run(base, data_dir.parent, [
        {"id": "one", "argv": [sys.executable, "-c", "print('one')"]}
    ])
    _queue_remote(data_dir, workspace["id"], run, device["id"])
    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    claim = _json("POST", base + "/remote/claim", {"idempotency_key": "claim", "worker_version": "test"}, auth)["items"][0]
    store = Store("sqlite:///" + str((data_dir / "workspace.sqlite").resolve()))
    running = store.get(Principal("owner"), workspace["id"], "runs", run["id"])
    store.mutate(Principal("owner"), workspace["id"], "runs", run["id"], operation="test.expire",
                 key="expire", request={}, trace="test", expected=running["version"],
                 transform=lambda item: {"data": {**item["data"], "lease_expires_at": 1}})
    error = _assert_http(409, "POST", base + "/remote/result", {
        "run_id": run["id"],
        "owner": claim["owner"],
        "node_id": "one",
        "idempotency_key": "late",
        "result": {"exit_code": 0, "stdout": "late", "duration_ms": 1},
    }, auth)
    assert error["error"]["code"] == "lease_lost"
    failed = store.get(Principal("owner"), workspace["id"], "runs", run["id"])
    assert failed["status"] == "failed"
    assert failed["data"]["recovery_requires_review"] is True


def test_cross_device_duplicate_result_is_forbidden_before_idempotency(remote_server):
    base, data_dir, _proc = remote_server
    workspace, device, paired, run, headers = _create_workspace_device_run(base, data_dir.parent, [
        {"id": "one", "argv": [sys.executable, "-c", "print('one')"]}
    ])
    second_device, second_paired = _pair_device(base, headers, "Other worker", "device-2")
    _queue_remote(data_dir, workspace["id"], run, device["id"])
    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    claim = _json("POST", base + "/remote/claim", {"idempotency_key": "claim", "worker_version": "test"}, auth)["items"][0]
    body = {"run_id": run["id"], "owner": claim["owner"], "node_id": "one", "idempotency_key": "result",
            "result": {"exit_code": 0, "stdout": "ok", "duration_ms": 1}}
    _json("POST", base + "/remote/result", body, auth)
    other_auth = {"Authorization": "Bearer " + second_paired["credential"], "X-Hermes-Device-Id": second_device["id"]}
    error = _assert_http(403, "POST", base + "/remote/result", body, other_auth)
    assert error["error"]["code"] == "forbidden"


def test_revoke_race_blocks_heartbeat_and_result(remote_server):
    base, data_dir, _proc = remote_server
    workspace, device, paired, run, headers = _create_workspace_device_run(base, data_dir.parent, [
        {"id": "one", "argv": [sys.executable, "-c", "print('one')"]}
    ])
    _queue_remote(data_dir, workspace["id"], run, device["id"])
    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    claim = _json("POST", base + "/remote/claim", {"idempotency_key": "claim", "worker_version": "test"}, auth)["items"][0]
    active = _json("GET", base + f"/devices/{device['id']}", headers=headers)["items"][0]
    revoked = _json("POST", base + f"/devices/{device['id']}/revoke", {
        "expected_version": active["version"],
        "idempotency_key": "revoke",
        "dry_run": False,
    }, headers)["items"][0]
    assert revoked["status"] == "revoked"
    heartbeat = _assert_http(403, "POST", base + "/remote/heartbeat", {
        "run_id": run["id"],
        "owner": claim["owner"],
        "idempotency_key": "heartbeat",
    }, auth)
    assert heartbeat["error"]["code"] == "device_revoked"
    result = _assert_http(403, "POST", base + "/remote/result", {
        "run_id": run["id"],
        "owner": claim["owner"],
        "node_id": "one",
        "idempotency_key": "result",
        "result": {"exit_code": 0, "stdout": "ok", "duration_ms": 1},
    }, auth)
    assert result["error"]["code"] == "device_revoked"


def test_result_validation_rejects_bool_exit_and_honors_ok_false(remote_server):
    base, data_dir, _proc = remote_server
    workspace, device, paired, run, _headers = _create_workspace_device_run(base, data_dir.parent, [
        {"id": "one", "argv": [sys.executable, "-c", "print('one')"]}
    ])
    _queue_remote(data_dir, workspace["id"], run, device["id"])
    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    claim = _json("POST", base + "/remote/claim", {"idempotency_key": "claim", "worker_version": "test"}, auth)["items"][0]
    bool_exit = _assert_http(422, "POST", base + "/remote/result", {
        "run_id": run["id"],
        "owner": claim["owner"],
        "node_id": "one",
        "idempotency_key": "bad-bool",
        "result": {"exit_code": True, "duration_ms": 1},
    }, auth)
    assert bool_exit["error"]["code"] == "invalid_result"
    bad_duration = _assert_http(422, "POST", base + "/remote/result", {
        "run_id": run["id"],
        "owner": claim["owner"],
        "node_id": "one",
        "idempotency_key": "bad-duration",
        "result": {"exit_code": 0, "duration_ms": "slow"},
    }, auth)
    assert bad_duration["error"]["code"] == "invalid_result"
    _json("POST", base + "/remote/result", {
        "run_id": run["id"],
        "owner": claim["owner"],
        "node_id": "one",
        "idempotency_key": "ok-false",
        "result": {"ok": False, "exit_code": 0, "stdout": "not ok", "duration_ms": 1},
    }, auth)
    failed = Store("sqlite:///" + str((data_dir / "workspace.sqlite").resolve())).get(
        Principal("owner"), workspace["id"], "runs", run["id"])
    assert failed["status"] == "failed"
    assert failed["data"]["node_results"]["one"]["succeeded"] is False


def test_remote_claim_fails_closed_for_agent_nodes(remote_server):
    base, data_dir, _proc = remote_server
    workspace, device, paired, _run, _headers = _create_workspace_device_run(base, data_dir.parent, [
        {"id": "seed", "argv": [sys.executable, "-c", "print('seed')"]}
    ])
    store = Store("sqlite:///" + str((data_dir / "workspace.sqlite").resolve()))
    run = store.create(Principal("owner"), workspace["id"], "runs", {
        "title": "Agent node",
        "nodes": [{"id": "delegate", "kind": "agent", "agent_id": "agent-1", "prompt": "do work"}],
        "workspace_root": str(data_dir.parent),
        "workspace_version": workspace["version"],
        "target_device_id": device["id"],
    }, "agent-run", "test", status="queued")
    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    claim = _json("POST", base + "/remote/claim", {"idempotency_key": "claim", "worker_version": "test"}, auth)
    assert claim["items"] == []
    failed = store.get(Principal("owner"), workspace["id"], "runs", run["id"])
    assert failed["status"] == "failed"
    assert "agent nodes" in failed["data"]["error"]
