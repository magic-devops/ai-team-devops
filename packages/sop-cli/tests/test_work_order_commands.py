"""Saved CLI originals and page selection definitions; not executed this stage."""
from contextlib import contextmanager
import json

import pytest
from typer.testing import CliRunner

from sop_cli.commands import delivery


@pytest.fixture
def calls(monkeypatch):
    values = []
    class Client:
        def __getattr__(self, name):
            def call(*args, **kwargs):
                values.append((name, args, kwargs))
                return {"items": [], "next_cursor": "more", "state": "queued"}
            return call
    @contextmanager
    def get_client(): yield Client()
    monkeypatch.setattr(delivery, "get_client", get_client)
    return values


def test_reads_keep_real_task_order_and_one_page(calls):
    args = [["work-orders", "--task", "任务 一", "--state", "claimed", "--limit", "1", "--cursor", "opaque +/=cursor"],
        ["work-order-current", "--task", "任务 一"], ["work-order", "--id", "work-order-1"],
        ["work-order-packet", "--id", "work-order-1"]]
    for selection in args:
        result = CliRunner().invoke(delivery.app, selection)
        assert result.exit_code == 0, result.output
    assert len(calls) == 4
    assert calls[0] == ("delivery_work_orders", (), {"task_id": "任务 一", "state": "claimed", "limit": 1, "cursor": "opaque +/=cursor"})
    assert calls[1][1] == ("任务 一",) and calls[3][1] == ("work-order-1",)


def test_unknown_write_reuses_saved_original_and_file(calls, tmp_path):
    body = {"action": "work_order.claim", "expected_version": 7, "idempotency_key": "original-claim-key", "payload": {"id": "work-order-1", "order_revision": 1}}
    path = tmp_path / "original.json"
    raw = json.dumps(body).encode("utf-8"); path.write_bytes(raw)
    for _ in range(2):
        result = CliRunner().invoke(delivery.app, ["work-order-command", "--file", str(path)])
        assert result.exit_code == 0, result.output
    assert calls[0] == calls[1] == ("delivery_work_order_command", (body,), {})
    assert path.read_bytes() == raw


def test_preview_is_explicit_and_is_not_a_dispatch(calls, tmp_path):
    body = {"task_basis": "a" * 64, "executor_member_id": "agent-1", "instructions": ""}
    path = tmp_path / "preview.json"; path.write_text(json.dumps(body), encoding="utf-8")
    result = CliRunner().invoke(delivery.app, ["work-order-preview", "--task", "任务 一", "--file", str(path)])
    assert result.exit_code == 0, result.output
    assert calls == [("delivery_work_order_preview", ("任务 一", body), {})]


def test_bad_saved_original_never_constructs_a_replacement(calls, tmp_path):
    path = tmp_path / "bad.json"; path.write_text('{"action":"work_order.claim","action":"work_order.report"}', encoding="utf-8")
    assert CliRunner().invoke(delivery.app, ["work-order-command", "--file", str(path)]).exit_code != 0
    assert calls == []
