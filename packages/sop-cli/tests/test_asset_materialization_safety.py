"""Independent bounded review probes; no edits to production or repository tests."""

import json
import os

import pytest
from sop_cli.asset_plans import file_record
from sop_cli.commands import sync
from sop_sdk.config import AgentConfig
from typer.testing import CliRunner


@pytest.fixture
def project(tmp_path, monkeypatch):
    root = tmp_path / "project"
    root.mkdir()
    cfg = AgentConfig(project_id="P", project_path=root)
    monkeypatch.setattr("sop_cli._util.get_config", lambda: cfg)
    return cfg


def test_pull_materialization_does_not_modify_hardlink_target_outside_project(project):
    root = project.project_path
    outside = root.parent / "unrelated-user-source.md"
    outside.write_bytes(b"Unique user original\r\n")
    linked = root / ".ai-memory/rules/linked.md"
    linked.parent.mkdir(parents=True)
    os.link(outside, linked)
    assert linked.stat().st_nlink >= 2
    payload = {
        "project_id": "P",
        "changes": {"rules": [{"path": "linked.md", "content": "Manager replacement\r\n"}]},
    }
    try:
        sync._materialize_pull_result(payload)
    except ValueError:
        pass
    assert outside.read_bytes() == b"Unique user original\r\n"


def test_watch_output_inside_watched_root_does_not_become_new_asset_input(project, monkeypatch):
    root = project.project_path
    source = root / "sop/custom/specs/original.md"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"Original\r\n")
    calls = 0

    def sleep(_):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise KeyboardInterrupt

    monkeypatch.setattr("time.sleep", sleep)
    response = CliRunner().invoke(
        sync.app, ["watch", "--modules", "specs", "--out-dir", "sop/custom/specs/snapshots"]
    )
    # Either reject this unsafe overlap before writing, or keep generated plans out of discovery.
    if response.exit_code == 2:
        assert not (source.parent / "snapshots").exists()
        return
    assert response.exit_code == 0, response.exception
    decoder = json.JSONDecoder()
    text = response.stdout.strip()
    plans = []
    while text:
        plan, end = decoder.raw_decode(text)
        plans.append(plan)
        text = text[end:].lstrip()
    assert len(plans) == 2
    assert plans[0]["entries"][0]["path"] == "original.md"
    assert plans[1]["entries"] == [], plans[1]


@pytest.mark.parametrize("suffix", [".txt", ".mdx"])
def test_discovery_and_explicit_file_intents_match_manager_asset_formats(project, suffix):
    source = project.project_path / ("sop/custom/specs/unsupported" + suffix)
    source.parent.mkdir(parents=True)
    source.write_bytes(b"Unsupported Manager asset format")
    assert sync._scan_watch_files({"specs"}) == {}
    with pytest.raises(ValueError, match="format"):
        file_record(project.project_path, "specs", str(source))
    assert not (project.project_path / ".sop-runtime/outbox.sqlite").exists()
