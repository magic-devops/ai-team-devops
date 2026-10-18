"""Reviewed asset snapshots preserve bytes and never infer remote write authority."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest
from sop_cli.commands import sync
from sop_sdk.config import AgentConfig
from sop_sdk.event_envelope import strict_json
from sop_sdk.event_outbox import EventOutbox
from typer.testing import CliRunner

TIME = "2026-10-18T00:00:00Z"


@pytest.fixture
def project(monkeypatch, tmp_path):
    config = AgentConfig(project_id="P", project_path=tmp_path)
    monkeypatch.setattr("sop_cli._util.get_config", lambda: config)
    return config


def asset(project, path=".ai-memory/rules/RULES.md", content=b"Original\r\n"):
    target = project.project_path / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return target


def plan_file(project, entries=None):
    content = "Reviewed\r\noriginal\r\n"
    plan = {
        "schema": "sop.sync.asset-plan.v1",
        "project_id": "P",
        "captured_at": TIME,
        "entries": entries
        if entries is not None
        else [
            {
                "module": "rules",
                "path": "RULES.md",
                "action": "upsert",
                "content": content,
                "sha256": hashlib.sha256(content.encode()).hexdigest(),
            }
        ],
    }
    target = project.project_path / "reviewed-plan.json"
    target.write_bytes(json.dumps(plan, ensure_ascii=False).encode())
    return target, plan


def enqueue_args(target, *, entry="rules:RULES.md", key="reviewed-1", basis="absent"):
    return [
        "enqueue-plan",
        str(target),
        "--entry",
        entry,
        "--expected-version",
        "7",
        "--key",
        key,
        "--time",
        TIME,
        "--expected-sha256",
        basis,
    ]


def test_watch_once_emits_original_snapshot_and_leaves_legacy_files_unchanged(project):
    original = b"Reviewed\r\nUnicode \xe5\x8e\x9f\xe6\x96\x87\r\n"
    target = asset(project, content=original)
    legacy = asset(project, ".sop-runtime/sync/watch_state.json", b'{"files":{"old":true}}')
    queue = asset(project, ".sop-runtime/sync/push_queue.jsonl", b'{"old":"keep"}\n')
    result = CliRunner().invoke(sync.app, ["watch", "--once", "--modules", "rules"])
    assert result.exit_code == 0, result.exception
    plan = json.loads(result.stdout)
    assert plan["schema"] == "sop.sync.asset-plan.v1"
    assert plan["project_id"] == "P"
    assert plan["entries"] == [
        {
            "module": "rules",
            "path": "RULES.md",
            "action": "upsert",
            "content": original.decode(),
            "sha256": hashlib.sha256(original).hexdigest(),
        }
    ]
    assert target.read_bytes() == original
    assert legacy.read_bytes() == b'{"files":{"old":true}}'
    assert queue.read_bytes() == b'{"old":"keep"}\n'
    assert not (project.project_path / ".sop-runtime/outbox.sqlite").exists()


def test_watch_save_is_explicit_and_every_snapshot_is_new(project):
    asset(project)
    runner = CliRunner()
    args = ["watch", "--once", "--modules", "rules", "--out-dir", ".cache/reviewed"]
    first = runner.invoke(sync.app, args)
    assert first.exit_code == 0, first.exception
    files = list((project.project_path / ".cache/reviewed").glob("*.json"))
    assert len(files) == 1
    original = files[0].read_bytes()
    assert runner.invoke(sync.app, args).exit_code == 0
    assert len(list((project.project_path / ".cache/reviewed").glob("*.json"))) == 2
    assert files[0].read_bytes() == original
    assert json.loads(original)["entries"][0]["content"] == "Original\r\n"


@pytest.mark.parametrize("flag", ["--flush", "--no-delete"])
def test_old_watch_delivery_flags_are_removed(project, flag):
    result = CliRunner().invoke(sync.app, ["watch", "--once", flag])
    assert result.exit_code == 2
    assert not (project.project_path / ".sop-runtime").exists()


@pytest.mark.parametrize("command", ["compact", "repair"])
def test_old_intent_rewrite_commands_are_removed(project, command):
    queue = asset(project, ".sop-runtime/sync/push_queue.jsonl", b"bad\nold-original\n")
    result = CliRunner().invoke(sync.app, [command])
    assert result.exit_code == 2
    assert queue.read_bytes() == b"bad\nold-original\n"


def test_scan_rejects_invalid_utf8_and_does_not_create_a_delete(project):
    asset(project, content=b"invalid \xff")
    result = CliRunner().invoke(sync.app, ["watch", "--once", "--modules", "rules"])
    assert result.exit_code == 2
    assert "UTF-8" in result.stdout
    assert not (project.project_path / ".sop-runtime").exists()


def test_scan_entry_limit_is_explicit_and_include_selects_original_path(project):
    for index in range(51):
        asset(project, f"sop/custom/specs/{index:02}.md", f"spec-{index}\r\n".encode())
    runner = CliRunner()
    too_many = runner.invoke(sync.app, ["watch", "--once", "--modules", "specs"])
    assert too_many.exit_code == 2
    assert "50" in too_many.stdout
    selected = runner.invoke(sync.app, ["watch", "--once", "--modules", "specs", "--include", "specs:50.md"])
    assert selected.exit_code == 0, selected.exception
    assert json.loads(selected.stdout)["entries"][0]["content"] == "spec-50\r\n"
    assert len(json.loads(selected.stdout)["entries"]) == 1


def test_scan_rejects_large_file_without_truncation(project):
    source = asset(project, content=b"x" * (60 * 1024 + 1))
    result = CliRunner().invoke(sync.app, ["watch", "--once", "--modules", "rules"])
    assert result.exit_code == 2
    assert source.stat().st_size == 60 * 1024 + 1
    assert not (project.project_path / ".sop-runtime").exists()


def test_plan_total_limit_is_explicit_even_when_each_file_fits(project):
    for index in range(20):
        asset(project, f"sop/custom/specs/{index:02}.md", b"x" * 60000)
    result = CliRunner().invoke(sync.app, ["watch", "--once", "--modules", "specs"])
    assert result.exit_code == 2
    assert "1 MiB" in result.stdout


def test_enqueue_plan_uses_original_snapshot_after_source_changed_and_replays_same_key(project):
    target, plan = plan_file(project)
    source = asset(project, content=b"Changed after review\n")
    args = enqueue_args(target)
    runner = CliRunner()
    first = runner.invoke(sync.app, args)
    assert first.exit_code == 0, first.exception
    assert json.loads(first.stdout)["state"] == "pending"
    assert runner.invoke(sync.app, args).exit_code == 0
    with EventOutbox(project.project_path / project.outbox_path) as box:
        frozen = strict_json(box.inspect("reviewed-1")["event_json"])
        assert frozen["data"]["record"] == {
            "path": "RULES.md",
            "content": plan["entries"][0]["content"],
            "expected_sha256": None,
        }
        assert box.stats()["pending"] == 1
    assert source.read_bytes() == b"Changed after review\n"
    assert not (project.project_path / ".sop-runtime/sync/push_queue.jsonl").exists()


def test_enqueue_plan_same_key_changed_control_or_content_conflicts(project):
    target, plan = plan_file(project)
    runner = CliRunner()
    assert runner.invoke(sync.app, enqueue_args(target)).exit_code == 0
    changed = runner.invoke(sync.app, enqueue_args(target, basis="a" * 64))
    assert changed.exit_code == 2 and "event_id_conflict" in changed.stdout
    plan["entries"][0]["content"] = "Different original"
    plan["entries"][0]["sha256"] = hashlib.sha256(b"Different original").hexdigest()
    target.write_bytes(json.dumps(plan).encode())
    changed = runner.invoke(sync.app, enqueue_args(target))
    assert changed.exit_code == 2 and "event_id_conflict" in changed.stdout


@pytest.mark.parametrize(
    "corruption",
    ["project", "digest", "duplicate", "unknown_field", "path", "delete_content", "unselected_bad"],
)
def test_entire_plan_validation_precedes_any_enqueue(project, corruption):
    target, plan = plan_file(project)
    entry = plan["entries"][0]
    if corruption == "project":
        plan["project_id"] = "other"
    elif corruption == "digest":
        entry["sha256"] = "a" * 64
    elif corruption == "duplicate":
        plan["entries"].append(dict(entry))
    elif corruption == "unknown_field":
        plan["ignored"] = True
    elif corruption == "path":
        entry["path"] = "../outside.md"
    elif corruption == "delete_content":
        entry.update(action="delete", sha256=None)
    else:
        plan["entries"].append({**entry, "path": "OTHER.md", "sha256": "b" * 64})
    target.write_bytes(json.dumps(plan).encode())
    result = CliRunner().invoke(sync.app, enqueue_args(target))
    assert result.exit_code == 2
    assert not (project.project_path / project.outbox_path).exists()


def test_enqueue_delete_keeps_explicit_remote_basis_and_has_no_content(project):
    target, _ = plan_file(
        project, [{"module": "templates", "path": "templates/old.md", "action": "delete", "sha256": None}]
    )
    result = CliRunner().invoke(
        sync.app, enqueue_args(target, entry="templates:templates/old.md", basis="f" * 64)
    )
    assert result.exit_code == 0, result.exception
    with EventOutbox(project.project_path / project.outbox_path) as box:
        data = strict_json(box.inspect("reviewed-1")["event_json"])["data"]
    assert data["action"] == "delete"
    assert data["record"] == {"path": "templates/old.md", "expected_sha256": "f" * 64}


def test_push_file_requires_explicit_original_digest_and_preserves_crlf(project):
    source = asset(project, content=b"Original\r\n")
    runner = CliRunner()
    args = [
        "enqueue-file",
        "rules",
        str(source),
        "--expected-version",
        "3",
        "--key",
        "file-original",
        "--time",
        TIME,
    ]
    assert runner.invoke(sync.app, args).exit_code == 2
    result = runner.invoke(sync.app, [*args, "--expected-sha256", "absent"])
    assert result.exit_code == 0, result.exception
    with EventOutbox(project.project_path / project.outbox_path) as box:
        record = strict_json(box.inspect("file-original")["event_json"])["data"]["record"]
    assert record == {"path": "RULES.md", "content": "Original\r\n", "expected_sha256": None}


@pytest.mark.parametrize(
    "module,record,flag",
    [
        ("tasks", {"id": "T", "owner_id": "user:lead"}, "--task-basis"),
        ("requirements", {"id": "R", "title": "Changed"}, "--requirement-basis"),
    ],
)
def test_generic_enqueue_preserves_explicit_action_and_top_level_basis(project, module, record, flag):
    args = [
        "enqueue",
        module,
        json.dumps(record),
        "--action",
        "update",
        "--expected-version",
        "4",
        "--key",
        "basis-intent",
        "--time",
        TIME,
        flag,
        "a" * 64,
    ]
    if module == "requirements":
        args += ["--change-preview-basis", "b" * 64]
    result = CliRunner().invoke(sync.app, args)
    assert result.exit_code == 0, result.exception
    with EventOutbox(project.project_path / project.outbox_path) as box:
        data = strict_json(box.inspect("basis-intent")["event_json"])["data"]
    assert data["action"] == "update"
    assert data[flag.removeprefix("--").replace("-", "_")] == "a" * 64
    if module == "requirements":
        assert data["change_preview_basis"] == "b" * 64


def test_pull_rejects_module_traversal_before_cache_or_business_file_write(project):
    with pytest.raises(ValueError):
        sync._materialize_pull_result({"project_id": "P", "changes": {"../../escape": [{"id": "bad"}]}})
    assert not (project.project_path / ".sop-runtime").exists()


def test_file_source_and_output_directory_cannot_escape_project(project, tmp_path):
    outside = tmp_path.parent / "outside-source.md"
    outside.write_bytes(b"Outside original")
    with pytest.raises(ValueError):
        sync._sync_file_record("rules", str(outside), "RULES.md")
    asset(project)
    result = CliRunner().invoke(
        sync.app, ["watch", "--once", "--out-dir", str(tmp_path.parent / "outside-output")]
    )
    assert result.exit_code == 2
    assert not (tmp_path.parent / "outside-output").exists()


def junction(link: Path, target: Path):
    if os.name == "nt":
        import subprocess

        shell = str(Path(os.environ["SystemRoot"]) / "System32/cmd.exe")
        # Both paths belong to this isolated fixture; mklink creates only the owned junction.
        result = subprocess.run(  # noqa: S603
            [shell, "/d", "/c", "mklink", "/J", str(link), str(target)], capture_output=True
        )
        assert result.returncode == 0, result.stdout + result.stderr
    else:
        link.symlink_to(target, target_is_directory=True)


def test_root_junction_fails_closed_without_changing_target(project, tmp_path):
    outside = tmp_path.parent / "linked-rules-target"
    outside.mkdir()
    original = outside / "RULES.md"
    original.write_bytes(b"Outside\r\n")
    link = tmp_path / ".ai-memory/rules"
    link.parent.mkdir()
    junction(link, outside)
    try:
        result = CliRunner().invoke(sync.app, ["watch", "--once", "--modules", "rules"])
        assert result.exit_code == 2
        assert sync._safe_asset_target("rules", "RULES.md") is None
        assert original.read_bytes() == b"Outside\r\n"
        assert not (tmp_path / ".sop-runtime").exists()
    finally:
        link.rmdir() if os.name == "nt" else link.unlink()


def test_nested_junction_is_not_traversed_or_sent_as_a_delete(project, tmp_path):
    root = tmp_path / "sop/custom/specs"
    root.mkdir(parents=True)
    (root / "real.md").write_bytes(b"Real\r\n")
    outside = tmp_path.parent / "nested-link-target"
    outside.mkdir()
    original = outside / "hidden.md"
    original.write_bytes(b"Do not read or change")
    link = root / "linked"
    junction(link, outside)
    try:
        files = sync._scan_watch_files({"specs"})
        assert list(files) == ["specs:real.md"]
        assert original.read_bytes() == b"Do not read or change"
    finally:
        link.rmdir() if os.name == "nt" else link.unlink()


@pytest.mark.parametrize("filtered", [False, True])
def test_continuous_watch_uses_only_memory_to_detect_delete(project, monkeypatch, filtered):
    source = asset(project)
    calls = 0

    def sleep(_):
        nonlocal calls
        calls += 1
        if calls == 1:
            source.unlink()
        else:
            raise KeyboardInterrupt

    monkeypatch.setattr("time.sleep", sleep)
    args = ["watch", "--modules", "rules"]
    if filtered:
        args += ["--include", "rules:RULES.md"]
    result = CliRunner().invoke(sync.app, args)
    assert result.exit_code == 0, result.exception
    # Each iteration is one complete JSON plan; there are no status lines on stdout.
    decoder = json.JSONDecoder()
    text = result.stdout.strip()
    first, end = decoder.raw_decode(text)
    second, _ = decoder.raw_decode(text[end:].lstrip())
    assert first["entries"][0]["action"] == "upsert"
    assert second["entries"] == [{"module": "rules", "path": "RULES.md", "action": "delete", "sha256": None}]
    assert not (project.project_path / ".sop-runtime").exists()


def test_previous_nested_tree_replaced_by_junction_is_never_reported_as_deleted(project):
    from sop_cli.asset_plans import make_plan

    source = asset(project, "sop/custom/specs/nested/old.md")
    previous = sync._scan_watch_files({"specs"})
    old_tree = source.parent
    backup = old_tree.with_name("preserved-original")
    old_tree.rename(backup)
    target = project.project_path / "unwatched-target"
    target.mkdir()
    (target / "user.md").write_bytes(b"Unrelated target original")
    junction(old_tree, target)
    try:
        current = sync._scan_watch_files({"specs"})
        with pytest.raises(ValueError, match="redirection"):
            make_plan(project.project_path, "P", current, previous)
        assert (backup / "old.md").read_bytes() == b"Original\r\n"
        assert (target / "user.md").read_bytes() == b"Unrelated target original"
    finally:
        old_tree.rmdir() if os.name == "nt" else old_tree.unlink()


def test_frozen_event_over_limit_does_not_partially_initialize_queue(project):
    original = '"' * 60000
    target, _ = plan_file(
        project,
        [
            {
                "module": "rules",
                "path": "RULES.md",
                "action": "upsert",
                "sha256": hashlib.sha256(original.encode()).hexdigest(),
                "content": original,
            }
        ],
    )
    result = CliRunner().invoke(sync.app, enqueue_args(target))
    assert result.exit_code == 2 and "event too large" in result.stdout
    assert not (project.project_path / project.outbox_path).exists()


def test_pull_preserves_bytes_and_uses_distinct_canonical_module_names(project):
    result = {
        "project_id": "P",
        "cursor": "exact-original",
        "changes": {
            "rules": [{"path": "RULES.md", "content": "Rules\r\n"}],
            "templates": [{"path": "templates/shared.md", "content": "Custom\r\n"}],
            "specs": [{"path": "shared.md", "content": "Specification\r\n"}],
        },
    }
    assert sync._materialize_pull_result(result) == {"rules": 1, "templates": 1, "specs": 1}
    assert (project.project_path / ".ai-memory/rules/RULES.md").read_bytes() == b"Rules\r\n"
    assert (project.project_path / "sop/custom/templates/shared.md").read_bytes() == b"Custom\r\n"
    assert (project.project_path / "sop/custom/specs/shared.md").read_bytes() == b"Specification\r\n"
    assert not (project.project_path / "sop/templates").exists()
    assert sorted(path.name for path in (project.project_path / ".sop-runtime/sync/entities").iterdir()) == [
        "rules.json",
        "specs.json",
        "templates.json",
    ]


def test_pull_rejects_foreign_scope_and_redirected_cache_before_writes(project):
    with pytest.raises(ValueError, match="project"):
        sync._materialize_pull_result({"project_id": "other", "changes": {"tasks": [{"id": "T"}]}})
    target = project.project_path / "unrelated-cache-target"
    target.mkdir()
    original = target / "tasks.json"
    original.write_bytes(b'{"original":true}\n')
    link = project.project_path / ".sop-runtime/sync/entities"
    link.parent.mkdir(parents=True)
    junction(link, target)
    try:
        with pytest.raises(ValueError, match="redirection"):
            sync._materialize_pull_result({"project_id": "P", "changes": {"tasks": [{"id": "T"}]}})
        assert original.read_bytes() == b'{"original":true}\n'
        assert not (project.project_path / ".sop-runtime/sync_state.json").exists()
    finally:
        link.rmdir() if os.name == "nt" else link.unlink()


@pytest.mark.parametrize("mode", ["enqueue-plan", "enqueue-file"])
def test_asset_operation_uses_one_captured_project_scope(project, monkeypatch, mode):
    target, _ = plan_file(project)
    source = asset(project)
    other_root = project.project_path / "other-project"
    other_root.mkdir()
    other = AgentConfig(project_id="OTHER", project_path=other_root)
    calls = 0

    def changing_config():
        nonlocal calls
        calls += 1
        return project if calls == 1 else other

    monkeypatch.setattr("sop_cli._util.get_config", changing_config)
    args = (
        enqueue_args(target)
        if mode == "enqueue-plan"
        else [
            "enqueue-file",
            "rules",
            str(source),
            "--expected-version",
            "7",
            "--key",
            "reviewed-1",
            "--time",
            TIME,
            "--expected-sha256",
            "absent",
        ]
    )
    result = CliRunner().invoke(sync.app, args)
    assert result.exit_code == 0, result.exception
    assert not (other_root / other.outbox_path).exists()
    with EventOutbox(project.project_path / project.outbox_path) as box:
        assert box.inspect("reviewed-1")["intended_project_id"] == "P"


def test_watch_captures_its_original_project_once(project, monkeypatch):
    asset(project)
    other_root = project.project_path / "other-project"
    other_root.mkdir()
    other = AgentConfig(project_id="OTHER", project_path=other_root)
    calls = 0

    def changing_config():
        nonlocal calls
        calls += 1
        return project if calls == 1 else other

    monkeypatch.setattr("sop_cli._util.get_config", changing_config)
    result = CliRunner().invoke(sync.app, ["watch", "--once", "--modules", "rules"])
    assert result.exit_code == 0, result.exception
    plan = json.loads(result.stdout)
    assert plan["project_id"] == "P"
    assert len(plan["entries"]) == 1
    assert plan["entries"][0]["content"] == "Original\r\n"


@pytest.mark.parametrize(
    "unsafe",
    [
        "unsafe?.md",
        "unsafe*.md",
        'unsafe".md',
        "unsafe|.md",
        "NUL.md",
        "file.md:stream",
        "trailing. /file.md",
    ],
)
def test_snapshot_paths_are_canonical_on_windows_before_any_enqueue(project, unsafe):
    target, plan = plan_file(project)
    plan["entries"][0]["path"] = unsafe
    target.write_bytes(json.dumps(plan).encode())
    result = CliRunner().invoke(sync.app, enqueue_args(target, entry="rules:" + unsafe))
    assert result.exit_code == 2
    assert not (project.project_path / project.outbox_path).exists()


def test_all_sync_command_help_resolves_new_explicit_contracts():
    runner = CliRunner()
    for command in [
        "pull",
        "status",
        "doctor",
        "flush",
        "push",
        "enqueue",
        "push-file",
        "enqueue-file",
        "enqueue-plan",
        "watch",
    ]:
        result = runner.invoke(sync.app, [command, "--help"])
        assert result.exit_code == 0, (command, result.exception)
