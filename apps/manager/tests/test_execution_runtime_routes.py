"""Public runtime evidence must remain scoped, pure and explicitly selected."""

from test_delivery_execution import bridge, queue, sync  # noqa: F401
from test_delivery_external_execution import all_counts
from test_delivery_workbench import env  # noqa: F401


def test_runtime_and_exact_output_gets_do_not_write_business_or_runtime(bridge):  # noqa: F811
    client = bridge[0]
    entry = sync(bridge, queue(bridge))
    before = all_counts(bridge)
    runtime = client.get(f"/api/v1/delivery/executions/{entry['id']}/runtime")
    assert runtime.status_code == 200, runtime.text
    data = runtime.json()
    assert data["execution_id"] == entry["id"] and data["run_id"] == entry["run_id"]
    assert data["controls"]["start"]["allowed"]
    output = client.get(
        f"/api/v1/delivery/executions/{entry['id']}/nodes/tests/output",
        params={"attempt": 1, "stream": "stdout"},
    )
    assert output.status_code == 200, output.text
    assert output.json()["chunks"] == [] and not output.json()["complete"]
    assert all_counts(bridge) == before


def test_runtime_does_not_fall_back_for_unknown_execution_node_or_attempt(bridge):  # noqa: F811
    client = bridge[0]
    entry = sync(bridge, queue(bridge))
    assert client.get("/api/v1/delivery/executions/absent/runtime").status_code == 404
    base = f"/api/v1/delivery/executions/{entry['id']}/nodes"
    for node, attempt in [("absent", 1), ("tests", 999)]:
        response = client.get(f"{base}/{node}/output", params={"attempt": attempt, "stream": "stdout"})
        assert response.status_code == 404, response.text
    assert client.get(f"{base}/tests/output", params={"stream": "stdout"}).status_code == 422


def test_control_preview_captures_explicit_run_reason_and_business_version(bridge):  # noqa: F811
    client = bridge[0]
    entry = sync(bridge, queue(bridge))
    current = client.get("/api/v1/delivery/workspace").json()
    response = client.post(
        "/api/v1/delivery/execution-control-preview",
        json={
            "id": entry["id"],
            "action": "execution.cancel",
            "reason": "Stop the planned run after human review",
        },
    )
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["version"] == current["version"] and value["allowed"]
    assert value["payload"]["run_id"] == entry["run_id"]
    assert value["payload"]["attempt"] == 1 and len(value["payload"]["control_basis"]) == 64
    assert value["payload"]["reason"] == "Stop the planned run after human review"
