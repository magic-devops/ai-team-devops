"""Canonical external origins before filtering/count/paging; runtime deferred."""
from copy import deepcopy

from sqlalchemy import select, update

from sop_manager.routers import sql_models as models
from test_delivery_task_submissions import decide, report, submit, counts
from test_delivery_manual_review import make_task
from test_delivery_workbench import env as delivery_env

env = delivery_env


def test_report_and_review_issues_are_external_even_with_preexisting_query_facts(env):
    client, sessions, _actor = env
    first = make_task(client)
    payload = report(client, first["id"])
    payload["tests"] = [{**payload["tests"][0], "status": "failed"}]
    ack, _body = submit(client, first["id"], key="failed-reported-check", payload=payload)
    first_issue = ack["result"]["issue_id"]
    second = make_task(client)
    other, _ = submit(client, second["id"], key="reported-review-check")
    rejected, _ = decide(client, second["id"], other["result"]["submission_id"], decision="request_changes")
    assert rejected.status_code == 200, rejected.text
    second_issue = rejected.json()["result"]["issue_id"]
    assert first_issue and second_issue and first_issue != second_issue
    # An existing installation's source_kinds cache predates this label.
    with sessions() as db:
        for row in db.scalars(select(models.DeliveryQueryFact).where(models.DeliveryQueryFact.kind == "issue")):
            value = {**deepcopy(row.data), "source_kinds": []}
            db.connection().execute(update(models.DeliveryQueryFact).where(
                models.DeliveryQueryFact.tenant_id == row.tenant_id, models.DeliveryQueryFact.project_id == row.project_id,
                models.DeliveryQueryFact.kind == row.kind, models.DeliveryQueryFact.entity_id == row.entity_id).values(data=value))
        db.commit()
    before = counts(sessions)
    page = client.get("/api/v1/delivery/issues", params={"source": "external", "limit": 1})
    assert page.status_code == 200, page.text
    view = page.json(); assert view["total"] == 2 and len(view["items"]) == 1 and view["next_cursor"]
    next_page = client.get("/api/v1/delivery/issues", params={"source": "external", "limit": 1, "cursor": view["next_cursor"]}).json()
    assert {view["items"][0]["id"], next_page["items"][0]["id"]} == {first_issue, second_issue}
    assert all("external" in item["source_kinds"] for item in [*view["items"], *next_page["items"]])
    assert client.get("/api/v1/delivery/issues", params={"source": "other"}).json()["total"] == 0
    unrelated = client.get("/api/v1/delivery/issues", params={"source": "external"}, headers={"X-Project-Id": "other"})
    assert unrelated.status_code == 409 or unrelated.status_code == 200 and unrelated.json()["total"] == 0
    assert counts(sessions) == before
