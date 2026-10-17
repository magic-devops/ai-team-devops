"""Additional project file writers serialize their short mutations with archive."""
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sop_manager import path_config
from sop_manager.project_write_guard import project_file_write_scope
from sop_manager.routers import (
    cli_wrapper,
    copilot,
    knowledge_graph,
    marketplace,
    orchestration,
    skill_repo,
    sql_models,
    worker_jobs,
)
from test_project_write_guard import guarded as guarded


@pytest.fixture
def scoped(guarded, tmp_path, monkeypatch):
    sessions, _ = guarded
    monkeypatch.setattr(sql_models, "SessionLocal", sessions)
    monkeypatch.setattr(path_config, "resolved_tenant_id", lambda: "tenant")
    monkeypatch.setattr(path_config, "resolved_project_id", lambda: "archived")
    for module in (copilot, knowledge_graph, orchestration, skill_repo, worker_jobs):
        monkeypatch.setattr(module, "resolved_ai_memory_root", lambda: tmp_path / "project-memory")
    monkeypatch.setattr(cli_wrapper, "resolved_project_path", lambda: tmp_path / "project")
    return tmp_path


@pytest.mark.parametrize("writer", ["copilot_append", "copilot_session", "copilot_approval", "cli", "graph", "orchestration_tools", "orchestration_config", "orchestration_workflow", "orchestration_log", "skill_install", "skill_repo", "worker"])
def test_real_writer_rejects_archived_project_before_creating_any_project_file(scoped, writer):
    target = scoped / "append" / "turn.jsonl"
    with pytest.raises(HTTPException) as raised:
        if writer == "copilot_append":
            copilot._append_jsonl(target, {"response": "not saved"})
        elif writer == "copilot_session":
            copilot._upsert_session("session", title="not saved", run_id="run")
        elif writer == "copilot_approval":
            copilot._save_command_approvals([])
        elif writer == "cli":
            cli_wrapper._save_state({"custom": {}, "overrides": {}, "hidden": []})
        elif writer == "graph":
            knowledge_graph._save_graph({"entities": [], "edges": []})
        elif writer == "orchestration_tools":
            orchestration._save_dev_tools_state({"custom": []})
        elif writer == "orchestration_config":
            orchestration.update_config({"default_tool": "claude"})
        elif writer == "orchestration_workflow":
            orchestration.create_workflow(orchestration.WorkflowDef(id="release", name="Release"))
        elif writer == "orchestration_log":
            orchestration._append_install_log({"recipe_id": "test", "ok": True})
        elif writer == "skill_install":
            skill_repo._save_installed({})
        elif writer == "skill_repo":
            skill_repo.add_repo(skill_repo.RepoConfig(id="local", name="Local", url="https://example.test/repo"))
        else:
            worker_jobs._write_job("job", {"id": "job", "tenant_id": "tenant", "project_id": "archived", "status": "completed"})
    assert raised.value.status_code == 409
    assert raised.value.detail["code"] == "project_archived"
    assert not (scoped / "project-memory").exists()
    assert not (scoped / "project").exists()
    assert not target.parent.exists()


@pytest.mark.parametrize("module,getter", [(copilot, "_copilot_dir"), (knowledge_graph, "_kg_dir"), (orchestration, "_orch_dir"), (skill_repo, "_repo_dir"), (worker_jobs, "_jobs_dir")])
def test_project_directory_getters_do_not_create_defaults_on_reads(scoped, module, getter):
    path = getattr(module, getter)()
    assert not path.exists()
    assert not (scoped / "project-memory").exists()


def test_cli_and_orchestration_default_reads_do_not_write(scoped, monkeypatch):
    assert cli_wrapper._load_state()["custom"] == {}
    assert orchestration.get_config()["default_tool"] == "claude"
    monkeypatch.setattr(orchestration, "_tool_available", lambda *args: False)
    assert orchestration.list_tools()
    assert not (scoped / "project-memory").exists()
    assert not (scoped / "project").exists()


@pytest.mark.parametrize("module,path_getter,delete,args", [(skill_repo, "_repo_dir", "remove_repo", ("local",)), (orchestration, "_orch_dir", "delete_workflow", ("release",))])
def test_archived_removal_preserves_existing_project_file(scoped, module, path_getter, delete, args):
    directory = scoped / "project-memory" / ("skill-repos" if module is skill_repo else "orchestration")
    directory.mkdir(parents=True)
    target = directory / ("repo_local.json" if module is skill_repo else "wf_release.json")
    original = '{"name":"keep"}'
    target.write_text(original, encoding="utf-8")
    with pytest.raises(HTTPException) as raised:
        getattr(module, delete)(*args)
    assert raised.value.detail["code"] == "project_archived"
    assert target.read_text(encoding="utf-8") == original


def test_actual_nested_writers_reuse_one_file_scope_and_reject_cross_project(scoped, monkeypatch):
    monkeypatch.setattr(path_config, "resolved_project_id", lambda: "active")
    factory = sql_models.SessionLocal
    sessions = []
    def session_factory():
        session = factory()
        sessions.append(session)
        return session
    monkeypatch.setattr(sql_models, "SessionLocal", session_factory)
    with project_file_write_scope():
        copilot._append_jsonl(scoped / "nested" / "turn.jsonl", {"ok": True})
        skill_repo._save_installed({"local/skill": {"enabled": True}})
        worker_jobs._write_job("active-job", {"tenant_id": "tenant", "project_id": "active", "status": "completed"})
        with pytest.raises(ValueError, match="cannot change project scope"):
            with project_file_write_scope(tenant_id="tenant", project_id="archived"):
                pytest.fail("Cross-project scope must not enter")
    assert json.loads((scoped / "nested" / "turn.jsonl").read_text(encoding="utf-8"))["ok"] is True
    assert json.loads(skill_repo._installed_file().read_text(encoding="utf-8"))["local/skill"]["enabled"] is True
    assert len(sessions) == 1


def test_worker_completion_uses_persisted_project_identity_even_without_request_scope(scoped, monkeypatch):
    monkeypatch.setattr(path_config, "resolved_project_id", lambda: "active")
    with pytest.raises(HTTPException) as raised:
        worker_jobs._write_job("archived-job", {"tenant_id": "tenant", "project_id": "archived", "status": "completed"})
    assert raised.value.detail["code"] == "project_archived"
    assert not (scoped / "project-memory").exists()


def test_graph_profile_merge_cannot_persist_after_archival(scoped, monkeypatch):
    graph = knowledge_graph._empty_graph()
    graph["entities"] = [{"id": "entity", "label": "Entity", "type": "task", "properties": {}}]
    monkeypatch.setattr(knowledge_graph, "_load_graph", lambda: graph)
    monkeypatch.setattr(knowledge_graph, "get_memory_store", lambda: SimpleNamespace(search=lambda *args, **kwargs: []))
    with pytest.raises(HTTPException) as raised:
        knowledge_graph.merge_entity_profile(knowledge_graph.EntityProfileMergeIn(entity_id="entity"))
    assert raised.value.detail["code"] == "project_archived"
    assert not (scoped / "project-memory").exists()


def test_repo_sync_stages_network_outside_lock_then_rechecks_before_publishing(scoped, monkeypatch):
    from sop_manager.project_write_guard import _FILE_SESSION
    repo_dir = scoped / "project-memory" / "skill-repos"
    repo_dir.mkdir(parents=True)
    metadata = repo_dir / "repo_local.json"
    original = json.dumps({"id": "local", "url": "https://example.test/repo", "skills": []})
    metadata.write_text(original, encoding="utf-8")
    clone = repo_dir / "clone_local"
    clone.mkdir()
    marker = clone / "existing.txt"
    marker.write_text("keep", encoding="utf-8")
    def download(args, **kwargs):
        assert _FILE_SESSION.get() is None
        target = Path(kwargs["cwd"]) if args[1] == "pull" else Path(args[-1])
        target.mkdir(parents=True, exist_ok=True)
        (target / "skill.json").write_text('{"id":"downloaded"}', encoding="utf-8")
        return SimpleNamespace(returncode=0, stderr="")
    monkeypatch.setattr(skill_repo.subprocess, "run", download)
    with pytest.raises(HTTPException) as raised:
        skill_repo.sync_repo("local")
    assert raised.value.detail["code"] == "project_archived"
    assert metadata.read_text(encoding="utf-8") == original
    assert marker.read_text(encoding="utf-8") == "keep"
    assert not (clone / "skill.json").exists()


def test_marketplace_project_target_cannot_publish_after_archive(scoped, monkeypatch):
    root = scoped / "project-target"
    target = root / "assets" / "package"
    monkeypatch.setattr(marketplace, "resolved_project_path", lambda: root, raising=False)
    monkeypatch.setattr(marketplace, "_INSTALL_DIR", scoped / "global-marketplace")
    package = marketplace.Package(name="local", version="1", type="skill", registry="builtin://sop")
    monkeypatch.setattr(marketplace, "_find", lambda name: package)
    with pytest.raises(HTTPException) as raised:
        marketplace.install(marketplace.InstallIn(name="local", target_dir=str(target)))
    assert raised.value.detail["code"] == "project_archived"
    assert not root.exists()
    assert not (scoped / "global-marketplace").exists()


def test_marketplace_host_global_records_are_not_misclassified_as_project_business(scoped, monkeypatch):
    monkeypatch.setattr(marketplace, "_INSTALL_DIR", scoped / "global-marketplace")
    package = marketplace.Package(name="local", version="1", type="skill", registry="builtin://sop")
    monkeypatch.setattr(marketplace, "_find", lambda name: package)
    result = marketplace.install(marketplace.InstallIn(name="local"))
    assert result["name"] == "local"
    assert (scoped / "global-marketplace" / "local" / "manifest.json").is_file()
