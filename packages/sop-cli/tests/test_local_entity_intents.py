"""Entity commands freeze explicit operations; they never invent local business state."""

import json
import sqlite3
from contextlib import contextmanager

import pytest
from sop_cli.commands import issue, requirement, sprint, task
from sop_sdk import event_outbox
from sop_sdk.config import AgentConfig
from sop_sdk.errors import SopForbiddenError
from typer.testing import CliRunner

TIME = "2026-10-18T06:00:00Z"
COMMON = ["--expected-version", "7", "--key", "operation-one", "--time", TIME, "--local"]
TASK_BASIS = "a" * 64
REQ_BASIS = "b" * 64
PREVIEW_BASIS = "c" * 64

CASES = [
    (
        requirement,
        ["create", "Requirement", "--record-id", "REQ-fixed"],
        "requirements",
        "create",
        {"id": "REQ-fixed", "title": "Requirement"},
    ),
    (
        requirement,
        ["update", "REQ-fixed", "--priority", "P2"],
        "requirements",
        "update",
        {"id": "REQ-fixed", "priority": "P2"},
    ),
    (requirement, ["delete", "REQ-fixed"], "requirements", "delete", {"id": "REQ-fixed"}),
    (
        task,
        ["create", "Task", "--record-id", "T-fixed"],
        "tasks",
        "create",
        {"id": "T-fixed", "title": "Task"},
    ),
    (task, ["pull", "T-fixed"], "tasks", "update", {"id": "T-fixed", "status": "in_progress"}),
    (
        task,
        ["done", "T-fixed", "--notes", "Review needed", "--confidence", "0.4"],
        "tasks",
        "update",
        {"id": "T-fixed", "status": "completed", "human_notes": "Review needed", "confidence": 0.4},
    ),
    (
        task,
        ["fail", "T-fixed", "--notes", "Dependency unavailable"],
        "tasks",
        "update",
        {"id": "T-fixed", "status": "blocked", "human_notes": "Dependency unavailable"},
    ),
    (
        task,
        ["update", "T-fixed", "--title", "Renamed"],
        "tasks",
        "update",
        {"id": "T-fixed", "title": "Renamed"},
    ),
    (task, ["delete", "T-fixed"], "tasks", "delete", {"id": "T-fixed"}),
    (
        issue,
        ["create", "Issue", "--record-id", "ISSUE-fixed"],
        "issues",
        "create",
        {"id": "ISSUE-fixed", "title": "Issue"},
    ),
    (
        issue,
        ["update", "ISSUE-fixed", "--severity", "P0"],
        "issues",
        "update",
        {"id": "ISSUE-fixed", "severity": "P0"},
    ),
    (
        issue,
        ["resolve", "ISSUE-fixed", "--resolution", "Verified evidence"],
        "issues",
        "update",
        {"id": "ISSUE-fixed", "status": "resolved", "resolution": "Verified evidence"},
    ),
    (issue, ["delete", "ISSUE-fixed"], "issues", "delete", {"id": "ISSUE-fixed"}),
    (
        sprint,
        ["create", "Sprint goal", "--record-id", "SPRINT-fixed"],
        "sprints",
        "create",
        {"id": "SPRINT-fixed", "goal": "Sprint goal"},
    ),
    (
        sprint,
        ["update", "SPRINT-fixed", "--goal", "Changed"],
        "sprints",
        "update",
        {"id": "SPRINT-fixed", "goal": "Changed"},
    ),
    (
        sprint,
        ["complete", "SPRINT-fixed", "--retro", "Human review"],
        "sprints",
        "update",
        {"id": "SPRINT-fixed", "status": "completed", "retrospective": "Human review"},
    ),
    (sprint, ["delete", "SPRINT-fixed"], "sprints", "delete", {"id": "SPRINT-fixed"}),
]


def configure(monkeypatch, tmp_path, module):
    config = AgentConfig(project_path=tmp_path, project_id="p-reviewed", tenant_id="t-reviewed")
    monkeypatch.setattr(module, "get_config", lambda: config)
    monkeypatch.setattr(module.console, "width", 160)
    return config


def read_events(tmp_path):
    with sqlite3.connect(tmp_path / ".sop-runtime/outbox.sqlite") as db:
        return [
            json.loads(row[0])
            for row in db.execute("SELECT event_json FROM events ORDER BY created_at_ms,id")
        ]


def assert_no_speculative_files(tmp_path):
    assert not (tmp_path / ".sop-runtime/sync/push_queue.jsonl").exists()
    assert not (tmp_path / ".sop-runtime/local").exists()
    assert not (tmp_path / "sop/custom").exists()


@pytest.mark.parametrize("module,args,module_name,action,explicit", CASES)
def test_all_entity_writes_use_one_real_sqlite_original(
    monkeypatch, tmp_path, module, args, module_name, action, explicit
):
    configure(monkeypatch, tmp_path, module)
    output = CliRunner().invoke(module.app, args + COMMON)
    assert output.exit_code == 0, output.output
    result = json.loads(output.output)
    assert result["ok"] is True and result["event_id"] == "operation-one"
    assert result["retained"] is True
    (event,) = read_events(tmp_path)
    assert event["id"] == "operation-one" and event["time"] == TIME
    assert event["type"] == "sop.sync.push"
    assert event["data"]["expected_version"] == 7
    assert event["data"]["module"] == module_name
    assert event["data"]["action"] == action
    record = event["data"]["record"]
    assert all(record[key] == value for key, value in explicit.items())
    if action != "create":
        assert record == explicit
    assert (
        not {
            "created_at",
            "updated_at",
            "reported_by",
            "resolved_by",
            "resolved_at",
            "tenant_id",
            "project_id",
        }
        & record.keys()
    )
    assert_no_speculative_files(tmp_path)


@pytest.mark.parametrize("module,args,module_name,action,explicit", CASES)
@pytest.mark.parametrize("missing", ["--expected-version", "--key", "--time"])
def test_missing_original_parameter_never_contacts_or_writes(
    monkeypatch, tmp_path, module, args, module_name, action, explicit, missing
):
    configure(monkeypatch, tmp_path, module)
    monkeypatch.setattr(
        module, "get_client", lambda: pytest.fail("No request before an original operation exists")
    )
    common = COMMON.copy()
    index = common.index(missing)
    del common[index : index + 2]
    output = CliRunner().invoke(module.app, args + common)
    assert output.exit_code == 2
    assert not (tmp_path / ".sop-runtime").exists()


@pytest.mark.parametrize("failure", [PermissionError("HTTP 403"), TimeoutError("response lost after commit")])
def test_old_unknown_or_denied_create_cannot_fabricate_another_business_id(monkeypatch, tmp_path, failure):
    configure(monkeypatch, tmp_path, issue)

    class Client:
        def create_issue(self, body):
            raise failure

    monkeypatch.setattr(issue, "get_client", Client)
    output = CliRunner().invoke(issue.app, ["create", "Do not fabricate"])
    assert output.exit_code == 2
    assert not list(tmp_path.rglob("*.jsonl"))
    assert not list(tmp_path.rglob("*.md"))
    assert not (tmp_path / ".sop-runtime/local").exists()


def test_repeated_operation_keeps_original_and_changed_body_is_rejected(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path, task)
    runner = CliRunner()
    args = ["update", "T-fixed", "--title", "Exact title"] + COMMON
    assert runner.invoke(task.app, args).exit_code == 0
    assert runner.invoke(task.app, args).exit_code == 0
    changed = runner.invoke(task.app, ["update", "T-fixed", "--title", "Other title"] + COMMON)
    assert changed.exit_code == 2
    (event,) = read_events(tmp_path)
    assert event["data"]["record"] == {"id": "T-fixed", "title": "Exact title"}
    assert_no_speculative_files(tmp_path)


def test_successive_sparse_patches_never_restore_cached_old_definition(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path, requirement)
    entities = tmp_path / ".sop-runtime/sync/entities"
    entities.mkdir(parents=True)
    (entities / "requirements.json").write_text(
        json.dumps(
            {"REQ-fixed": {"id": "REQ-fixed", "title": "Cached title", "description": "Stale description"}}
        ),
        encoding="utf-8",
    )
    runner = CliRunner()
    first = runner.invoke(
        requirement.app,
        [
            "update",
            "REQ-fixed",
            "--desc",
            "Reviewed description",
            "--requirement-basis",
            REQ_BASIS,
            "--change-preview-basis",
            PREVIEW_BASIS,
        ]
        + COMMON,
    )
    second_common = ["operation-two" if value == "operation-one" else value for value in COMMON]
    second = runner.invoke(requirement.app, ["update", "REQ-fixed", "--priority", "P2"] + second_common)
    assert first.exit_code == second.exit_code == 0, first.output + second.output
    events = {event["id"]: event for event in read_events(tmp_path)}
    assert events["operation-one"]["data"]["record"] == {
        "id": "REQ-fixed",
        "description": "Reviewed description",
    }
    assert events["operation-two"]["data"]["record"] == {"id": "REQ-fixed", "priority": "P2"}
    assert events["operation-one"]["data"]["requirement_basis"] == REQ_BASIS
    assert events["operation-one"]["data"]["change_preview_basis"] == PREVIEW_BASIS
    assert_no_speculative_files(tmp_path)


def test_owner_and_criteria_metadata_stay_outside_business_record(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path, task)
    output = CliRunner().invoke(
        task.app,
        ["update", "T-fixed", "--owner-id", "", "--clear-criteria", "--task-basis", TASK_BASIS] + COMMON,
    )
    assert output.exit_code == 0, output.output
    (event,) = read_events(tmp_path)
    assert event["data"]["record"] == {"id": "T-fixed", "owner_id": "", "acceptance_criteria": []}
    assert event["data"]["task_basis"] == TASK_BASIS


@pytest.mark.parametrize(
    "args", [["update", "T-fixed", "--owner-id", "member-one"], ["update", "T-fixed", "--criterion", "Pass"]]
)
def test_explicit_existing_task_scope_requires_original_basis(monkeypatch, tmp_path, args):
    configure(monkeypatch, tmp_path, task)
    output = CliRunner().invoke(task.app, args + COMMON)
    assert output.exit_code == 2
    assert not (tmp_path / ".sop-runtime/outbox.sqlite").exists()


@pytest.mark.parametrize(
    "module,args",
    [
        (task, ["update", "T-fixed", "--tool", "codex"]),
        (task, ["update", "T-fixed", "--artifact-url", "https://invalid.test"]),
        (task, ["update", "T-fixed", "--branch", "main"]),
        (requirement, ["create", "Req", "--record-id", "REQ-fixed", "--agent", "Agent"]),
        (requirement, ["update", "REQ-fixed", "--status", "completed"]),
        (issue, ["resolve", "ISSUE-fixed", "--resolver", "Someone"]),
    ],
)
def test_obsolete_noncanonical_flags_do_not_create_intents(monkeypatch, tmp_path, module, args):
    configure(monkeypatch, tmp_path, module)
    output = CliRunner().invoke(module.app, args + COMMON)
    assert output.exit_code == 2
    assert not (tmp_path / ".sop-runtime/outbox.sqlite").exists()


@pytest.mark.parametrize(
    "module,module_name",
    [(requirement, "requirements"), (task, "tasks"), (issue, "issues"), (sprint, "sprints")],
)
def test_explicit_local_list_reads_only_scoped_manager_cache(monkeypatch, tmp_path, module, module_name):
    configure(monkeypatch, tmp_path, module)
    runtime = tmp_path / ".sop-runtime"
    cache = runtime / "sync/entities"
    cache.mkdir(parents=True)
    (runtime / "sync_state.json").write_text(json.dumps({"project_id": "p-reviewed"}), encoding="utf-8")
    (cache / f"{module_name}.json").write_text(
        json.dumps(
            {
                "record-one": {
                    "id": "record-one",
                    "title": "Actual cached row",
                    "goal": "Actual cached row",
                    "owner_id": "member-one",
                }
            }
        ),
        encoding="utf-8",
    )
    local = runtime / "local"
    local.mkdir()
    (local / f"{module_name}.json").write_text(
        json.dumps(
            {
                "speculative": {
                    "id": "speculative",
                    "title": "Speculative unprocessed",
                    "goal": "Speculative unprocessed",
                }
            }
        ),
        encoding="utf-8",
    )
    (local / f"{module_name}_deleted.json").write_text(json.dumps(["record-one"]), encoding="utf-8")
    before = {p: p.read_bytes() for p in runtime.rglob("*") if p.is_file()}
    output = CliRunner().invoke(module.app, ["list", "--local"])
    assert output.exit_code == 0, output.output
    assert "Actual cached row" in output.output
    assert "Speculative unprocessed" not in output.output
    assert "缓存" in output.output or "cache" in output.output.lower()
    if module is task:
        assert "member-one" in output.output
    assert {p: p.read_bytes() for p in runtime.rglob("*") if p.is_file()} == before


@pytest.mark.parametrize(
    "module,module_name",
    [(requirement, "requirements"), (task, "tasks"), (issue, "issues"), (sprint, "sprints")],
)
def test_cached_read_does_not_adopt_another_project(monkeypatch, tmp_path, module, module_name):
    configure(monkeypatch, tmp_path, module)
    runtime = tmp_path / ".sop-runtime"
    cache = runtime / "sync/entities"
    cache.mkdir(parents=True)
    (runtime / "sync_state.json").write_text(json.dumps({"project_id": "other-project"}), encoding="utf-8")
    (cache / f"{module_name}.json").write_text(
        json.dumps({"hidden": {"id": "hidden", "title": "Private cached row", "goal": "Private cached row"}}),
        encoding="utf-8",
    )
    output = CliRunner().invoke(module.app, ["list", "--local"])
    assert output.exit_code != 0
    assert "Private cached row" not in output.output


@pytest.mark.parametrize("module,args,module_name,action,explicit", CASES)
def test_all_remote_denials_keep_original_without_local_business_success(
    monkeypatch, tmp_path, module, args, module_name, action, explicit
):
    from sop_cli import local_intents

    configure(monkeypatch, tmp_path, module)

    class Client:
        def events_identity(self):
            raise SopForbiddenError("Forbidden", status=403)

    @contextmanager
    def factory(config):
        yield Client()

    monkeypatch.setattr(local_intents, "build_default_client", factory)
    output = CliRunner().invoke(module.app, args + COMMON[:-1])
    assert output.exit_code == 2, output.output
    result = json.loads(output.output)
    assert result["ok"] is False and result["retained"] is True
    assert result["event_id"] == "operation-one"
    assert result["delivery_state"] == "pending"
    (event,) = read_events(tmp_path)
    assert event["id"] == "operation-one" and event["time"] == TIME
    assert event["data"]["record"]["id"] == explicit["id"]
    assert_no_speculative_files(tmp_path)


def receipt_response(frozen, state="processed", outcome="stored"):
    return {
        "tenant_id": "t-reviewed",
        "project_id": "p-reviewed",
        "producer": {"kind": "user", "id": "user-one"},
        "as_of": TIME,
        "results": [
            {
                "id": frozen.id,
                "digest": frozen.digest,
                "outcome": outcome,
                "receipt_id": "receipt-original",
                "stored_at": TIME,
                "error": None,
                "processing": {
                    "state": state,
                    "revision": 2,
                    "handler": "sync.record",
                    "operation_id": "operation-business",
                    "attempts": 1,
                    "updated_at": TIME,
                    "processed_at": TIME if state == "processed" else None,
                    "reason_code": "version_conflict" if state == "failed" else None,
                    "retryable": False,
                    "result": {"kind": "record_upserted", "target_kind": "issue", "target_id": "ISSUE-fixed"}
                    if state == "processed"
                    else None,
                },
            }
        ],
    }


@pytest.mark.parametrize(
    "state,expected_exit,expected_ok", [("pending", 2, False), ("failed", 2, False), ("processed", 0, True)]
)
def test_durable_receipt_is_distinct_from_processed_business_result(
    monkeypatch, tmp_path, state, expected_exit, expected_ok
):
    from sop_cli import local_intents

    configure(monkeypatch, tmp_path, issue)

    class Client:
        def events_identity(self):
            return {"tenant_id": "t-reviewed", "project_id": "p-reviewed", "producer_id": "user-one"}

        def events_ingest(self, frozen, *, identity):
            return receipt_response(frozen[0], state)

    @contextmanager
    def factory(config):
        yield Client()

    monkeypatch.setattr(local_intents, "build_default_client", factory)
    output = CliRunner().invoke(issue.app, ["create", "Issue", "--record-id", "ISSUE-fixed"] + COMMON[:-1])
    assert output.exit_code == expected_exit, output.output
    result = json.loads(output.output)
    assert result["ok"] is expected_ok
    assert result["delivery_state"] == "acked" and result["processing"]["state"] == state
    assert result["receipt_id"] == "receipt-original"
    assert_no_speculative_files(tmp_path)


def test_response_lost_after_effect_recovers_same_original_receipt(monkeypatch, tmp_path):
    from sop_cli import local_intents

    configure(monkeypatch, tmp_path, issue)
    clock = [1_000_000]
    monkeypatch.setattr(event_outbox, "_now", lambda: clock[0])
    effects = {}
    wire = []

    class Client:
        def events_identity(self):
            return {"tenant_id": "t-reviewed", "project_id": "p-reviewed", "producer_id": "user-one"}

        def events_ingest(self, frozen, *, identity):
            (original,) = frozen
            wire.append(original.event_json)
            if original.id not in effects:
                effects[original.id] = receipt_response(original)
                raise TimeoutError("Committed effect; original response lost")
            return receipt_response(original, outcome="duplicate")

    @contextmanager
    def factory(config):
        yield Client()

    monkeypatch.setattr(local_intents, "build_default_client", factory)
    runner = CliRunner()
    args = ["create", "Issue", "--record-id", "ISSUE-fixed"] + COMMON[:-1]
    first = runner.invoke(issue.app, args)
    assert first.exit_code == 2
    pending = json.loads(first.output)
    assert pending["ok"] is False and pending["delivery_state"] == "pending"
    clock[0] += 10_000
    second = runner.invoke(issue.app, args)
    assert second.exit_code == 0, second.output
    recovered = json.loads(second.output)
    assert recovered["receipt_id"] == "receipt-original"
    assert recovered["replayed"] is True
    assert recovered["processing"]["state"] == "processed"
    assert len(effects) == 1 and len(wire) == 2 and wire[0] == wire[1]
    assert len(read_events(tmp_path)) == 1
    assert_no_speculative_files(tmp_path)


def test_sprint_completion_metadata_keeps_existing_percentage_units(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path, sprint)
    output = CliRunner().invoke(sprint.app, ["complete", "SPRINT-fixed", "--completion", "80"] + COMMON)
    assert output.exit_code == 0, output.output
    (event,) = read_events(tmp_path)
    assert event["data"]["record"] == {"id": "SPRINT-fixed", "status": "completed", "completion_rate": 80.0}


@pytest.mark.parametrize(
    "module,module_name",
    [(requirement, "requirements"), (task, "tasks"), (issue, "issues"), (sprint, "sprints")],
)
def test_remote_permission_failure_never_exposes_cache_as_current(monkeypatch, tmp_path, module, module_name):
    configure(monkeypatch, tmp_path, module)
    runtime = tmp_path / ".sop-runtime"
    cache = runtime / "sync/entities"
    cache.mkdir(parents=True)
    (runtime / "sync_state.json").write_text(json.dumps({"project_id": "p-reviewed"}), encoding="utf-8")
    (cache / f"{module_name}.json").write_text(
        json.dumps(
            {"hidden": {"id": "hidden", "title": "Old sensitive cache", "goal": "Old sensitive cache"}}
        ),
        encoding="utf-8",
    )

    class Client:
        def __getattr__(self, name):
            def read(**kwargs):
                raise SopForbiddenError("Access revoked", status=403)

            return read

    monkeypatch.setattr(module, "get_client", Client)
    output = CliRunner().invoke(module.app, ["list"])
    assert output.exit_code == 1
    assert "Old sensitive cache" not in output.output
    assert not (runtime / "outbox.sqlite").exists()


@pytest.mark.parametrize("module", [requirement, task, issue, sprint])
def test_create_requires_fixed_record_identity_before_any_write(monkeypatch, tmp_path, module):
    configure(monkeypatch, tmp_path, module)
    output = CliRunner().invoke(module.app, ["create", "Reviewed title"] + COMMON)
    assert output.exit_code == 2
    assert not (tmp_path / ".sop-runtime").exists()


def test_requirement_explicit_clears_keep_reviewed_empty_lists(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path, requirement)
    output = CliRunner().invoke(
        requirement.app,
        [
            "update",
            "REQ-fixed",
            "--clear-acceptance",
            "--clear-tags",
            "--notes",
            "",
            "--requirement-basis",
            REQ_BASIS,
            "--change-preview-basis",
            PREVIEW_BASIS,
        ]
        + COMMON,
    )
    assert output.exit_code == 0, output.output
    (event,) = read_events(tmp_path)
    assert event["data"]["record"] == {
        "id": "REQ-fixed",
        "acceptance_criteria": [],
        "tags": [],
        "human_notes": "",
    }
    assert event["data"]["requirement_basis"] == REQ_BASIS
    assert event["data"]["change_preview_basis"] == PREVIEW_BASIS


def test_conflicting_requirement_replace_and_clear_is_rejected_before_queue(monkeypatch, tmp_path):
    configure(monkeypatch, tmp_path, requirement)
    output = CliRunner().invoke(
        requirement.app,
        [
            "update",
            "REQ-fixed",
            "--acceptance",
            "Pass",
            "--clear-acceptance",
            "--requirement-basis",
            REQ_BASIS,
            "--change-preview-basis",
            PREVIEW_BASIS,
        ]
        + COMMON,
    )
    assert output.exit_code == 2
    assert not (tmp_path / ".sop-runtime").exists()
