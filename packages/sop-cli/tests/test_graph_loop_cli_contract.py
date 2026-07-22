from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_graph_loop_cli_exposes_v3_commands():
    source = (ROOT / "packages/sop-cli/sop_cli/commands/graph_loop.py").read_text(encoding="utf-8")
    for command in ("detail", "events", "transition", "interrupt", "replay", "export", "doctor", "slo"):
        assert f'@app.command("{command}")' in source
    assert "graph_loop_transition" in source
    assert "graph_loop_interrupt_decision" in source
    assert "graph_loop_replay" in source
    assert "graph_loop_export" in source
    assert "--json" in source


def test_graph_loop_sdk_exposes_v3_methods():
    source = (ROOT / "packages/sop-sdk-python/sop_sdk/client.py").read_text(encoding="utf-8")
    for method in (
        "graph_loop_detail",
        "graph_loop_events",
        "graph_loop_transition",
        "graph_loop_interrupt_decision",
        "graph_loop_replay",
        "graph_loop_export",
        "graph_loop_slo",
    ):
        assert f"def {method}" in source
