"""Work snapshots expose scoped observations, never retired drafts or invented totals."""

import copy
import json

import pytest
from sop_cli.commands import work
from sop_sdk.config import AgentConfig
from sop_sdk.errors import SopForbiddenError
from typer.testing import CliRunner

STAMP = "2026-10-18T06:00:00Z"


def write_cache(tmp_path, *, project_id="P", tasks=None):
    runtime = tmp_path / ".sop-runtime"
    entities = runtime / "sync/entities"
    entities.mkdir(parents=True)
    (runtime / "sync_state.json").write_text(
        json.dumps({"project_id": project_id, "last_pull_at": STAMP, "cursor": STAMP}), encoding="utf-8"
    )
    (entities / "tasks.json").write_text(
        json.dumps(tasks or {"T-one": {"id": "T-one", "title": "Real pending", "status": "pending"}}),
        encoding="utf-8",
    )
    return runtime


def configure(monkeypatch, tmp_path):
    config = AgentConfig(
        project_path=tmp_path, project_id="P", tenant_id="T", manager_url="https://manager.invalid/base"
    )
    monkeypatch.setattr(work, "get_config", lambda: config)
    monkeypatch.setattr(work.console, "width", 160)
    return config


def read_snapshot(tmp_path):
    return json.loads((tmp_path / ".sop-runtime/work_snapshot.json").read_text(encoding="utf-8"))


def page(items, *, total=None, cursor=None):
    return {
        "project_id": "P",
        "version": 7,
        "query_generation": 8,
        "as_of": STAMP,
        "items": items,
        "total": len(items) if total is None else total,
        "next_cursor": cursor,
        "limit": 100,
    }


class Manager:
    def __init__(self):
        self.calls = []
        self.pages = {
            "requirements": page(
                [{"id": "REQ-one", "title": "Review definition", "status": "pending", "stage": "design"}]
            ),
            "tasks": page(
                [
                    {
                        "id": f"T-{index:03}",
                        "title": "Reviewed task",
                        "status": "completed",
                        "delivery_status": "verified_completed" if index < 50 else "awaiting_review",
                    }
                    for index in range(100)
                ],
                total=151,
                cursor="task-next",
            ),
            "issues": page([{"id": "ISSUE-one", "title": "Open issue", "status": "open"}]),
            "sprints": {
                "page": 1,
                "size": 100,
                "total": 1000,
                "items": [
                    {
                        "id": f"SPRINT-{index:03}",
                        "goal": "Iteration",
                        "status": "active" if index == 0 else "completed",
                        "project_id": "P",
                        "tenant_id": "T",
                    }
                    for index in range(100)
                ],
            },
        }

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def delivery_requirements(self, **options):
        self.calls.append(("requirements", options))
        return copy.deepcopy(self.pages["requirements"])

    def delivery_tasks(self, **options):
        self.calls.append(("tasks", options))
        return copy.deepcopy(self.pages["tasks"])

    def delivery_issues(self, **options):
        self.calls.append(("issues", options))
        return copy.deepcopy(self.pages["issues"])

    def list_sprints(self, **options):
        self.calls.append(("sprints", options))
        return copy.deepcopy(self.pages["sprints"])

    def list_requirements(self, **options):
        self.calls.append(("legacy_requirements", options))
        return copy.deepcopy(self.pages["requirements"])

    def list_tasks(self, **options):
        self.calls.append(("legacy_tasks", options))
        return copy.deepcopy(self.pages["tasks"])

    def list_issues(self, **options):
        self.calls.append(("legacy_issues", options))
        return copy.deepcopy(self.pages["issues"])


def test_local_export_ignores_overlay_and_tombstone_without_rewriting_them(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path)
    runtime = write_cache(tmp_path)
    old = runtime / "local"
    old.mkdir()
    (old / "tasks.json").write_text(
        json.dumps({"T-one": {"id": "T-one", "title": "Imaginary completed", "status": "completed"}}),
        encoding="utf-8",
    )
    (old / "tasks_deleted.json").write_text('["T-one"]', encoding="utf-8")
    before = {path: path.read_bytes() for path in runtime.rglob("*") if path.is_file()}
    output = CliRunner().invoke(work.app, ["export", "--local"])
    assert output.exit_code == 0, output.output
    snapshot = read_snapshot(tmp_path)
    assert snapshot["entities"]["tasks"] == [{"id": "T-one", "title": "Real pending", "status": "pending"}]
    assert snapshot["source"] == "manager_cache"
    assert snapshot["coverage"]["tasks"]["complete"] is None
    assert snapshot["coverage"]["tasks"]["total"] is None
    assert snapshot["summary"]["tasks"]["verified_completed_loaded"] is None
    assert all(path.read_bytes() == data for path, data in before.items())


@pytest.mark.parametrize("state", [{"project_id": "Q"}, {}, ["P"]])
def test_unproven_or_different_project_cache_fails_without_replacing_snapshot(monkeypatch, tmp_path, state):
    configure(monkeypatch, tmp_path)
    runtime = write_cache(tmp_path)
    (runtime / "sync_state.json").write_text(json.dumps(state), encoding="utf-8")
    target = runtime / "work_snapshot.json"
    target.write_bytes(b"existing export must survive")
    output = CliRunner().invoke(work.app, ["export", "--local"])
    assert output.exit_code == 2
    assert target.read_bytes() == b"existing export must survive"


def test_remote_denial_does_not_export_cached_or_legacy_success(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path)
    runtime = write_cache(tmp_path)

    class Denied(Manager):
        def delivery_requirements(self, **options):
            raise SopForbiddenError("Access revoked", status=403)

        def list_requirements(self, **options):
            raise SopForbiddenError("Access revoked", status=403)

    monkeypatch.setattr(work, "get_client", lambda config=None: Denied())
    output = CliRunner().invoke(work.app, ["export"])
    assert output.exit_code == 2
    assert not (runtime / "work_snapshot.json").exists()


def test_summary_freezes_one_configuration_and_queries_each_module_once(monkeypatch, tmp_path):
    config = configure(monkeypatch, tmp_path)
    cfg_reads = []
    factory_scopes = []
    manager = Manager()

    def changing_config():
        cfg_reads.append(True)
        return config if len(cfg_reads) == 1 else AgentConfig(project_path=tmp_path / "other", project_id="Q")

    def factory(frozen=None):
        factory_scopes.append(frozen.project_id if frozen is not None else None)
        return manager

    monkeypatch.setattr(work, "get_config", changing_config)
    monkeypatch.setattr(work, "get_client", factory)
    output = CliRunner().invoke(work.app, ["summary", "--json"])
    assert output.exit_code == 0, output.output
    payload = json.loads(output.output)
    assert len(cfg_reads) == 1 and factory_scopes == ["P"]
    assert [name for name, options in manager.calls] == ["requirements", "tasks", "issues", "sprints"]
    assert manager.calls[0][1] == {"limit": 100, "sort": "priority_asc"}
    assert manager.calls[1][1] == {"limit": 100, "sort": "priority_asc"}
    assert manager.calls[2][1] == {"limit": 100}
    assert manager.calls[3][1] == {"page": 1, "size": 100}
    assert payload["scope"]["project_id"] == "P"
    assert payload["source"] == "manager"
    assert payload["summary"]["tasks"]["total"] == 151
    assert payload["summary"]["tasks"]["loaded"] == 100
    assert payload["summary"]["tasks"]["verified_completed_loaded"] == 50
    assert payload["summary"]["tasks"]["by_effective_status"] == {
        "verified_completed": 50,
        "awaiting_review": 50,
    }
    assert payload["coverage"]["tasks"]["complete"] is False
    assert payload["coverage"]["tasks"]["next_cursor"] == "task-next"
    assert payload["coverage"]["sprints"]["next_page"] == 2
    assert payload["coverage"]["sprints"]["query_generation"] is None
    assert "entities" not in payload


@pytest.mark.parametrize("field,value", [("project_id", "Q"), ("version", 9), ("query_generation", 9)])
def test_mixed_delivery_scope_or_generation_is_not_published(monkeypatch, tmp_path, field, value):
    configure(monkeypatch, tmp_path)
    manager = Manager()
    manager.pages["tasks"][field] = value
    monkeypatch.setattr(work, "get_client", lambda config=None: manager)
    output = CliRunner().invoke(work.app, ["export"])
    assert output.exit_code == 2
    assert not (tmp_path / ".sop-runtime/work_snapshot.json").exists()


def test_list_one_kind_uses_one_bounded_endpoint_and_keeps_coverage(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path)
    manager = Manager()
    monkeypatch.setattr(work, "get_client", lambda config=None: manager)
    output = CliRunner().invoke(
        work.app, ["list", "--kind", "tasks", "--status", "awaiting_review", "--json"]
    )
    assert output.exit_code == 0, output.output
    payload = json.loads(output.output)
    assert [name for name, options in manager.calls] == ["tasks"]
    assert len(payload["items"]) == 50
    assert set(payload["coverage"]) == {"tasks"}
    assert payload["coverage"]["tasks"]["total"] == 151
    assert payload["coverage"]["tasks"]["complete"] is False
    assert all(row["delivery_status"] == "awaiting_review" for row in payload["items"])


def test_local_cache_is_bounded_and_missing_history_stays_unknown(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path)
    write_cache(tmp_path, tasks={f"T-{i:03}": {"id": f"T-{i:03}", "status": "completed"} for i in range(101)})
    output = CliRunner().invoke(work.app, ["export", "--local"])
    assert output.exit_code == 0, output.output
    snapshot = read_snapshot(tmp_path)
    assert len(snapshot["entities"]["tasks"]) == 100
    assert snapshot["coverage"]["tasks"]["cached_count"] == 101
    assert snapshot["coverage"]["tasks"]["has_more_in_cache"] is True
    assert snapshot["summary"]["tasks"]["total"] is None
    assert snapshot["summary"]["tasks"]["by_recorded_status"] == {"completed": 100}
    assert snapshot["summary"]["tasks"]["verified_completed_loaded"] is None


def test_task_from_another_tenant_invalidates_cache_before_output(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path)
    write_cache(
        tmp_path,
        tasks={"T-one": {"id": "T-one", "tenant_id": "other", "project_id": "P", "status": "pending"}},
    )
    output = CliRunner().invoke(work.app, ["export", "--local"])
    assert output.exit_code == 2
    assert not (tmp_path / ".sop-runtime/work_snapshot.json").exists()


def test_partial_remote_page_without_continuation_is_not_called_complete(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path)
    manager = Manager()
    manager.pages["tasks"]["next_cursor"] = None
    monkeypatch.setattr(work, "get_client", lambda config=None: manager)
    output = CliRunner().invoke(work.app, ["export"])
    assert output.exit_code == 2
    assert not (tmp_path / ".sop-runtime/work_snapshot.json").exists()


def test_empty_local_cache_is_explicitly_unavailable_instead_of_complete_zero(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path)
    output = CliRunner().invoke(work.app, ["summary", "--local", "--json"])
    assert output.exit_code == 0, output.output
    payload = json.loads(output.output)
    assert payload["source"] == "manager_cache"
    assert payload["coverage"]["tasks"]["state"] == "cache_missing"
    assert payload["summary"]["tasks"]["total"] is None
    assert not (tmp_path / ".sop-runtime").exists()


def test_truncated_sprint_first_page_cannot_fabricate_a_valid_next_page(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path)
    manager = Manager()
    manager.pages["sprints"]["items"] = manager.pages["sprints"]["items"][:1]
    monkeypatch.setattr(work, "get_client", lambda config=None: manager)
    output = CliRunner().invoke(work.app, ["export"])
    assert output.exit_code == 2
    assert not (tmp_path / ".sop-runtime/work_snapshot.json").exists()


@pytest.mark.parametrize("arguments", [["--local"], ["list", "--local"], ["next", "--local"]])
def test_human_cache_views_do_not_contact_manager_or_write_business_state(monkeypatch, tmp_path, arguments):
    configure(monkeypatch, tmp_path)
    write_cache(tmp_path)
    monkeypatch.setattr(
        work, "get_client", lambda *args: pytest.fail("Explicit cache views must not contact Manager")
    )
    before = {path: path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()}
    output = CliRunner().invoke(work.app, arguments)
    assert output.exit_code == 0, output.output
    assert "manager_cache" in output.output
    assert {path: path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()} == before
