"""Read-only, scoped projections of recorded SQL delivery activity."""

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import and_, or_

from .delivery_activity_contract import ActivityDetail, ActivityItem, ActivityPage, FieldChange
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_execution_runtime_safety import safe_text
from .delivery_service import records, stamp
from .delivery_task_contract import requirement_definition
from .sql_models import DeliveryActivityLink, DeliveryEvent, Issue, Requirement, Task


def _ref(kind, id):
    return {"kind": kind, "id": id} if id else None


class _RecordedTargets:
    """Resolve a command's actual references once, before later moves or deletions."""

    def __init__(self, db, project, state):
        self.db, self.project, self.state = db, project, state
        self.refs, self.requirements = [], set()

    def add(self, kind, id):
        value = _ref(kind, id)
        if value and value not in self.refs:
            self.refs.append(value)
        if kind == "requirement" and id:
            self.requirements.add(id)
        if kind == "task" and id:
            task = records(self.db, Task, self.project).filter_by(id=id).first()
            if task and task.req_id:
                self.requirements.add(task.req_id)

    def execution(self, rid):
        self.add("execution", rid)
        entry = next((row for row in self.state.get("executions", []) if row["id"] == rid), None)
        if entry:
            self.add("task", entry["task_id"])
            req = (entry.get("snapshot") or {}).get("requirement") or {}
            if req.get("id"):
                self.requirements.add(req["id"])
            self.add("issue", entry.get("issue_id"))

    def primary(self, action, rid, payload):
        if action.startswith("requirement.") or action in {
            "artifact.add",
            "stage.advance",
            "stage.reopen",
            "issue.promote",
            "issue.diagnosis.adopt",
            "apply-review",
            "apply-prototype",
        }:
            self.add("requirement", rid)
        elif action.startswith("execution."):
            self.execution(rid)
        elif action == "task.manual_review":
            self.add("task", payload.get("task_id"))
        elif action.startswith("task.") or action == "tasks.plan":
            self.add("task", rid)
        elif action.startswith("release.candidate."):
            self.add("release_candidate", rid)
        elif action.startswith("deployment.") and action != "deployment.environment.save":
            self.add("deployment", rid)
        elif action.startswith("project."):
            self.add("project", self.project.id)

    def additional(self, action, payload, result):
        self.add("requirement", payload.get("requirement_id"))
        self.add("issue", payload.get("issue_id"))
        for id in payload.get("requirement_ids", []):
            self.add("requirement", id)
        for id in payload.get("task_ids", []):
            self.add("task", id)
        for tid in result.get("task_ids", []) if isinstance(result, dict) else []:
            self.add("task", tid)
        if action == "tasks.schedule":
            for change in payload.get("changes", []):
                self.add("task", change.get("task_id"))
        if action == "batch.apply":
            for id in result.get("ids", []):
                self.add("requirement", id)

    def release(self, id):
        candidate = next((row for row in self.state.get("release_candidates", []) if row["id"] == id), None)
        if candidate:
            for req_id in candidate["snapshot"]["selected"]["requirement_ids"]:
                self.add("requirement", req_id)
            for task_id in candidate["snapshot"]["selected"]["task_ids"]:
                self.add("task", task_id)

    def deployment(self, id):
        deployment = next((row for row in self.state.get("deployments", []) if row["id"] == id), None)
        if deployment:
            snapshot = deployment["snapshot"]["candidate_snapshot"]
            for req_id in snapshot["selected"]["requirement_ids"]:
                self.add("requirement", req_id)
            self.add("release_candidate", deployment["candidate_id"])
            self.add("issue", deployment.get("issue_id"))

    def expand(self):
        for value in list(self.refs):
            if value["kind"] == "release_candidate":
                self.release(value["id"])
            elif value["kind"] == "deployment":
                self.deployment(value["id"])


def record_activity(db, project, user, state, event):
    """Freeze associations while command results still refer to their actual scope."""
    payload = event.data.get("input", {})
    targets = _RecordedTargets(db, project, state)
    targets.primary(event.action, event.resource_id, payload)
    targets.additional(event.action, payload, event.data.get("result", {}))
    targets.expand()
    before = requirement_definition(event.data.get("before") or {})
    changes = [
        {"field": field, "before": before[field], "after": payload[field]}
        for field in ("title", "description", "acceptance_criteria")
        if event.action == "requirement.update"
        and field in payload
        and payload[field] is not None
        and payload[field] != before[field]
    ]
    event.data = {
        **event.data,
        "activity": {
            "actor": {"id": user.id, "name": user.username},
            "refs": targets.refs,
            "requirement_ids": sorted(targets.requirements),
            "changes": changes,
        },
    }
    transaction = db.get_nested_transaction() or db.get_transaction()
    db.info.setdefault("delivery_collaboration_actor", {}).setdefault(transaction, {})[
        (project.tenant_id, project.id)
    ] = {
        "id": user.id,
        "name": user.username,
    }
    # ORM mappings have no relationship between these additive support rows.
    # Persist the actual parent explicitly before any enforced-FK child insert.
    db.add(event)
    db.flush()
    for req_id in sorted(targets.requirements):
        db.add(
            DeliveryActivityLink(
                event_id=event.id, requirement_id=req_id, tenant_id=project.tenant_id, project_id=project.id
            )
        )


def target_view(db, project, state, user, ref, store=None):
    """Only same-project objects readable now can become navigation targets."""
    kind, id = ref.get("kind"), ref.get("id")
    if kind not in {
        "project",
        "requirement",
        "task",
        "execution",
        "issue",
        "release_candidate",
        "deployment",
    } or not isinstance(id, str):
        return None
    label, exists, restricted = None, False, False
    if kind == "project":
        exists, label = id == project.id, project.name if id == project.id else None
    elif kind in {"requirement", "task", "issue"}:
        model = {"requirement": Requirement, "task": Task, "issue": Issue}[kind]
        row = records(db, model, project).filter_by(id=id).first()
        exists, label = row is not None, row.title if row else None
    else:
        collection = {
            "execution": "executions",
            "release_candidate": "release_candidates",
            "deployment": "deployments",
        }[kind]
        row = next((value for value in state.get(collection, []) if value["id"] == id), None)
        exists = row is not None
        if row:
            if kind == "release_candidate":
                label = row["snapshot"]["version"]
            else:
                try:
                    if kind == "execution":
                        from .delivery_issue_evidence import _access

                        _access(store, user, project, row["workspace_id"])
                        label = row.get("task_id") or id
                    else:
                        from .delivery_deployment import _context

                        _context(store, user, project, row["snapshot"]["definition"]["workspace_id"])
                        label = row["snapshot"]["candidate_snapshot"]["version"]
                except HTTPException:
                    restricted = True
    if restricted:
        return {"kind": kind, "id": None, "label": None, "available": False, "reason": "target_restricted"}
    return {
        "kind": kind,
        "id": id,
        "label": safe_text(label, 256)[0] if label else None,
        "available": exists,
        "reason": None if exists else "target_missing",
    }


def _recorded_changes(values):
    """A malformed historical change never turns into a fabricated cleared field."""
    changes = []
    for value in values if isinstance(values, list) else []:
        try:
            changes.append(FieldChange.model_validate(value).model_dump(mode="json"))
        except ValidationError:
            continue
    return changes


def event_view(db, project, state, user, event, store=None):
    metadata = event.data.get("activity")
    recorded = isinstance(metadata, dict)
    metadata = metadata if recorded else {}
    actor = metadata.get("actor", {})
    refs = [target_view(db, project, state, user, ref, store) for ref in metadata.get("refs", [])]
    refs = [ref for ref in refs if ref]
    changes = _recorded_changes(metadata.get("changes", []))
    return ActivityItem.model_validate(
        {
            "id": event.id,
            "at": event.created_at.isoformat() + "Z",
            "action": safe_text(event.action, 64)[0],
            "actor": {
                "id": actor.get("id") if recorded else None,
                "name": safe_text(actor.get("name", event.actor), 128)[0],
            },
            "association": "recorded" if recorded else "unknown",
            "requirement_ids": metadata.get("requirement_ids", []),
            "target": refs[0] if refs else None,
            "related_targets": refs[1:],
            "changes": changes,
        }
    ).model_dump(mode="json")


def list_activity(
    db, project, state, user, *, scope="project", scope_id="", action="", cursor="", limit=20, store=None
):
    if (
        scope not in {"project", "requirement"}
        or scope == "requirement"
        and not scope_id
        or scope == "project"
        and scope_id
    ):
        raise HTTPException(
            422, {"code": "activity_scope_invalid", "message": "Choose project scope or an exact requirement"}
        )
    filters = [project.tenant_id, project.id, "activity", scope, scope_id, action]
    query = records(db, DeliveryEvent, project)
    if scope == "requirement":
        query = query.join(DeliveryActivityLink, DeliveryActivityLink.event_id == DeliveryEvent.id).filter(
            DeliveryActivityLink.tenant_id == project.tenant_id,
            DeliveryActivityLink.project_id == project.id,
            DeliveryActivityLink.requirement_id == scope_id,
        )
    if action:
        query = query.filter(DeliveryEvent.action == action)
    if cursor:
        upper, after = decode_cursor(cursor, filters)
        if (
            len(upper) != 2
            or len(after) != 2
            or type(upper[0]) is not int
            or type(after[0]) is not int
            or not isinstance(upper[1], str)
            or not isinstance(after[1], str)
        ):
            raise HTTPException(422, "Invalid activity cursor")
    else:
        latest = query.order_by(DeliveryEvent.version.desc(), DeliveryEvent.id.desc()).first()
        upper = [latest.version, latest.id] if latest else [0, ""]
        after = None
    query = query.filter(
        or_(
            DeliveryEvent.version < upper[0],
            and_(DeliveryEvent.version == upper[0], DeliveryEvent.id <= upper[1]),
        )
    )
    if after:
        query = query.filter(
            or_(
                DeliveryEvent.version < after[0],
                and_(DeliveryEvent.version == after[0], DeliveryEvent.id < after[1]),
            )
        )
    rows = query.order_by(DeliveryEvent.version.desc(), DeliveryEvent.id.desc()).limit(limit + 1).all()
    next_cursor = (
        encode_cursor(filters, upper, [rows[limit - 1].version, rows[limit - 1].id])
        if len(rows) > limit
        else None
    )
    return ActivityPage.model_validate(
        {
            "project_id": project.id,
            "as_of": stamp(),
            "scope": scope,
            "scope_id": scope_id,
            "items": [event_view(db, project, state, user, row, store) for row in rows[:limit]],
            "next_cursor": next_cursor,
        }
    ).model_dump(mode="json")


def activity_detail(db, project, state, user, id, store=None):
    row = records(db, DeliveryEvent, project).filter_by(id=id).first()
    if not row:
        raise HTTPException(
            404, {"code": "activity_missing", "message": "Activity was not recorded in this project"}
        )
    return ActivityDetail.model_validate(
        {"project_id": project.id, "item": event_view(db, project, state, user, row, store)}
    ).model_dump(mode="json")


def legacy_activity(event):
    """Keep only the two explicitly consumed legacy inputs; raw history stays private."""
    original = event.data.get("input", {})
    values = {}
    if event.action == "baseline.create":
        values = {
            key: original[key]
            for key in ("basis", "title")
            if key in original and isinstance(original[key], str)
        }
    elif event.action == "project.update" and "vector_db_config" in original:
        values = {"vector_db_config": {"changed": True}}
    return {
        "id": event.id,
        "actor": event.actor,
        "action": event.action,
        "resource_id": event.resource_id,
        "created_at": event.created_at.isoformat() + "Z",
        "data": {"input": values},
    }
