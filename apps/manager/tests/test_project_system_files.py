"""System project file writers share the lifecycle lock; read projections stay pure."""

import pytest
from fastapi import HTTPException
from sop_manager.routers import pages_productization, sql_models, system, system_ops, system_pages, usage
from test_project_write_guard import guarded as guarded  # noqa: F401


@pytest.mark.parametrize("writer", ["artifacts", "release", "profiles", "action_policy", "memory_ledger", "quota"])
def test_system_project_writer_rejects_archive_before_creating_paths(guarded, monkeypatch, tmp_path, writer):  # noqa: F811
    from sop_manager import path_config

    sessions, _ = guarded
    target = tmp_path / "not-created"
    monkeypatch.setattr(sql_models, "SessionLocal", sessions)
    monkeypatch.setattr(path_config, "resolved_tenant_id", lambda: "tenant")
    monkeypatch.setattr(path_config, "resolved_project_id", lambda: "archived")
    for module in [system, system_pages, pages_productization, usage]:
        monkeypatch.setattr(module, "resolved_ai_memory_root", lambda: target)
    monkeypatch.setattr(system_ops, "_runtime_dir", lambda: target)
    with pytest.raises(HTTPException) as error:
        if writer == "artifacts":
            system._save_workspace_artifacts([])
        elif writer == "release":
            system._save_release("3.0", "Changes")
        elif writer == "profiles":
            system_ops._save({})
        elif writer == "action_policy":
            system_pages._write_action_policy({})
        elif writer == "memory_ledger":
            pages_productization._append_jsonl(target / "ledger.jsonl", {})
        else:
            usage.write_quota({})
    assert error.value.status_code == 409
    assert not target.exists()


def test_system_read_path_helpers_do_not_create_directories(tmp_path, monkeypatch):
    target = tmp_path / "not-created"
    for module in [system_pages, pages_productization, usage]:
        monkeypatch.setattr(module, "resolved_ai_memory_root", lambda: target)
    assert system_pages._read_action_policy()
    assert system_pages._read_isolation_scan_runs() == []
    assert pages_productization._read_jsonl(pages_productization._memory_ledger_path()) == []
    assert usage._quota()["limits"] == {}
    assert not target.exists()
