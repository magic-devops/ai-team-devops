from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_pages_cli_exposes_interaction_analysis_command():
    source = (ROOT / "packages/sop-cli/sop_cli/commands/pages.py").read_text(encoding="utf-8")

    assert '@app.command("interaction-analysis")' in source
    assert "pages_interaction_analysis" in source
    for option in ("--domain", "--status", "--q", "--limit", "--json"):
        assert option in source


def test_pages_sdk_exposes_interaction_analysis_method():
    source = (ROOT / "packages/sop-sdk-python/sop_sdk/client.py").read_text(encoding="utf-8")

    assert "def pages_interaction_analysis" in source
    assert "/api/v1/pages/interaction-analysis" in source
