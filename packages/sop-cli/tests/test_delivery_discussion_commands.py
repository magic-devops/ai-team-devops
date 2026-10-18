import importlib
import json
from contextlib import contextmanager

import pytest
from sop_cli.commands import delivery
from sop_sdk.errors import SopConflictError
from typer.testing import CliRunner


@pytest.fixture
def calls(monkeypatch):
    seen = []

    class Client:
        def __getattr__(self, name):
            def call(*args, **options):
                seen.append((name, args, options))
                return {
                    "original": True,
                    "total": 51,
                    "items": [],
                    "has_more": True,
                    "next_cursor": "opaque+/=?",
                }

            return call

    @contextmanager
    def get_client():
        yield Client()

    try:
        module = importlib.import_module("sop_cli.commands.delivery_discussion")
    except ModuleNotFoundError:
        module = delivery
    monkeypatch.setattr(module, "get_client", get_client)
    monkeypatch.setattr(delivery, "get_client", get_client)
    return seen


@pytest.mark.parametrize(
    "args,method,ids,options",
    [
        (
            [
                "list",
                "--subject-kind",
                "task",
                "--subject-id",
                "task-one",
                "--state",
                "resolved",
                "--limit",
                "7",
                "--cursor",
                "opaque",
            ],
            "delivery_discussions",
            (),
            {
                "subject_kind": "task",
                "subject_id": "task-one",
                "state": "resolved",
                "limit": 7,
                "cursor": "opaque",
            },
        ),
        (["show", "--thread", "thread-one"], "delivery_discussion", ("thread-one",), {}),
        (
            ["messages", "--thread", "thread-one"],
            "delivery_discussion_messages",
            ("thread-one",),
            {"limit": 20, "cursor": ""},
        ),
        (
            ["message", "--thread", "thread-one", "--message", "message-one"],
            "delivery_discussion_message",
            ("thread-one", "message-one"),
            {},
        ),
        (
            ["versions", "--thread", "thread-one", "--message", "message-one", "--limit", "7"],
            "delivery_discussion_message_versions",
            ("thread-one", "message-one"),
            {"limit": 7, "cursor": ""},
        ),
        (
            ["versions", "--thread", "thread-one", "--message", "message-one", "--revision", "3"],
            "delivery_discussion_message_version",
            ("thread-one", "message-one", 3),
            {},
        ),
        (
            [
                "reference",
                "--kind",
                "task",
                "--id",
                "task-one",
                "--field",
                "acceptance_criteria",
                "--criterion-index",
                "0",
            ],
            "delivery_discussion_reference",
            ("task", "task-one"),
            {"field": "acceptance_criteria", "criterion_index": 0},
        ),
        (
            ["links", "--thread", "thread-one", "--resolution-event", "resolution-one"],
            "delivery_discussion_links",
            ("thread-one",),
            {"resolution_event_id": "resolution-one", "limit": 20, "cursor": ""},
        ),
        (
            ["sources", "--kind", "task", "--id", "task-one"],
            "delivery_sources",
            ("task", "task-one"),
            {"limit": 20, "cursor": ""},
        ),
    ],
)
def test_discussion_reads_are_exact_and_preserve_complete_json(calls, args, method, ids, options):
    result = CliRunner().invoke(delivery.app, ["discussion", *args])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["next_cursor"] == "opaque+/=?"
    assert calls == [(method, ids, options)]


@pytest.mark.parametrize(
    "action,ids",
    [
        ("create", []),
        ("reply", ["--thread", "thread-one"]),
        ("edit", ["--thread", "thread-one", "--message", "message-one"]),
        ("withdraw", ["--thread", "thread-one", "--message", "message-one"]),
        *[(a, ["--thread", "thread-one"]) for a in ("resolve", "reopen", "archive", "restore", "link")],
    ],
)
def test_discussion_writes_reuse_exact_original_json_file(calls, tmp_path, action, ids):
    body = {"idempotency_key": "original-file-key", "body": "Original retained wording"}
    file = tmp_path / "original.json"
    original = json.dumps(body, ensure_ascii=False).encode()
    file.write_bytes(original)
    result = CliRunner().invoke(delivery.app, ["discussion", action, *ids, "--file", str(file)])
    assert result.exit_code == 0, result.output
    args = tuple(ids[i] for i in range(1, len(ids), 2)) + (body,)
    assert calls == [("delivery_discussion_" + action, args, {})]
    assert file.read_bytes() == original


@pytest.mark.parametrize(
    "args",
    [
        ["list", "--limit", "51"],
        ["list", "--state", "complete"],
        ["versions", "--thread", "thread-one", "--message", "message-one", "--revision", "0"],
        [
            "versions",
            "--thread",
            "thread-one",
            "--message",
            "message-one",
            "--revision",
            "3",
            "--cursor",
            "old",
        ],
    ],
)
def test_invalid_cli_read_selection_is_not_sent(calls, args):
    result = CliRunner().invoke(delivery.app, ["discussion", *args])
    assert result.exit_code != 0 and calls == []


def test_delivery_command_accepts_only_optional_root_provenance(calls, tmp_path):
    source = {
        "thread_id": "thread-one",
        "expected_thread_version": 2,
        "resolution_event_id": "resolution-one",
        "message_id": "message-one",
        "message_revision": 1,
    }
    body = {
        "action": "task.update",
        "payload": {"id": "task-one"},
        "expected_version": 9,
        "idempotency_key": "original-business-key",
        "source_reference": source,
    }
    file = tmp_path / "command.json"
    original = json.dumps(body).encode()
    file.write_bytes(original)
    result = CliRunner().invoke(delivery.app, ["command", "--file", str(file)])
    assert result.exit_code == 0, result.output
    assert calls == [("delivery_command", (body,), {})] and file.read_bytes() == original
    file.write_bytes(json.dumps({**body, "author_id": "forged"}).encode())
    assert CliRunner().invoke(delivery.app, ["command", "--file", str(file)]).exit_code != 0
    assert len(calls) == 1


def test_unknown_write_result_keeps_original_file_for_explicit_retry(monkeypatch, tmp_path):
    try:
        module = importlib.import_module("sop_cli.commands.delivery_discussion")
    except ModuleNotFoundError:
        module = delivery
    seen = []

    class Client:
        def delivery_discussion_reply(self, thread, body):
            seen.append((thread, body))
            raise SopConflictError("Pinned discussion changed", status=409)

    @contextmanager
    def get_client():
        yield Client()

    monkeypatch.setattr(module, "get_client", get_client)
    body = {"body": "Keep my draft", "idempotency_key": "original-key"}
    file = tmp_path / "reply.json"
    original = json.dumps(body).encode()
    file.write_bytes(original)
    for _ in range(2):
        result = CliRunner().invoke(
            delivery.app, ["discussion", "reply", "--thread", "thread-one", "--file", str(file)]
        )
        assert result.exit_code == 1 and "Pinned discussion changed" in result.output
    assert seen == [("thread-one", body)] * 2 and file.read_bytes() == original
