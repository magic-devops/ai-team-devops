"""Bring a fixed operational suggestion into the canonical Issue transaction."""
import json
import math
import re
from copy import deepcopy

from fastapi import HTTPException
from hermes_core.transactional import digest

from sop_manager.path_config import resolved_project_id, resolved_tenant_id

from .delivery_service import records, stamp
from .ops_remediation_contract import OpsIntakeView
from .scope_guard import scope_matches
from .sql_models import Issue, OpsIssueSource

MAX_SOURCE_BYTES = 64 * 1024


def _fail(status, code, message):
    raise HTTPException(status, {"code": code, "message": message})


def _read_source(project, source_id):
    from .delivery_issue_evidence import _clean
    from .ops_center import _dir

    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", source_id):
        _fail(422, "ops_source_invalid", "Invalid operational source identity")
    if resolved_project_id() != project.id or resolved_tenant_id() != project.tenant_id:
        _fail(404, "ops_source_missing", "Source is not in the authorized project scope")
    path = _dir("self_heal_actions") / f"{source_id}.json"
    try:
        # A bounded open, not an unbounded read followed by a length check.
        with path.open("rb") as stream:
            raw = stream.read(MAX_SOURCE_BYTES + 1)
    except OSError as exc:
        raise HTTPException(404, {"code": "ops_source_missing", "message": "Operational source is unavailable"}) from exc
    if len(raw) > MAX_SOURCE_BYTES:
        _fail(422, "ops_source_budget", "Complete operational source exceeds 64 KiB")
    try:
        def no_constant(_value):
            raise ValueError("Non-finite JSON value")
        def finite_float(value):
            number = float(value)
            if not math.isfinite(number):
                raise ValueError("Non-finite JSON number")
            return number
        def unique_pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise ValueError("Duplicate JSON field")
                result[key] = value
            return result
        source = json.loads(raw.decode("utf-8"), parse_constant=no_constant, parse_float=finite_float, object_pairs_hook=unique_pairs)
        # Validate original strings and keys before redaction can replace invalid
        # Unicode or hide an invalid value under a sensitive field.
        json.dumps(source, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise HTTPException(422, {"code": "ops_source_invalid", "message": "Operational source is not valid JSON"}) from exc
    if not isinstance(source, dict) or source.get("id") != source_id or not scope_matches(source):
        _fail(404, "ops_source_missing", "Operational source is not in this project")

    def clean(value, depth=0):
        if depth > 32:
            _fail(422, "ops_source_budget", "Operational source nesting exceeds its read budget")
        if isinstance(value, str):
            return _clean(value, MAX_SOURCE_BYTES)[0]
        if isinstance(value, list):
            return [clean(item, depth + 1) for item in value]
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                safe_key = _clean(key, MAX_SOURCE_BYTES)[0]
                if safe_key in result:
                    _fail(422, "ops_source_invalid", "Sanitized source keys collide")
                sensitive = _clean(f"{key}=source-probe", MAX_SOURCE_BYTES)[1]
                result[safe_key] = "[REDACTED]" if sensitive else clean(item, depth + 1)
            return result
        return value

    snapshot = clean(source)
    try:
        encoded = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(422, {"code": "ops_source_invalid", "message": "Operational source is not valid UTF-8 JSON"}) from exc
    if len(encoded) > MAX_SOURCE_BYTES:
        _fail(422, "ops_source_budget", "Complete sanitized source exceeds its read budget")
    return snapshot, digest(snapshot)


def _saved(row):
    try:
        json.dumps(row.snapshot, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise HTTPException(409, {"code": "ops_source_record_invalid", "message": "Fixed source is not valid UTF-8 JSON"}) from exc
    if not isinstance(row.snapshot, dict) or digest(row.snapshot) != row.source_digest:
        _fail(409, "ops_source_record_invalid", "Fixed intake source cannot be verified")
    return {"source_id": row.source_id, "source_digest": row.source_digest, "snapshot": deepcopy(row.snapshot),
        "tenant_id": row.tenant_id, "project_id": row.project_id, "issue_id": row.issue_id,
        "created_by": row.created_by, "created_at": row.created_at.isoformat()}


def _existing(db, project, data, source_id):
    row = records(db, OpsIssueSource, project).filter(OpsIssueSource.source_id == source_id).first()
    if row is None:
        return None, None
    saved = _saved(row)
    issue = records(db, Issue, project).filter(Issue.id == saved["issue_id"]).first()
    return saved, issue


def intake_view(db, project, data, source_id, *, version, can_write):
    saved, issue = _existing(db, project, data, source_id)
    snapshot, source_digest = (saved["snapshot"], saved["source_digest"]) if saved else _read_source(project, source_id)
    return OpsIntakeView.model_validate({
        "project_id": project.id, "version": version, "as_of": stamp(), "source_id": source_id,
        "source_digest": source_digest, "source_kind": "reported_only", "snapshot": snapshot,
        "existing_issue_id": saved["issue_id"] if saved else None, "existing_issue_available": issue is not None,
        "can_intake": can_write and project.status == "active" and saved is None,
    }).model_dump(mode="json")


def apply_intake(db, project, user, data, body):
    saved, issue = _existing(db, project, data, body.source_id)
    if saved:
        if saved["source_digest"] != body.source_digest:
            _fail(409, "ops_source_changed", "Use the fixed source already linked to this Issue")
        if issue is None:
            _fail(409, "ops_issue_missing", "The original Issue is unavailable; it was not recreated")
        return issue.id, None, {"issue_id": issue.id, "source_id": body.source_id, "source_digest": saved["source_digest"]}
    if project.status != "active":
        _fail(409, "ops_project_inactive", "Activate the project before creating remediation work")
    snapshot, source_digest = _read_source(project, body.source_id)
    if source_digest != body.source_digest:
        _fail(409, "ops_source_changed", "Operational source changed; explicitly read and adopt it again")
    iid = "ISSUE-" + digest(["ops-intake", project.tenant_id, project.id, body.source_id])[:32]
    if db.get(Issue, iid) is not None:
        _fail(409, "ops_issue_conflict", "An Issue already occupies this intake identity")
    issue = Issue(id=iid, tenant_id=project.tenant_id, project_id=project.id, status="open", type="incident",
                  title=body.title, description=body.description, severity=body.severity, reported_by=user.username)
    db.add(issue)
    from sop_manager.project_write_guard import ops_intake_write_scope

    with ops_intake_write_scope(db, project.tenant_id, project.id, body.source_id):
        db.add(OpsIssueSource(id=digest(["ops-source", project.tenant_id, project.id, body.source_id]),
            source_id=body.source_id, source_digest=source_digest, snapshot=deepcopy(snapshot),
            tenant_id=project.tenant_id, project_id=project.id, issue_id=iid, created_by=user.id))
        db.flush()
    return iid, None, {"issue_id": iid, "source_id": body.source_id, "source_digest": source_digest}


def add_issue_sources(evidence, db, project, data, issue):
    """Immutable sanitized suggestions are selectable; their success claims stay reported-only."""
    selected = []
    rows = records(db, OpsIssueSource, project).filter(OpsIssueSource.issue_id == issue.id).order_by(OpsIssueSource.source_id).limit(33).all()
    for row in rows:
        source_id = row.source_id
        saved = _saved(row)
        evidence.add("ops:" + source_id, "ops", saved["snapshot"].get("trigger_condition") or source_id,
            {"project_id": project.id, "view": "issues", "detail": "details", "issue_id": issue.id},
            status="reported_only", summary="ops_suggestion_not_execution_proof",
            facts={"source_id": source_id, "source_digest": saved["source_digest"], "created_by": saved["created_by"],
                   "recorded_state": saved["snapshot"].get("state", "unknown")},
            excerpt=json.dumps(saved["snapshot"], ensure_ascii=False, sort_keys=True), raw=saved)
        selected.append(saved)
    return selected
