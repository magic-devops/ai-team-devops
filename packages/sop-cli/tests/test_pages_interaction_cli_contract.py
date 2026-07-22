from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_pages_cli_exposes_interaction_analysis_command():
    source = (ROOT / "packages/sop-cli/sop_cli/commands/pages.py").read_text(encoding="utf-8")

    assert '@app.command("interaction-analysis")' in source
    assert '@app.command("interaction-tasks")' in source
    assert '@app.command("interaction-ops")' in source
    assert '@app.command("interaction-ops-tasks")' in source
    assert '@app.command("interaction-ops-memory")' in source
    assert '@app.command("interaction-ops-export")' in source
    assert "pages_interaction_analysis" in source
    assert "pages_interaction_tasks" in source
    assert "pages_interaction_ops" in source
    assert "pages_interaction_ops_tasks" in source
    assert "pages_interaction_ops_memory" in source
    assert "pages_interaction_ops_export" in source
    for option in ("--domain", "--status", "--q", "--limit", "--json"):
        assert option in source
    for option in ("--dry-run/--create", "--include-ready", "--assigned-to"):
        assert option in source
    for option in ("--dry-run/--apply", "--include-low", "--idempotency-key", "--write-kb/--memory-only", "--include-events/--no-events"):
        assert option in source


def test_pages_sdk_exposes_interaction_analysis_method():
    source = (ROOT / "packages/sop-sdk-python/sop_sdk/client.py").read_text(encoding="utf-8")

    assert "def pages_interaction_analysis" in source
    assert "def pages_interaction_tasks" in source
    assert "def pages_interaction_ops" in source
    assert "def pages_interaction_ops_tasks" in source
    assert "def pages_interaction_ops_memory" in source
    assert "def pages_interaction_ops_export" in source
    assert "/api/v1/pages/interaction-analysis" in source
    assert "/api/v1/pages/interaction-analysis/tasks" in source
    assert "/api/v1/pages/interaction-ops" in source
    assert "/api/v1/pages/interaction-ops/tasks" in source
    assert "/api/v1/pages/interaction-ops/memory" in source
    assert "/api/v1/pages/interaction-ops/export" in source
