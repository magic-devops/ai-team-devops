"""Read projections stay pure and known file writers share the archive lock."""

import pytest
from fastapi import HTTPException
from sop_manager.routers import (
    agents,
    data_analytics,
    design_docs,
    mcp_mgr,
    models,
    requirements,
    sql_models,
    sync_api,
    tasks,
    workflow,
)
from sqlalchemy import update
from test_business_access import env as env
from test_business_access import headers
from test_project_write_guard import guarded as guarded


@pytest.mark.parametrize("module", [tasks, requirements])
def test_ordered_get_projection_does_not_initialize_ui_file(module, monkeypatch):
    saves = []
    monkeypatch.setattr(module, "_ui_save", lambda value: saves.append(value))
    state = {"columns": {"P0": [], "P1": [], "P2": [], "P3": []}, "fields": {}}
    result = module._ui_ordered_list([{"id": "item", "title": "Item", "priority": "P1"}], state)
    assert result[0]["id"] == "item"
    assert saves == []


def test_missing_mcp_settings_get_does_not_create_a_file(tmp_path, monkeypatch):
    target = tmp_path / "not-created" / "settings.json"
    monkeypatch.setattr(mcp_mgr, "_settings_file", lambda: target)
    assert mcp_mgr._load_cfg() == {"mcpServers": {}}
    assert not target.parent.exists()


def test_missing_governance_get_is_a_pure_default_projection(tmp_path, monkeypatch):
    target = tmp_path / "analytics" / "data-governance.json"
    monkeypatch.setattr(data_analytics, "resolved_runtime_dir", lambda: tmp_path)
    monkeypatch.setattr(data_analytics, "_data_scope", lambda: {"tenant_id": "tenant", "project_id": "archived"})
    result = data_analytics._load_governance()
    assert isinstance(result, dict)
    assert not target.parent.exists()


@pytest.mark.parametrize("writer", ["tasks", "requirements", "mcp", "governance", "sync", "design",
                                   "agent", "workflow", "event", "model", "quality", "claim", "jsonl"])
def test_actual_file_writer_rechecks_archived_project_under_project_lock(guarded, tmp_path, monkeypatch, writer):
    sessions, _ = guarded
    from sop_manager import path_config

    monkeypatch.setattr(sql_models, "SessionLocal", sessions)
    monkeypatch.setattr(path_config, "resolved_tenant_id", lambda: "tenant")
    monkeypatch.setattr(path_config, "resolved_project_id", lambda: "archived")
    target = tmp_path / "not-created" / "target.json"
    monkeypatch.setattr(tasks, "_task_ui_path", lambda: target)
    monkeypatch.setattr(requirements, "_ui_state_path", lambda: target)
    monkeypatch.setattr(mcp_mgr, "_settings_file", lambda: target)
    monkeypatch.setattr(data_analytics, "_governance_file", lambda: target)
    monkeypatch.setattr(design_docs, "_index_path", lambda: target)
    monkeypatch.setattr(models, "_models_file", lambda: target)
    monkeypatch.setattr(workflow, "_runs_file", lambda: target)
    monkeypatch.setattr(workflow, "_events_file", lambda: target)
    monkeypatch.setattr(tasks, "_quality_policy_path", lambda: target)
    monkeypatch.setattr(tasks, "_agent_claims_path", lambda: target)
    monkeypatch.setattr(sync_api, "_asset_target_path", lambda *args: (target, "target.json"))
    with pytest.raises(HTTPException) as raised:
        writers = {
            "tasks": lambda: tasks._ui_save({}),
            "requirements": lambda: requirements._ui_save({}),
            "mcp": lambda: mcp_mgr._save_cfg({}),
            "governance": lambda: data_analytics._write_governance_store({}),
            "sync": lambda: sync_api._sync_push_asset(sync_api.SyncPushIn(module="design_docs", record={"content": "do not write"}), "archived"),
            "design": lambda: design_docs._save_index({}),
            "agent": lambda: agents._save_definition(target, {}),
            "workflow": lambda: workflow._save_runs([]),
            "event": lambda: workflow._record_event({}),
            "model": lambda: models._save({}),
            "quality": lambda: tasks._save_quality_policy({}),
            "claim": lambda: tasks._save_agent_claims({}),
            "jsonl": lambda: tasks._append_jsonl(target, {}),
        }
        writers[writer]()
    assert raised.value.status_code == 409
    assert not target.parent.exists()


def test_archived_business_http_gate_rejects_file_only_task_patch_and_configuration(env):
    client, sessions = env
    with sessions() as db:
        from sop_manager.project_write_guard import lifecycle_scope
        db.get(sql_models.ProjectMember, ("selected", "writer")).role = "project_admin"
        db.commit()
        with lifecycle_scope(db, "team", "selected"):
            db.execute(update(sql_models.Project).where(sql_models.Project.id == "selected").values(status="archived"))
            db.commit()
    assert client.get("/api/v1/tasks", headers=headers()).status_code == 200
    response = client.patch("/api/v1/tasks/T-selected", headers=headers(), json={"artifact_url": "https://example.test/proof"})
    assert response.status_code == 409, response.text
    response = client.put("/api/v1/models/default?model_id=test", headers=headers())
    assert response.status_code == 409, response.text


def test_actual_file_save_waits_for_archive_and_then_rejects(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from sop_manager import path_config
    from sop_manager.project_write_guard import ManagerSession, lifecycle_scope
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine("sqlite:///" + str(tmp_path / "race.sqlite"), connect_args={"check_same_thread": False})
    sql_models.Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, class_=ManagerSession, expire_on_commit=False)
    with sessions() as db:
        db.add(sql_models.Tenant(id="tenant", name="Team", slug="team"))
        db.flush()
        db.add(sql_models.Project(id="project", tenant_id="tenant", name="Project"))
        db.commit()
    target = tmp_path / "settings.json"
    monkeypatch.setattr(sql_models, "SessionLocal", sessions)
    monkeypatch.setattr(path_config, "resolved_tenant_id", lambda: "tenant")
    monkeypatch.setattr(path_config, "resolved_project_id", lambda: "project")
    monkeypatch.setattr(mcp_mgr, "_settings_file", lambda: target)
    started = Event()

    def save():
        started.set()
        try:
            mcp_mgr._save_cfg({"mcpServers": {}})
        except HTTPException as exc:
            return exc.status_code, exc.detail["code"]
        return 200, "saved"

    try:
        with sessions() as db, ThreadPoolExecutor(max_workers=1) as workers:
            with lifecycle_scope(db, "tenant", "project"):
                db.execute(update(sql_models.Project).where(sql_models.Project.id == "project").values(status="archived"))
                future = workers.submit(save)
                assert started.wait(2)
                assert not future.done()
                db.commit()
            assert future.result(timeout=5) == (409, "project_archived")
        assert not target.exists()
    finally:
        engine.dispose()


@pytest.mark.parametrize("module,getter", [(design_docs, "_root"), (agents, "_agents_dir"), (workflow, "_wf_dir")])
def test_missing_business_directories_are_not_created_by_reads(tmp_path, monkeypatch, module, getter):
    monkeypatch.setattr(module, "resolved_ai_memory_root", lambda: tmp_path)
    path = getattr(module, getter)()
    assert not path.exists()


def test_active_file_groups_can_nest_without_acquiring_a_second_sqlite_writer(guarded, tmp_path, monkeypatch):
    sessions, _ = guarded
    from sop_manager import path_config
    from sop_manager.project_write_guard import project_file_write_scope

    monkeypatch.setattr(sql_models, "SessionLocal", sessions)
    monkeypatch.setattr(path_config, "resolved_tenant_id", lambda: "tenant")
    monkeypatch.setattr(path_config, "resolved_project_id", lambda: "active")
    monkeypatch.setattr(design_docs, "resolved_ai_memory_root", lambda: tmp_path)
    with project_file_write_scope():
        result = design_docs.create_doc(design_docs.DocCreate(title="Nested lock", initial_content="Real content"))
    assert (tmp_path / "tech_design" / result["id"] / "current.md").read_text(encoding="utf-8").strip() == "Real content"


def test_rag_external_vector_mutation_rechecks_archival_after_embedding(guarded, monkeypatch):
    from types import SimpleNamespace

    from sop_manager import path_config
    from sop_manager.routers import llm_gateway, rag

    sessions, _ = guarded
    monkeypatch.setattr(sql_models, "SessionLocal", sessions)
    monkeypatch.setattr(path_config, "resolved_tenant_id", lambda: "tenant")
    monkeypatch.setattr(path_config, "resolved_project_id", lambda: "archived")
    writes = []
    store = SimpleNamespace(ensure_collection=lambda *args: writes.append(args), upsert=lambda *args: writes.append(args))
    monkeypatch.setattr(rag, "get_store", lambda: store)
    monkeypatch.setattr(llm_gateway, "llm_embeddings", lambda *args: SimpleNamespace(vectors=[[0.25, 0.75]]))
    with pytest.raises(HTTPException) as raised:
        rag.index(rag.IndexIn(collection="knowledge", docs=[{"text": "Read-only project"}]))
    assert raised.value.detail["code"] == "project_archived"
    assert writes == []
