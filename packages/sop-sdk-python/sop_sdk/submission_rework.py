"""A complete adopted source stays separate from this attempt's authored results.

The Manager verifies historical originals and permissions. Local checks preserve
the adopted snapshot and reject silent rebasing; they do not attest tests ran.
"""
from copy import deepcopy

from .delivery_ack import canonical, digest, strict_json, _digest, _exact, _integer, _submission_payload
from .work_order_original import _feedback_reference, _identity, _member_identity, _text

ADOPTION_SCHEMA = "manager.submission-rework-adoption.v1"
MAX_REWORK_BYTES = 256 * 1024
MAX_ADOPTION_BYTES = 512 * 1024
AUTHORED_FIELDS = {"source", "summary", "artifacts", "criteria", "tests"}


class SubmissionReworkChanged(ValueError):
    """Select and adopt the complete source again before preparing a new report."""


def reference_body(reference):
    value = strict_json(canonical(reference))
    if value is None: raise ValueError("Select an exact returned submission and decision")
    _feedback_reference(value)
    return {"rework_reference": value}


def criteria_basis(rows, *, empty=False):
    if not isinstance(rows, list) or not (0 if empty else 1) <= len(rows) <= 160:
        raise ValueError("Retain every complete current acceptance condition")
    result = {}
    for item in rows:
        if not isinstance(item, dict) or item.get("source") not in {"task", "requirement"}:
            raise ValueError("Identify every current acceptance condition")
        _integer(item.get("index")); _digest(item.get("text_digest"))
        key = (item["source"], item["index"])
        if key in result: raise ValueError("Acceptance conditions must be unique")
        result[key] = item["text_digest"]
    return result


def _reasons(value):
    if not isinstance(value, list): raise ValueError("Retain the complete admission reasons")
    for item in value:
        _exact(item, {"code", "message"})
        if any(not isinstance(item[k], str) for k in item): raise ValueError("Invalid admission reason")


def _definition(value, task_id):
    _exact(value, {"task_id", "title", "description", "assigned_to", "task_acceptance_criteria", "acceptance_criteria",
        "owner", "dependency_basis", "requirement", "designs", "design_basis"})
    if value["task_id"] != task_id: raise ValueError("Retain the exact task definition")
    _digest(value["design_basis"])
    if (any(not isinstance(value[k], str) for k in ("title", "description", "assigned_to"))
            or any(not isinstance(value[k], list) or any(not isinstance(x, str) for x in value[k])
                for k in ("task_acceptance_criteria", "acceptance_criteria"))
            or not isinstance(value["dependency_basis"], dict) or not isinstance(value["designs"], list)
            or value["owner"] is not None and not isinstance(value["owner"], dict)
            or value["requirement"] is not None and not isinstance(value["requirement"], dict)):
        raise ValueError("Retain the complete current definition")


def _work_order(value):
    if value is None: return
    _exact(value, {"id", "order_revision", "executor"})
    _identity(value["id"]); _integer(value["order_revision"], 1)
    executor = value["executor"]
    _exact(executor, {"id", "name", "kind", "tool", "active", "available", "reasons"})
    _member_identity(executor["id"])
    if (executor["kind"] not in {"agent", "tool"} or any(not isinstance(executor[k], str) for k in ("name", "tool"))
            or any(type(executor[k]) is not bool for k in ("active", "available"))):
        raise ValueError("Retain the exact current work-order executor")
    _reasons(executor["reasons"])


def _feedback(context, *, project_id, task_id, reference, expected):
    canonical(context, 64 * 1024)
    _exact(context, {"schema", "project_id", "task_id", "reference", "submission", "decision"})
    if (context["schema"] != "manager.delivery-feedback.v1" or context["project_id"] != project_id
            or context["task_id"] != task_id or context["reference"] != reference or digest(context) != expected):
        raise ValueError("Retain the complete selected feedback and its exact digest")
    _exact(context["submission"], {"definition", "payload"})
    _definition(context["submission"]["definition"], task_id)
    payload = context["submission"]["payload"]
    _submission_payload("task.delivery.submit", payload)
    if payload["task_id"] != task_id: raise ValueError("Selected feedback belongs to another task")
    decision = context["decision"]
    _exact(decision, {"decision", "review_id", "comment", "reviewer", "created_at", "issue_id"})
    if decision["decision"] != "request_changes": raise ValueError("Select a human request-changes decision")
    _identity(decision["review_id"]); _text(decision["comment"], 4000); _text(decision["created_at"], 200)
    if decision["issue_id"] is not None: _identity(decision["issue_id"])
    _exact(decision["reviewer"], {"id", "name"}); _identity(decision["reviewer"]["id"])
    if not isinstance(decision["reviewer"]["name"], str): raise ValueError("Identify the original reviewer")
    return payload


def validate_preview(value, *, project_id, task_id, reference):
    value = strict_json(canonical(value, MAX_REWORK_BYTES), MAX_REWORK_BYTES)
    _exact(value, {"project_id", "task_id", "version", "query_generation", "as_of", "rework_reference", "rework_basis",
        "current", "feedback_context", "feedback_context_sha256", "draft", "allowed", "reasons"})
    if value["project_id"] != project_id or value["task_id"] != task_id:
        raise ValueError("Rework preview belongs to another project or task")
    if value["rework_reference"] != reference_body(reference)["rework_reference"]:
        raise ValueError("Rework preview replaced the selected report or decision")
    _integer(value["version"])
    if value["query_generation"] is not None: _integer(value["query_generation"], 1)
    if not isinstance(value["as_of"], str) or type(value["allowed"]) is not bool or not isinstance(value["reasons"], list):
        raise ValueError("Incomplete rework preview admission facts")
    _digest(value["rework_basis"]); _digest(value["feedback_context_sha256"])
    _identity(project_id); _identity(task_id)
    c, context, draft = value["current"], value["feedback_context"], value["draft"]
    _exact(c, {"project_id", "task_id", "version", "query_generation", "as_of", "task_basis", "definition_digest",
        "native_boundary_digest", "definition", "criteria", "can_submit", "reasons", "latest_submission_id", "work_order"})
    if (c.get("project_id") != project_id or c.get("task_id") != task_id
            or c.get("version") != value["version"] or type(c.get("version")) is not int
            or c["query_generation"] != value["query_generation"] or c["as_of"] != value["as_of"]
            or type(c.get("can_submit")) is not bool or value["allowed"] != c["can_submit"]):
        raise ValueError("Rework preview lacks the complete current submission facts")
    if c["query_generation"] is not None: _integer(c["query_generation"], 1)
    for field in ("task_basis", "definition_digest", "native_boundary_digest"): _digest(c.get(field))
    _definition(c["definition"], task_id); _reasons(c["reasons"]); _reasons(value["reasons"]); _work_order(c["work_order"])
    if c["latest_submission_id"] is not None: _identity(c["latest_submission_id"])
    if c["reasons"] != value["reasons"]: raise ValueError("Preview admission reasons differ from current facts")
    basis = criteria_basis(c["criteria"], empty=not value["allowed"])
    for item in c["criteria"]:
        _exact(item, {"source", "index", "text", "text_digest"})
        if not isinstance(item["text"], str): raise ValueError("Retain the current condition text")
    previous = _feedback(context, project_id=project_id, task_id=task_id, reference=reference, expected=value["feedback_context_sha256"])
    _exact(draft, AUTHORED_FIELDS)
    if draft["source"] is not None or criteria_basis(draft["criteria"], empty=not value["allowed"]) != basis:
        raise ValueError("Rework must reset the author and match current acceptance conditions")
    for item in draft["criteria"]:
        _exact(item, {"source", "index", "text_digest", "result", "evidence_ids"})
        if item["result"] != "unknown" or item["evidence_ids"] != []:
            raise ValueError("Rework must reset historical acceptance results and references")
    expected_criteria = [{"source": k[0], "index": k[1], "text_digest": v, "result": "unknown", "evidence_ids": []}
        for k, v in sorted(basis.items())]
    expected_tests = [{"id": item["id"], "title": item["title"], "status": "not_run", "evidence_ids": []} for item in previous["tests"]]
    if (draft["summary"] != previous["summary"] or draft["artifacts"] != previous["artifacts"]
            or draft["criteria"] != expected_criteria or draft["tests"] != expected_tests):
        raise ValueError("Retain the exact authorized source materials and reset template")
    return value


def adoption(preview):
    return {"schema": ADOPTION_SCHEMA, "preview": deepcopy(preview), "authored": deepcopy(preview["draft"])}


def validate_adoption(value, *, task_id):
    value = strict_json(canonical(value, MAX_ADOPTION_BYTES), MAX_ADOPTION_BYTES)
    _exact(value, {"schema", "preview", "authored"})
    if value["schema"] != ADOPTION_SCHEMA or not isinstance(value["preview"], dict):
        raise ValueError("Use the complete rework-draft adopted source")
    p = value["preview"]
    p = validate_preview(p, project_id=p.get("project_id"), task_id=task_id, reference=p.get("rework_reference"))
    if not p["allowed"]: raise SubmissionReworkChanged("The adopted source is not currently permitted; use rework-draft again")
    _exact(value["authored"], AUTHORED_FIELDS)
    canonical(value["authored"], 48 * 1024)
    if value["authored"]["source"] is None:
        raise ValueError("Identify this attempt's author explicitly; historical authors are never inherited")
    if criteria_basis(value["authored"]["criteria"]) != criteria_basis(p["current"]["criteria"]):
        raise SubmissionReworkChanged("Acceptance conditions differ from the adopted source; use rework-draft again")
    payload = {**value["authored"], **{key: p["current"][key] for key in ("task_id", "task_basis", "definition_digest", "native_boundary_digest")},
        "rework_reference": p["rework_reference"], "rework_basis": p["rework_basis"]}
    _submission_payload("task.delivery.submit", payload)
    canonical(payload, 48 * 1024)
    return value


def assert_same_source(adopted, current):
    def protected(p):
        result = {key: p[key] for key in ("project_id", "task_id", "rework_reference", "rework_basis", "feedback_context", "feedback_context_sha256", "draft", "allowed", "reasons")}
        result["current"] = {key: p["current"][key] for key in ("task_basis", "definition_digest", "native_boundary_digest", "definition", "criteria", "can_submit", "reasons", "work_order")}
        return result
    if not current["allowed"] or canonical(protected(adopted)) != canonical(protected(current)):
        raise SubmissionReworkChanged("The adopted report, feedback, current definition or handoff changed; use rework-draft and adopt again")
