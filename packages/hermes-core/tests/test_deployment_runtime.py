import hashlib
import json
import ssl
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from hermes_core.api import create_app
from hermes_core.deployment_contract import OperationPlan, OperationResult, strict_json
from hermes_core.deployment_runner import execute_operation
from hermes_core.deployments import ManagedDeployments, receipt_request
from hermes_core.execution_targets import workspace_execution_targets
from hermes_core.models import CoreError, Principal


@pytest.fixture
def artifact(tmp_path, monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(timezone.utc) - timedelta(days=1))
        .not_valid_after(datetime.now(timezone.utc) + timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    cert_file, key_file = tmp_path / "ca.pem", tmp_path / "key.pem"
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
    )
    payload = b"actual verified release artifact\n"
    (tmp_path / "release.bin").write_bytes(payload)

    class ArtifactHandler(SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "/release.bin")
                self.end_headers()
            else:
                super().do_GET()

    handler = partial(ArtifactHandler, directory=str(tmp_path))
    server = ThreadingHTTPServer(("localhost", 0), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert_file, key_file)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("SSL_CERT_FILE", str(cert_file))
    origin = f"https://localhost:{server.server_port}"
    yield origin, hashlib.sha256(payload).hexdigest()
    server.shutdown()
    server.server_close()
    thread.join()


@pytest.fixture
def plan(tmp_path, artifact):
    origin, checksum = artifact
    helper = tmp_path / "driver.py"
    helper.write_text(
        """import datetime,json,pathlib,sys
root=pathlib.Path.cwd()
if sys.argv[1]=='apply':
    journal=list((root/'.sop-deploy').glob('*/journal.json'))[0]
    assert json.loads(journal.read_text())['state']=='started'
    p=root/'applications.txt';p.write_text(p.read_text()+'1' if p.exists() else '1')
    (root/'state.json').write_text(json.dumps({'operation_id':sys.argv[2],'artifact_sha256':sys.argv[3],'traffic_percent':int(sys.argv[4])}))
else:
    data=json.loads((root/'state.json').read_text()); data.update(healthy=True,sample_count=1,observed_at=datetime.datetime.now(datetime.timezone.utc).isoformat()); print(json.dumps(data))
""",
        encoding="utf-8",
    )
    return {
        "protocol": "sop.deployment.v1",
        "operation_id": "operation-one",
        "tenant_id": "local",
        "project_id": "project",
        "environment_id": "staging",
        "environment_generation": 1,
        "candidate_id": "candidate",
        "kind": "deploy",
        "artifact_url": origin + "/release.bin",
        "artifact_sha256": checksum,
        "commit_sha": "a" * 40,
        "traffic_percent": 100,
        "apply_argv": [
            sys.executable,
            str(helper),
            "apply",
            "{operation_id}",
            "{artifact_sha256}",
            "{traffic_percent}",
        ],
        "probe_argv": [sys.executable, str(helper), "probe"],
        "artifact_origins": [origin],
        "max_artifact_bytes": 4096,
        "timeout_seconds": 6,
        "observation_seconds": 1,
        "min_samples": 2,
    }


def test_real_tls_apply_probe_receipt_and_repeat_without_side_effects(tmp_path, plan):
    result = execute_operation(plan, tmp_path)
    assert OperationResult.model_validate(result).status == "verified", result
    assert result["observation_seconds"] >= 1
    assert len(result["probes"]) >= 2
    assert (tmp_path / "applications.txt").read_text() == "1"
    assert execute_operation(plan, tmp_path) == result
    assert (tmp_path / "applications.txt").read_text() == "1"
    with pytest.raises((ValueError, CoreError)):
        execute_operation({**plan, "traffic_percent": 50}, tmp_path)


def test_crash_before_terminal_result_is_unknown_and_observe_does_not_apply(tmp_path, plan, monkeypatch):
    import hermes_core.deployment_runner as runner

    original = runner._observe
    monkeypatch.setattr(
        runner, "_observe", lambda *args, **kwargs: (_ for _ in ()).throw(KeyboardInterrupt())
    )
    with pytest.raises(KeyboardInterrupt):
        execute_operation(plan, tmp_path)
    assert execute_operation(plan, tmp_path)["status"] == "unknown"
    monkeypatch.setattr(runner, "_observe", original)
    observed = execute_operation(plan, tmp_path, observe=True)
    assert observed["status"] == "verified", observed
    assert (tmp_path / "applications.txt").read_text() == "1"


def test_observe_recorded_nonzero_apply_stays_failed_without_probing(tmp_path, plan, monkeypatch):
    import hermes_core.deployment_runner as runner

    helper = tmp_path / "driver.py"
    helper.write_text(
        helper.read_text()
        + "\nif sys.argv[1]=='apply': raise SystemExit(1)\n"
        + "else: (root/'probe-called').write_text('1')\n"
    )
    original_write = runner._write

    def crash_after_durable_exit(path, value):
        original_write(path, value)
        if value.get("state") == "started" and value.get("apply", {}).get("exit_code") == 1:
            raise SystemExit("Process loss after the actual failed apply was fsynced")

    monkeypatch.setattr(runner, "_write", crash_after_durable_exit)
    with pytest.raises(SystemExit):
        execute_operation(plan, tmp_path)
    monkeypatch.setattr(runner, "_write", original_write)
    observed = execute_operation(plan, tmp_path, observe=True)
    assert observed["status"] == "failed", observed
    assert observed["apply"]["exit_code"] == 1
    assert observed["apply"]["reused"] is True
    assert observed["probes"] == []
    assert not (tmp_path / "probe-called").exists()
    assert (tmp_path / "applications.txt").read_text() == "1"
    assert execute_operation(plan, tmp_path, observe=True) == observed
    assert (tmp_path / "applications.txt").read_text() == "1"


@pytest.mark.parametrize("exit_code,allowed", [(0, True), (None, True), (1, False), (-1, False)])
def test_verified_reused_result_rejects_known_apply_failure(tmp_path, plan, exit_code, allowed):
    result = execute_operation(plan, tmp_path)
    assert result["status"] == "verified", result
    recovered = {**result, "apply": {**result["apply"], "reused": True, "exit_code": exit_code}}
    if allowed:
        assert OperationResult.model_validate(recovered).status == "verified"
    else:
        with pytest.raises(ValueError):
            OperationResult.model_validate(recovered)


@pytest.mark.parametrize(
    "change",
    [
        {"artifact_sha256": "0" * 64},
        {"max_artifact_bytes": 2},
        {"probe_argv": [sys.executable, "-c", "print('invalid-json')"]},
        {"probe_argv": [sys.executable, "-c", "print('NaN')"]},
    ],
)
def test_real_artifact_or_probe_failure_never_verifies(tmp_path, plan, change):
    result = execute_operation({**plan, **change}, tmp_path)
    assert result["status"] == "failed", result
    if "artifact_sha256" in change or "max_artifact_bytes" in change:
        assert not (tmp_path / "applications.txt").exists()


@pytest.mark.parametrize(
    "change",
    [
        {"timeout_seconds": True},
        {"traffic_percent": True},
        {"environment_generation": True},
        {"artifact_url": "http://localhost/file"},
        {"artifact_url": "https://localhost/file?q=1"},
        {"artifact_origins": ["https://user:password@localhost"]},
        {"apply_argv": ["tool", "{unknown}"]},
        {"extra": "forbidden"},
        {"timeout_seconds": 3, "observation_seconds": 2},
        {"probe_argv": ["tool", "x" * 17000]},
        {"apply_argv": ["tool", "{unknown-token}"]},
        {"probe_argv": ["tool", "{unterminated"]},
    ],
)
def test_strict_contract(plan, change):
    with pytest.raises(ValueError):
        OperationPlan.model_validate({**plan, **change})


@pytest.mark.parametrize("raw", ['{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}', '{"a":1e999}', "[]", '"x"'])
def test_strict_json_rejects_ambiguous_payload(raw):
    with pytest.raises(ValueError):
        strict_json(raw)


def test_observe_missing_journal_cannot_apply(tmp_path, plan):
    assert execute_operation(plan, tmp_path, observe=True)["status"] == "unknown"
    assert not (tmp_path / "applications.txt").exists()


def test_artifact_redirect_and_untrusted_tls_are_rejected_before_apply(tmp_path, plan, monkeypatch):
    redirect = {**plan, "artifact_url": plan["artifact_origins"][0] + "/redirect"}
    assert execute_operation(redirect, tmp_path)["status"] == "failed"
    monkeypatch.delenv("SSL_CERT_FILE")
    untrusted = execute_operation({**plan, "operation_id": "untrusted-tls"}, tmp_path)
    assert untrusted["status"] == "failed"
    assert "CERTIFICATE_VERIFY_FAILED" in untrusted["error"]
    assert not (tmp_path / "applications.txt").exists()


def test_real_cli_process_interruption_never_reapplies_and_observe_recovers(tmp_path, plan):
    command = [sys.executable, "-m", "hermes_core.deployment_runner", "--plan-json", json.dumps(plan)]
    process = subprocess.Popen(command, cwd=tmp_path, stdout=subprocess.PIPE, stderr=subprocess.PIPE)  # noqa: S603
    deadline = time.monotonic() + 10
    try:
        while not (tmp_path / "applications.txt").exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert (tmp_path / "applications.txt").read_text() == "1"
    finally:
        process.kill()
        process.communicate(timeout=5)
    repeated = subprocess.run(command, cwd=tmp_path, capture_output=True, text=True, timeout=10)  # noqa: S603
    assert repeated.returncode == 2
    assert strict_json(repeated.stdout, max_bytes=65536)["status"] == "unknown"
    observed = subprocess.run(  # noqa: S603
        [*command, "--observe"], cwd=tmp_path, capture_output=True, text=True, timeout=10
    )
    assert observed.returncode == 0, observed.stdout + observed.stderr
    assert strict_json(observed.stdout, max_bytes=65536)["status"] == "verified"
    assert (tmp_path / "applications.txt").read_text() == "1"


def test_actual_apply_timeout_is_unknown_without_reexecution(tmp_path, plan):
    slow = [
        sys.executable,
        "-c",
        "import pathlib,time;p=pathlib.Path('count');p.write_text('1');time.sleep(20)",
    ]
    result = execute_operation({**plan, "apply_argv": slow, "timeout_seconds": 3}, tmp_path)
    assert result["status"] == "unknown", result
    repeated = execute_operation({**plan, "apply_argv": slow, "timeout_seconds": 3}, tmp_path)
    assert repeated["status"] == "unknown"
    assert (tmp_path / "count").read_text() == "1"


def test_full_window_with_one_hundred_probes_is_bounded(tmp_path, plan):
    result = execute_operation({**plan, "min_samples": 100, "timeout_seconds": 60}, tmp_path)
    assert result["status"] == "verified", result
    assert len(result["probes"]) == 100
    assert len(json.dumps(result, ensure_ascii=False).encode("utf-8")) <= 61440
    assert all("stdout" not in probe for probe in result["probes"])


def test_verified_result_rejects_forged_or_nonfinite_evidence(tmp_path, plan):
    result = execute_operation(plan, tmp_path)
    assert result["status"] == "verified"
    with pytest.raises(ValueError):
        OperationResult.model_validate({**result, "probes": [{**result["probes"][0], "traffic_percent": 1}]})
    with pytest.raises(ValueError):
        OperationResult.model_validate({**result, "observation_seconds": float("nan")})


def test_journal_symlink_is_rejected(tmp_path, plan):
    outside = tmp_path / "outside"
    outside.mkdir()
    try:
        (tmp_path / ".sop-deploy").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symlink privilege unavailable")
    with pytest.raises((ValueError, OSError)):
        execute_operation(plan, tmp_path)


@pytest.mark.parametrize("change", ["traffic", "old", "future", "unhealthy", "count", "identity"])
def test_real_probe_rejects_wrong_identity_stale_or_false_evidence(tmp_path, plan, change):
    probe = tmp_path / "bad_probe.py"
    probe.write_text(
        """import datetime,json,pathlib,sys
data=json.loads(pathlib.Path('state.json').read_text())
data.update(healthy=True,sample_count=1,observed_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
case=sys.argv[1]
if case=='traffic': data['traffic_percent']=1
if case=='old': data['observed_at']='2000-01-01T00:00:00+00:00'
if case=='future': data['observed_at']='2100-01-01T00:00:00+00:00'
if case=='unhealthy': data['healthy']=False
if case=='count': data['sample_count']=True
if case=='identity': data['operation_id']='other-operation'
print(json.dumps(data))
""",
        encoding="utf-8",
    )
    result = execute_operation({**plan, "probe_argv": [sys.executable, str(probe), change]}, tmp_path)
    assert result["status"] == "failed", result
    assert (tmp_path / "applications.txt").read_text() == "1"
    assert result["probes"][-1]["error"]
    assert result["probes"][-1]["exit_code"] == 0
    assert result["probes"][-1]["duration_ms"] >= 0


def test_apply_output_is_bounded_without_losing_real_health_evidence(tmp_path, plan):
    helper = tmp_path / "driver.py"
    helper.write_text(
        helper.read_text()
        + "\nif sys.argv[1]=='apply': print('x'*100000);print('e'*100000,file=sys.stderr)\n"
    )
    result = execute_operation(plan, tmp_path)
    assert result["status"] == "verified", result
    assert result["apply"]["stdout_truncated"] and result["apply"]["stderr_truncated"]
    assert len(result["apply"]["stdout"].encode()) <= 4096
    assert len(json.dumps(result).encode()) <= 61440


@pytest.fixture
def managed(tmp_path):
    app = create_app(
        tmp_path / "core", "owner", principals={"owner": Principal("owner")}, agentd=sys.executable
    )
    client = TestClient(app, headers={"Authorization": "Bearer owner"})
    response = client.post(
        "/api/hermes/v1/workspaces",
        json={"idempotency_key": "ws", "data": {"name": "deployment", "root": str(tmp_path)}},
    )
    workspace = response.json()["items"][0]
    client.headers["X-Workspace-Id"] = workspace["id"]
    store, execution = app.state.hermes_store, app.state.hermes_execution
    service = ManagedDeployments(store, execution)
    target = workspace_execution_targets(store, execution, Principal("owner"), workspace["id"])["local"]
    yield client, store, service, workspace["id"], target
    store.engine.dispose()


def test_managed_prepare_is_pure_receipt_recovery_and_permissions(managed, plan):
    _, store, service, workspace, target = managed
    principal = Principal("owner")
    data = service.prepare(
        principal,
        workspace,
        plan=plan,
        runner_argv=[sys.executable, "-m", "hermes_core.deployment_runner"],
        target_snapshot=target,
    )
    assert data["deployment_source"]["plan"] == plan
    assert not store.list(principal, workspace, "runs")
    kwargs = dict(
        plan=plan,
        runner_argv=[sys.executable, "-m", "hermes_core.deployment_runner"],
        target_snapshot=target,
        key="operation",
    )
    first = service.dispatch(principal, workspace, **kwargs)
    assert (
        store.receipt(
            principal,
            workspace,
            "deployment.dispatch",
            "operation",
            receipt_request(plan, kwargs["runner_argv"], target),
        )
        == first
    )
    service.execution.allow_commands = False
    assert service.dispatch(principal, workspace, **kwargs) == first
    assert not store.list(principal, workspace, "tasks")
    with pytest.raises(CoreError) as denied:
        service.dispatch(Principal("reader", permissions=frozenset({"read"})), workspace, **kwargs)
    assert denied.value.status == 403
    with pytest.raises(CoreError):
        service.dispatch(Principal("owner", workspace_ids=frozenset()), workspace, **kwargs)


def test_managed_start_cancel_and_generic_actions_cannot_bypass(managed, plan):
    client, store, service, workspace, target = managed
    principal = Principal("owner")
    run = service.dispatch(
        principal,
        workspace,
        plan=plan,
        runner_argv=[sys.executable, "-m", "hermes_core.deployment_runner"],
        target_snapshot=target,
        key="operation",
    )
    for action in ("start", "retry", "replay", "cancel"):
        response = client.post(
            f"/api/hermes/v1/runs/{run['id']}/{action}",
            json={"expected_version": run["version"], "idempotency_key": action, "dry_run": False},
        )
        assert response.status_code == 409, response.text
    response = client.patch(
        f"/api/hermes/v1/runs/{run['id']}",
        json={"expected_version": run["version"], "idempotency_key": "patch", "data": {"title": "bypass"}},
    )
    assert response.status_code == 409, response.text
    started = service.start(principal, workspace, run["id"], key="start")
    assert started["status"] == "queued"
    assert service.start(principal, workspace, run["id"], key="start") == started
    cancelled = service.cancel(principal, workspace, run["id"], key="cancel")
    assert cancelled["status"] == "cancelled"
    assert (
        store.get(principal, workspace, "runs", run["id"])["data"]["deployment_source"]
        == run["data"]["deployment_source"]
    )


def test_managed_start_revalidates_target_and_replay_keeps_original_receipt(managed, plan):
    _, store, service, workspace, target = managed
    principal = Principal("owner")
    kwargs = dict(
        plan=plan,
        runner_argv=[sys.executable, "-m", "hermes_core.deployment_runner"],
        target_snapshot=target,
        key="operation",
    )
    run = service.dispatch(principal, workspace, **kwargs)
    with pytest.raises(CoreError) as conflict:
        service.dispatch(principal, workspace, **{**kwargs, "plan": {**plan, "traffic_percent": 50}})
    assert conflict.value.code == "idempotency_conflict"
    service.execution.allow_commands = False
    with pytest.raises(CoreError) as unavailable:
        service.start(principal, workspace, run["id"], key="start")
    assert unavailable.value.code in {"target_basis_changed", "target_unavailable"}
    assert store.get(principal, workspace, "runs", run["id"])["status"] == "planned"
    service.execution.allow_commands = True
    started = service.start(principal, workspace, run["id"], key="start")
    service.execution.allow_commands = False
    assert service.start(principal, workspace, run["id"], key="start") == started
    with pytest.raises(CoreError) as denied:
        service.start(Principal("owner", permissions=frozenset({"read"})), workspace, run["id"], key="start")
    assert denied.value.status == 403


def test_managed_rejects_cross_tenant_plan_and_public_provenance_forgery(managed, plan):
    client, store, service, workspace, target = managed
    with pytest.raises(CoreError) as denied:
        service.prepare(
            Principal("owner"),
            workspace,
            plan={**plan, "tenant_id": "other"},
            runner_argv=[sys.executable],
            target_snapshot=target,
        )
    assert denied.value.status == 403
    response = client.post(
        "/api/hermes/v1/runs",
        json={
            "idempotency_key": "forgery",
            "data": {
                "title": "forged deployment",
                "deployment_source": {"plan": plan},
                "nodes": [{"id": "one", "argv": [sys.executable, "-V"]}],
            },
        },
    )
    assert response.status_code == 422
    assert not store.list(Principal("owner"), workspace, "runs")
