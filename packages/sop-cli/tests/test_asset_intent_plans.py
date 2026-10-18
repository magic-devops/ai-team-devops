import json
import time
from concurrent.futures import ThreadPoolExecutor

from sop_cli import rule_store
from sop_cli.commands import rule, sync
from sop_sdk import AgentConfig
from typer.testing import CliRunner


def config(monkeypatch, tmp_path):
    cfg = AgentConfig(project_id="P", project_path=tmp_path)
    monkeypatch.setattr("sop_cli._util.get_config", lambda: cfg)
    monkeypatch.setattr(rule, "get_config", lambda: cfg)
    return cfg


def test_watch_template_namespace_and_original_crlf_are_not_replaced_by_builtin(monkeypatch, tmp_path):
    config(monkeypatch, tmp_path)
    custom = tmp_path / "sop/custom/templates/shared.md"
    builtin = tmp_path / "sop/templates/shared.md"
    custom.parent.mkdir(parents=True)
    builtin.parent.mkdir(parents=True)
    custom.write_bytes(b"custom\r\noriginal\r\n")
    builtin.write_bytes(b"builtin\n")
    files = sync._scan_watch_files({"templates"})
    assert list(files) == ["templates:templates/shared.md"]
    assert files["templates:templates/shared.md"]["content"].encode() == b"custom\r\noriginal\r\n"


def test_watch_only_previews_and_never_enqueues_an_unreviewed_change(monkeypatch, tmp_path):
    config(monkeypatch, tmp_path)
    target = tmp_path / ".ai-memory/rules/RULES.md"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"local change\r\n")
    result = CliRunner().invoke(sync.app, ["watch", "--once", "--modules", "rules"])
    assert result.exit_code == 0, result.exception
    assert not (tmp_path / ".sop-runtime/sync/push_queue.jsonl").exists()
    assert not (tmp_path / ".sop-runtime/outbox.sqlite").exists()
    assert target.read_bytes() == b"local change\r\n"


def test_concurrent_rule_applications_preserve_both_reviewed_proposals(monkeypatch, tmp_path):
    cfg = config(monkeypatch, tmp_path)
    first = rule_store.create_proposal(
        cfg, "First reviewed rule", "coding", "human", 0.75, "2026-10-18T00:00:00Z"
    )
    second = rule_store.create_proposal(
        cfg, "Second reviewed rule", "coding", "human", 0.75, "2026-10-18T00:00:00Z"
    )
    original = rule_store._atomic

    def slow_file_write(path, data):
        if path.name == "RULES.md":
            time.sleep(0.1)
        original(path, data)

    monkeypatch.setattr(rule_store, "_atomic", slow_file_write)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [
            pool.submit(rule_store.apply_proposal, cfg, row["id"], "2026-10-18T00:00:01Z")
            for row in (first, second)
        ]
        for result in results:
            result.result(timeout=5)
    data = (tmp_path / ".ai-memory/rules/RULES.md").read_text(encoding="utf-8")
    assert data.count("First reviewed rule") == 1
    assert data.count("Second reviewed rule") == 1
    assert not (tmp_path / ".sop-runtime/outbox.sqlite").exists()


def test_same_rule_proposal_applied_twice_does_not_add_a_second_rule(monkeypatch, tmp_path):
    config(monkeypatch, tmp_path)
    tick = iter(
        [
            "2026-10-18T00:00:00Z",
            "2026-10-18T00:00:01Z",
            "2026-10-18T00:00:02Z",
            "2026-10-18T00:00:03Z",
            "2026-10-18T00:00:04Z",
        ]
    )
    monkeypatch.setattr(rule, "_now", lambda: next(tick))
    runner = CliRunner()
    result = runner.invoke(rule.app, ["propose", "Keep original intent", "--no-apply", "--json"])
    assert result.exit_code == 0, result.exception
    proposal = json.loads(result.stdout)["item"]
    assert runner.invoke(rule.app, ["apply", proposal["id"]]).exit_code == 0
    assert runner.invoke(rule.app, ["apply", proposal["id"]]).exit_code == 0
    assert (tmp_path / ".ai-memory/rules/RULES.md").read_text(encoding="utf-8").count(
        "Keep original intent"
    ) == 1
    assert not (tmp_path / ".sop-runtime/sync/push_queue.jsonl").exists()
