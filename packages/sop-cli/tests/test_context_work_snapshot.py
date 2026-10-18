import json

from sop_cli.commands import context, init, work
from sop_sdk import AgentConfig
from typer.testing import CliRunner


def configure(monkeypatch, tmp_path):
    config = AgentConfig(project_path=tmp_path, project_id="P", tenant_id="T")
    monkeypatch.setattr(context, "get_config", lambda: config)
    monkeypatch.setattr(work, "get_config", lambda: config)
    monkeypatch.setattr("sop_cli._util.get_config", lambda: config)
    monkeypatch.setattr(context, "write_db_connections_cache", lambda **kwargs: None)
    monkeypatch.setattr(context, "write_pages_context_cache", lambda **kwargs: (None, None))
    runtime = tmp_path / ".sop-runtime"
    cache = runtime / "sync/entities"
    cache.mkdir(parents=True)
    (runtime / "sync_state.json").write_bytes(b'{"project_id":"P"}')
    (cache / "tasks.json").write_bytes(b'{"T-one":{"id":"T-one","status":"pending"}}')
    legacy = runtime / "local/tasks.json"
    legacy.parent.mkdir()
    legacy.write_bytes(b'{"T-one":{"id":"T-one","status":"completed"}}')
    return config, legacy


def assert_snapshot(root):
    runtime = root / ".sop-runtime"
    snapshot = json.loads((runtime / "work_snapshot.json").read_bytes())
    advertised = json.loads((runtime / "agent_context.json").read_bytes())
    assert snapshot["schema"] == "sop.work.snapshot.v2"
    assert snapshot["scope"]["project_id"] == "P"
    assert snapshot["source"] == "manager_cache"
    assert snapshot["entities"]["tasks"][0]["status"] == "pending"
    assert snapshot["summary"]["tasks"]["total"] is None
    assert advertised["prepared"]["work_snapshot"] is True


def test_actual_context_prepare_uses_scoped_work_snapshot(monkeypatch, tmp_path):
    _, legacy = configure(monkeypatch, tmp_path)
    original = legacy.read_bytes()
    result = CliRunner().invoke(context.app, ["prepare", "--no-db-config", "--no-pages", "--no-platforms"])
    assert result.exit_code == 0, result.output
    assert_snapshot(tmp_path)
    assert legacy.read_bytes() == original


def test_init_manifest_chain_generates_current_work_snapshot(monkeypatch, tmp_path):
    _, legacy = configure(monkeypatch, tmp_path)
    original = legacy.read_bytes()
    monkeypatch.chdir(tmp_path)
    init._write_project_manifest()
    assert_snapshot(tmp_path)
    assert legacy.read_bytes() == original


def test_prepare_does_not_mix_a_later_project_configuration(monkeypatch, tmp_path):
    original, _ = configure(monkeypatch, tmp_path)
    other = AgentConfig(project_path=tmp_path / "other-project", project_id="Q", tenant_id="T")
    calls = []

    def changed_configuration():
        calls.append(True)
        return original if len(calls) == 1 else other

    monkeypatch.setattr(context, "get_config", changed_configuration)
    monkeypatch.setattr(work, "get_config", lambda: other)
    result = CliRunner().invoke(context.app, ["prepare", "--no-db-config", "--no-pages", "--no-platforms"])
    assert result.exit_code == 0, result.output
    assert len(calls) == 1
    assert_snapshot(tmp_path)
    manifest = json.loads((tmp_path / ".sop-runtime/project_manifest.json").read_bytes())
    assert manifest["project"]["id"] == "P"
    assert not other.project_path.exists()
