"""
@module: sop_sdk.client
@purpose: ManagerClient — 与 Manager HTTP 通信的统一客户端
@stable: 方法签名稳定；新增接口直接加方法
@ai_safe_edit:
  - 新接口：复用 _request() 即可自动获得签名/重试/错误映射
  - 改鉴权：仅改 security.py
  - 改重试策略：调 _build_retry()
"""
from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterable, Mapping, Sequence
from datetime import date
from typing import Any
from urllib.parse import quote

import httpx
from tenacity import (
    RetryError,
    Retrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .config import AgentConfig, load_config
from .errors import (
    SopAuthError,
    SopConflictError,
    SopForbiddenError,
    SopNotFoundError,
    SopServerError,
    SopTransportError,
)
from .security import Auth, BearerAuth, HmacAuth, NoAuth, auth_from_env

_log = logging.getLogger("sop_sdk")

_USER_AGENT = "sop-sdk/2.0"
_DEFAULT_HEADERS = {"Accept": "application/json"}


def _resource_segment(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,199}", value):
        raise ValueError(
            "resource ID must contain only ASCII letters, digits, dots, underscores, colons or hyphens"
        )
    return quote(value, safe="")


def _delivery_query_params(*, limit: int, cursor: str, **filters: Any) -> dict[str, Any]:
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("limit must be an integer between 1 and 100")
    if not isinstance(cursor, str) or len(cursor) > 4000 or any(ord(c) < 32 for c in cursor):
        raise ValueError("invalid opaque delivery cursor")
    if not isinstance(filters.get("q", ""), str) or len(filters.get("q", "")) > 200:
        raise ValueError("q must be at most 200 characters")
    return {
        "limit": limit,
        **({"cursor": cursor} if cursor else {}),
        **{key: value for key, value in filters.items() if value != "" and value is not None},
    }


def _progress_scope_params(scope: str, scope_id: str) -> dict[str, str]:
    if scope not in {"project", "milestone", "sprint"}:
        raise ValueError("scope must be project, milestone or sprint")
    if (scope == "project" and scope_id) or (scope != "project" and not scope_id):
        raise ValueError("scope_id is required only for milestone or sprint scope")
    params = {"scope": scope}
    if scope_id:
        if len(scope_id) > 64 or any(ord(char) < 32 for char in scope_id):
            raise ValueError("scope_id must be a valid resource ID of at most 64 characters")
        params["scope_id"] = scope_id
    return params


def _progress_date(value: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("progress dates must use YYYY-MM-DD")
    return date.fromisoformat(value)


_DISCUSSION_SUBJECTS = {"requirement", "task", "issue"}
_SOURCE_ACTIONS = {
    "requirement.update",
    "task.update",
    "tasks.plan",
    "issue.promote",
    "issue.diagnosis.adopt",
}


def _discussion_id(value: str) -> str:
    if not isinstance(value, str) or len(value) > 64:
        raise ValueError("discussion resource IDs must be strings of at most 64 characters")
    return _resource_segment(value)


def _discussion_integer(value: Any, name: str, minimum: int = 1) -> None:
    if type(value) is not int or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")


def _discussion_page(limit: int, cursor: str, **filters: Any) -> dict[str, Any]:
    if type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError("discussion limit must be an integer between 1 and 50")
    return _delivery_query_params(limit=limit, cursor=cursor, **filters)


def _discussion_kind(kind: str, *, runtime: bool = False) -> None:
    allowed = _DISCUSSION_SUBJECTS | ({"execution"} if runtime else set())
    if not isinstance(kind, str) or kind not in allowed:
        raise ValueError("invalid discussion resource kind")


def _discussion_basis(value: Any) -> None:
    if not isinstance(value, str) or re.fullmatch(r"[a-f0-9]{64}", value) is None:
        raise ValueError("content basis must be a lowercase 64-character hexadecimal digest")


def _discussion_selection(kind, resource_id, field, criterion_index, basis=None, *, required_basis=False):
    _discussion_kind(kind, runtime=True)
    _discussion_id(resource_id)
    if field not in ("title", "description", "acceptance_criteria", "summary"):
        raise ValueError("invalid discussion reference field")
    if (kind == "execution") != (field == "summary") or kind == "issue" and field == "acceptance_criteria":
        raise ValueError("reference field does not belong to the selected kind")
    if field == "acceptance_criteria":
        _discussion_integer(criterion_index, "criterion_index", 0)
    elif criterion_index is not None:
        raise ValueError("criterion_index is only used for acceptance_criteria")
    if required_basis or basis is not None:
        _discussion_basis(basis)


def _discussion_fields(body: Mapping[str, Any]) -> None:
    for key in (
        "subject_id",
        "parent_message_id",
        "thread_id",
        "message_id",
        "resolution_event_id",
        "target_id",
    ):
        if key in body and not (key == "parent_message_id" and body[key] is None):
            _discussion_id(body[key])
    for key in ("expected_message_revision", "expected_thread_version", "message_revision"):
        if key in body:
            _discussion_integer(body[key], key)
    for key in ("subject_kind", "target_kind"):
        if key in body:
            _discussion_kind(body[key])
    if "target_content_basis" in body:
        _discussion_basis(body["target_content_basis"])


def _discussion_refs(refs: Any) -> None:
    if not isinstance(refs, list) or len(refs) > 8:
        raise ValueError("refs must be a list with at most 8 selections")
    required = {"kind", "id", "field", "source_content_basis"}
    for ref in refs:
        if not isinstance(ref, Mapping) or not required <= set(ref) <= required | {"criterion_index"}:
            raise ValueError(
                "reference selections require server basis and cannot contain trusted text or identity"
            )
        _discussion_selection(
            ref["kind"],
            ref["id"],
            ref["field"],
            ref.get("criterion_index"),
            ref["source_content_basis"],
            required_basis=True,
        )


def _discussion_body(body: Mapping[str, Any], operation: str) -> dict[str, Any]:
    schemas = {
        "create": ({"subject_kind", "subject_id", "title", "body"}, {"refs"}),
        "reply": ({"body"}, {"parent_message_id", "refs"}),
        "edit": ({"expected_message_revision", "body"}, {"refs"}),
        "withdraw": ({"expected_message_revision"}, {"reason"}),
        "resolve": ({"expected_thread_version", "message_id", "message_revision"}, {"note"}),
        "reopen": ({"expected_thread_version"}, {"reason"}),
        "archive": ({"expected_thread_version"}, {"reason"}),
        "restore": ({"expected_thread_version"}, {"reason"}),
        "link": (
            {
                "expected_thread_version",
                "resolution_event_id",
                "message_id",
                "message_revision",
                "target_kind",
                "target_id",
                "target_content_basis",
            },
            set(),
        ),
    }
    required, optional = schemas[operation]
    required = required | {"idempotency_key"}
    if not isinstance(body, Mapping) or not required <= set(body) <= required | optional:
        raise ValueError(
            f"invalid {operation} fields; original idempotency_key is required and extra fields are forbidden"
        )
    for key, limit in (
        ("idempotency_key", 128),
        ("title", 160),
        ("body", 8000),
        ("reason", 2000),
        ("note", 2000),
    ):
        if key in body:
            value = body[key]
            if not isinstance(value, str) or len(value) > limit or key in required and not value.strip():
                raise ValueError(f"invalid discussion {key}")
    _discussion_fields(body)
    if "refs" in body and not (operation == "edit" and body["refs"] is None):
        _discussion_refs(body["refs"])
    return dict(body)


def _delivery_command_body(body: Mapping[str, Any]) -> dict[str, Any]:
    required = {"action", "payload", "expected_version", "idempotency_key"}
    if not isinstance(body, Mapping) or not required <= set(body) <= required | {"source_reference"}:
        raise ValueError(
            "command requires action/payload/expected_version/idempotency_key and only optional source_reference"
        )
    if not isinstance(body["action"], str) or not isinstance(body["payload"], dict):
        raise ValueError("command action must be a string and payload an object")
    _discussion_integer(body["expected_version"], "expected_version", 0)
    if not isinstance(body["idempotency_key"], str) or not 8 <= len(body["idempotency_key"]) <= 100:
        raise ValueError("command requires the original idempotency_key of 8 to 100 characters")
    source = body.get("source_reference")
    if source is not None:
        keys = {
            "thread_id",
            "expected_thread_version",
            "resolution_event_id",
            "message_id",
            "message_revision",
        }
        if body["action"] not in _SOURCE_ACTIONS or not isinstance(source, Mapping) or set(source) != keys:
            raise ValueError(
                "source_reference requires the exact fixed conclusion and an allowed adoption action"
            )
        _discussion_fields(source)
    return dict(body)


class ManagerClient:
    """同步 HTTP 客户端；如需异步用 AsyncManagerClient（M3+ 提供）。"""

    def project_portfolio(self, *, q: str = "", business_id: str | None = None,
                          status: list[str] | None = None, risk: list[str] | None = None,
                          cursor: str = "", limit: int = 30) -> dict[str, Any]:
        """Inspect authorized projects without changing the client's working scope."""
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("portfolio limit must be between 1 and 100")
        if set(status or []) - {"planning", "active", "paused", "archived"}:
            raise ValueError("invalid project status")
        if set(risk or []) - {"blocked", "awaiting_review", "recorded_completed", "overdue_unverified",
                              "acceptance_unavailable", "owner_unavailable", "open_issues"}:
            raise ValueError("invalid portfolio risk")
        if not isinstance(cursor, str) or len(cursor) > 1024 or any(ord(char) < 32 for char in cursor):
            raise ValueError("invalid opaque portfolio cursor")
        params: dict[str, Any] = {"q": q, "status": status or [], "risk": risk or [], "cursor": cursor, "limit": limit}
        if business_id is not None:
            params["business_id"] = business_id
        return self._request("GET", "/api/v1/projects/portfolio", params=params,
                             extra_headers={"X-Project-Id": "", "X-Project-Code": "", "X-Business-Code": ""})

    def project_portfolio_detail(self, project_id: str) -> dict[str, Any]:
        resource = _resource_segment(project_id)
        return self._request("GET", f"/api/v1/projects/{resource}/portfolio",
                             extra_headers={"X-Project-Id": project_id, "X-Project-Code": project_id, "X-Business-Code": ""})

    def delivery_project_lifecycle_preview(self, body: Mapping[str, Any]) -> dict[str, Any]:
        """Read a fixed lifecycle proposal; submitting still requires an explicit command."""
        return self._request("POST", "/api/v1/delivery/project-lifecycle-preview", json_body=dict(body))

    def delivery_workspace(self) -> dict[str, Any]:
        """Explicit complete export; interactive clients should use bounded queries."""
        return self._request("GET", "/api/v1/delivery/workspace")

    def delivery_context(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/delivery/context")

    def delivery_requirements(
        self,
        *,
        q: str = "",
        stage: str = "",
        priority: str = "",
        owner_id: str = "",
        milestone_id: str = "",
        cursor: str = "",
        limit: int = 20,
        sort: str = "created_desc",
    ) -> dict[str, Any]:
        if sort not in {"created_desc", "id_asc", "id_desc", "title_asc", "priority_asc", "due_asc"}:
            raise ValueError("invalid requirement sort")
        params = _delivery_query_params(
            limit=limit,
            cursor=cursor,
            q=q,
            stage=stage,
            priority=priority,
            owner_id=owner_id,
            milestone_id=milestone_id,
            sort=sort,
        )
        return self._request("GET", "/api/v1/delivery/requirements", params=params)

    def delivery_requirement(self, requirement_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/delivery/requirements/{_resource_segment(requirement_id)}")

    def delivery_tasks(
        self,
        *,
        requirement_id: str = "",
        q: str = "",
        status: str = "",
        priority: str = "",
        owner_id: str = "",
        milestone_id: str = "",
        cursor: str = "",
        limit: int = 20,
        sort: str = "created_desc",
    ) -> dict[str, Any]:
        if sort not in {"created_desc", "id_asc", "id_desc", "title_asc", "priority_asc"}:
            raise ValueError("invalid task sort")
        if status and status not in {
            "pending",
            "in_progress",
            "blocked",
            "awaiting_review",
            "recorded_completed",
            "verified_completed",
        }:
            raise ValueError("invalid effective delivery status")
        params = _delivery_query_params(
            limit=limit,
            cursor=cursor,
            requirement_id=requirement_id,
            q=q,
            status=status,
            priority=priority,
            owner_id=owner_id,
            milestone_id=milestone_id,
            sort=sort,
        )
        return self._request("GET", "/api/v1/delivery/tasks", params=params)

    def delivery_task(self, task_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/delivery/tasks/{_resource_segment(task_id)}")

    def delivery_issues(
        self,
        *,
        requirement_id: str = "",
        task_id: str = "",
        q: str = "",
        status: str = "",
        severity: str = "",
        source: str = "",
        cursor: str = "",
        limit: int = 20,
    ) -> dict[str, Any]:
        if source not in {"", "execution", "deployment", "other"}:
            raise ValueError("invalid issue source")
        params = _delivery_query_params(
            limit=limit,
            cursor=cursor,
            requirement_id=requirement_id,
            task_id=task_id,
            q=q,
            status=status,
            severity=severity,
            source=source,
        )
        return self._request("GET", "/api/v1/delivery/issues", params=params)

    def delivery_execution(self, execution_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/delivery/executions/{_resource_segment(execution_id)}")

    def delivery_references(
        self,
        kind: str,
        *,
        q: str = "",
        ids: Sequence[str] = (),
        requirement_id: str = "",
        task_id: str = "",
        cursor: str = "",
        limit: int = 50,
        member_kind: str = "",
        member_active: bool | None = None,
        archived: bool | None = None,
        sort: str = "id_asc",
        resource_kind: str = "",
    ) -> dict[str, Any]:
        if kind not in {"member", "milestone", "resource", "sprint", "requirement", "task", "execution"}:
            raise ValueError("invalid reference kind")
        if isinstance(ids, str) or len(ids) > 100:
            raise ValueError("ids must contain at most 100 exact references")
        if member_kind not in {"", "human", "agent", "tool"} or sort not in {"id_asc", "ends_asc", "created_desc"}:
            raise ValueError("invalid reference filter or sort")
        if any(value is not None and type(value) is not bool for value in (member_active, archived)):
            raise ValueError("member_active and archived must be booleans")
        for value in ids:
            _resource_segment(value)
        params = _delivery_query_params(
            limit=limit,
            cursor=cursor,
            kind=kind,
            q=q,
            ids=",".join(ids),
            requirement_id=requirement_id,
            task_id=task_id,
            member_kind=member_kind,
            member_active=member_active,
            archived=archived,
            sort=sort,
            resource_kind=resource_kind,
        )
        return self._request("GET", "/api/v1/delivery/references", params=params)

    def delivery_query_rebuild(self) -> dict[str, Any]:
        """Explicit authorized derived-index repair; never used as a hidden GET fallback."""
        return self._request("POST", "/api/v1/delivery/query/rebuild")

    def delivery_execution_runtime(self, execution_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/delivery/executions/{_resource_segment(execution_id)}/runtime")

    def delivery_execution_output(
        self, execution_id: str, node_id: str, *, attempt: int,
        stream: str = "stdout", cursor: str = "", limit: int = 50,
    ) -> dict[str, Any]:
        """Read the exact captured attempt; never choose a current attempt implicitly."""
        if isinstance(attempt, bool) or not isinstance(attempt, int) or attempt < 1:
            raise ValueError("Choose an explicit positive attempt")
        if stream not in {"stdout", "stderr"}:
            raise ValueError("Choose stdout or stderr")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("Output limit must be between 1 and 100")
        if not isinstance(cursor, str) or len(cursor) > 2000:
            raise ValueError("Invalid output cursor")
        return self._request(
            "GET", f"/api/v1/delivery/executions/{_resource_segment(execution_id)}/nodes/{_resource_segment(node_id)}/output",
            params={"attempt": attempt, "stream": stream, "cursor": cursor, "limit": limit},
        )

    def delivery_execution_control_preview(self, body: Mapping[str, Any]) -> dict[str, Any]:
        """Inspect a fixed human intent; actual writes use delivery_command."""
        return self._request("POST", "/api/v1/delivery/execution-control-preview", json_body=dict(body))

    def delivery_issue(self, issue_id: str) -> dict[str, Any]:
        """Read the exact project issue, fixed evidence and diagnosis history."""
        return self._request("GET", f"/api/v1/delivery/issues/{_resource_segment(issue_id)}")

    def delivery_issue_diagnoses(self, issue_id: str, *, cursor: str = "") -> dict[str, Any]:
        return self._request(
            "GET", f"/api/v1/delivery/issues/{_resource_segment(issue_id)}/diagnoses",
            params={"cursor": cursor} if cursor else {},
        )

    def delivery_issue_diagnose(self, issue_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        """Generate or recover the same durable proposal; never change its request identity."""
        return self._request(
            "POST", f"/api/v1/delivery/issues/{_resource_segment(issue_id)}/diagnoses", json_body=dict(body),
        )

    def delivery_issue_diagnosis(self, issue_id: str, diagnosis_id: str) -> dict[str, Any]:
        """Read one exact proposal, including when its original issue is missing."""
        return self._request(
            "GET", f"/api/v1/delivery/issues/{_resource_segment(issue_id)}/diagnoses/{_resource_segment(diagnosis_id)}",
        )

    def delivery_quality(self, *, requirement_ids: Sequence[str] = (), task_ids: Sequence[str] = ()) -> dict[str, Any]:
        """Inspect current quality or an explicitly selected release scope, without writing."""
        if isinstance(requirement_ids, (str, bytes)) or isinstance(task_ids, (str, bytes)):
            raise ValueError("Scope IDs must be explicit sequences, not one string")
        selection = {"requirement_ids": list(requirement_ids), "task_ids": list(task_ids)}
        for ids in selection.values():
            if len(ids) > 200 or any(
                not isinstance(item, str) or not item or item != item.strip() or len(item) > 200 for item in ids
            ) or len(ids) != len(set(ids)):
                raise ValueError("Choose at most 200 distinct nonempty IDs per scope")
        return self._request("GET", "/api/v1/delivery/quality", params=selection)

    def delivery_releases(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/delivery/releases")

    def delivery_release(self, release_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/delivery/releases/{_resource_segment(release_id)}")

    def delivery_release_preview(self, body: Mapping[str, Any]) -> dict[str, Any]:
        """Preview a fixed candidate; this never approves or deploys it."""
        return self._request("POST", "/api/v1/delivery/release-preview", json_body=dict(body))

    def delivery_deployments(self) -> dict[str, Any]:
        """Read controlled environments and actual deployment evidence in this project."""
        return self._request("GET", "/api/v1/delivery/deployments")

    def delivery_deployment(self, deployment_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/delivery/deployments/{_resource_segment(deployment_id)}")

    def delivery_deployment_preview(self, body: Mapping[str, Any]) -> dict[str, Any]:
        """Preview a fixed deploy or rollback; this performs no infrastructure action."""
        return self._request("POST", "/api/v1/delivery/deployment-preview", json_body=dict(body))

    def delivery_inbox(
        self, *, scope: str = "mine", category: str = "all", limit: int = 20, cursor: str = ""
    ) -> dict[str, Any]:
        """Read one bounded page; counts describe the whole selected scope."""
        if scope not in {"mine", "team"}:
            raise ValueError("scope must be mine or team")
        if category not in {"all", "work", "approval", "acceptance", "blocked", "overdue"}:
            raise ValueError("invalid inbox category")
        params = _delivery_query_params(limit=limit, cursor=cursor, scope=scope, category=category)
        return self._request("GET", "/api/v1/delivery/inbox", params=params)

    def delivery_progress_summary(
        self, *, starts_on: str | None = None, ends_on: str | None = None
    ) -> dict[str, Any]:
        """Read bounded current metrics and actual observation coverage without task snapshots."""
        start = _progress_date(starts_on) if starts_on is not None else None
        end = _progress_date(ends_on) if ends_on is not None else None
        if start and end and not 0 <= (end - start).days < 366:
            raise ValueError("progress date range must contain between 1 and 366 days")
        params = {}
        if starts_on is not None:
            params["starts_on"] = starts_on
        if ends_on is not None:
            params["ends_on"] = ends_on
        return self._request("GET", "/api/v1/delivery/progress/summary", params=params)

    def delivery_progress(
        self,
        *,
        starts_on: str | None = None,
        ends_on: str | None = None,
        scope: str = "project",
        scope_id: str = "",
        baseline_id: str = "",
    ) -> dict[str, Any]:
        """Read persisted observations and live scope; missing dates remain null."""
        params = _progress_scope_params(scope, scope_id)
        start = _progress_date(starts_on) if starts_on is not None else None
        end = _progress_date(ends_on) if ends_on is not None else None
        if start and end and not 0 <= (end - start).days < 366:
            raise ValueError("progress date range must contain between 1 and 366 days")
        if starts_on is not None:
            params["starts_on"] = starts_on
        if ends_on is not None:
            params["ends_on"] = ends_on
        if baseline_id:
            _resource_segment(baseline_id)
            params["baseline_id"] = baseline_id
        return self._request("GET", "/api/v1/delivery/progress", params=params)

    def delivery_progress_observation(
        self, observation_id: str, *, scope: str = "project", scope_id: str = ""
    ) -> dict[str, Any]:
        """Read an original historical snapshot without treating it as current work."""
        params = _progress_scope_params(scope, scope_id)
        resource = _resource_segment(observation_id)
        return self._request(
            "GET", f"/api/v1/delivery/progress/observations/{resource}", params=params
        )

    def delivery_baseline(self, baseline_id: str) -> dict[str, Any]:
        """Read an immutable plan and its actual current scope comparison."""
        resource = _resource_segment(baseline_id)
        return self._request("GET", f"/api/v1/delivery/progress/baselines/{resource}")

    def delivery_task_reviews(
        self, task_id: str, *, limit: int = 20, cursor: str = ""
    ) -> dict[str, Any]:
        """Read manual review evidence and current eligibility in the selected project."""
        resource = _resource_segment(task_id)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("review limit must be an integer between 1 and 100")
        params: dict[str, Any] = {"limit": limit}
        if cursor:
            _resource_segment(cursor)
            params["cursor"] = cursor
        return self._request("GET", f"/api/v1/delivery/tasks/{resource}/reviews", params=params)

    def delivery_execution_targets(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/delivery/execution-targets")

    def delivery_team_runtime_bindings(self) -> dict[str, Any]:
        """Read saved team associations and accessible configuration versions; grants no execute rights."""
        return self._request("GET", "/api/v1/delivery/team-runtime-bindings")

    def delivery_execution_preview(self, body: Mapping[str, Any]) -> dict[str, Any]:
        """Validate the caller's pinned target and task without adopting newer versions."""
        return self._request("POST", "/api/v1/delivery/execution-preview", json_body=dict(body))

    def delivery_execution_observations(
        self, execution_id: str, *, limit: int = 30, cursor: str = ""
    ) -> dict[str, Any]:
        """Read bounded existing events; preserve unknown usage and opaque run cursor."""
        resource = _resource_segment(execution_id)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("observation limit must be an integer between 1 and 100")
        if not isinstance(cursor, str) or len(cursor) > 1000 or any(ord(char) < 32 for char in cursor):
            raise ValueError("observation cursor must be a valid opaque cursor of at most 1000 characters")
        params: dict[str, Any] = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        return self._request("GET", f"/api/v1/delivery/executions/{resource}/observations", params=params)

    def delivery_activity(
        self, *, scope: str = "project", scope_id: str = "", cursor: str = "", limit: int = 20, action: str = ""
    ) -> dict[str, Any]:
        """Read a bounded recorded activity page; preserve its scope-bound cursor."""
        if scope not in {"project", "requirement"} or (scope == "requirement") != bool(scope_id):
            raise ValueError("Use project scope without an ID, or requirement scope with an ID")
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError("limit must be an integer between 1 and 100")
        params = {
            "scope": scope, "scope_id": scope_id, "cursor": cursor, "limit": limit,
        }
        if action:
            params["action"] = action
        return self._request("GET", "/api/v1/delivery/activity", params=params)

    def delivery_activity_event(self, event_id: str) -> dict[str, Any]:
        """Resolve one exact event and its currently authorized targets."""
        return self._request("GET", f"/api/v1/delivery/activity/{_resource_segment(event_id)}")

    def delivery_requirement_history(
        self, requirement_id: str, *, cursor: str = "", limit: int = 20
    ) -> dict[str, Any]:
        """Read actual observed definitions; missing earlier history stays unknown."""
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError("limit must be an integer between 1 and 100")
        return self._request("GET", f"/api/v1/delivery/requirements/{_resource_segment(requirement_id)}/history",
                             params={"cursor": cursor, "limit": limit})

    def delivery_requirement_version(self, requirement_id: str, version_id: str) -> dict[str, Any]:
        """Read an exact immutable observed version without adopting or restoring it."""
        return self._request(
            "GET", f"/api/v1/delivery/requirements/{_resource_segment(requirement_id)}/history/{_resource_segment(version_id)}",
        )

    def delivery_requirement_change_preview(
        self, requirement_id: str, body: Mapping[str, Any]
    ) -> dict[str, Any]:
        """Preview exact definition changes; submission separately requires the returned bases."""
        return self._request(
            "POST", f"/api/v1/delivery/requirements/{_resource_segment(requirement_id)}/change-preview", json_body=dict(body),
        )

    def delivery_schedule(
        self, *, starts_on: str | None = None, ends_on: str | None = None
    ) -> dict[str, Any]:
        """Read project calendars and explicit reservations without inferring workload."""
        start = _progress_date(starts_on) if starts_on is not None else None
        end = _progress_date(ends_on) if ends_on is not None else None
        if start and end and not 0 <= (end - start).days < 92:
            raise ValueError("schedule date range must contain between 1 and 92 days")
        params: dict[str, str] = {}
        if starts_on is not None:
            params["starts_on"] = starts_on
        if ends_on is not None:
            params["ends_on"] = ends_on
        return self._request("GET", "/api/v1/delivery/schedule", params=params)

    def delivery_schedule_preview(self, body: Mapping[str, Any]) -> dict[str, Any]:
        """Validate the exact pinned proposal without saving or starting work."""
        return self._request("POST", "/api/v1/delivery/schedule-preview", json_body=dict(body))

    def delivery_task_plan_preview(self, body: Mapping[str, Any]) -> dict[str, Any]:
        """Preview an explicit generator; preserve version and retry identity verbatim."""
        return self._request("POST", "/api/v1/delivery/task-plan-preview", json_body=dict(body))

    def delivery_discussions(
        self,
        *,
        subject_kind: str = "",
        subject_id: str = "",
        state: str = "all",
        limit: int = 20,
        cursor: str = "",
    ) -> dict[str, Any]:
        if state not in ("all", "open", "resolved", "archived"):
            raise ValueError("invalid discussion state")
        if bool(subject_kind) != bool(subject_id):
            raise ValueError("subject_kind and subject_id must be supplied together")
        if subject_kind:
            _discussion_kind(subject_kind)
            _discussion_id(subject_id)
        return self._request(
            "GET",
            "/api/v1/delivery/discussions",
            params=_discussion_page(
                limit, cursor, subject_kind=subject_kind, subject_id=subject_id, state=state
            ),
        )

    def delivery_discussion(self, thread_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}")

    def delivery_discussion_messages(
        self, thread_id: str, *, limit: int = 20, cursor: str = ""
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/messages",
            params=_discussion_page(limit, cursor),
        )

    def delivery_discussion_message(self, thread_id: str, message_id: str) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/messages/{_discussion_id(message_id)}",
        )

    def delivery_discussion_message_versions(
        self, thread_id: str, message_id: str, *, limit: int = 20, cursor: str = ""
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/messages/{_discussion_id(message_id)}/versions",
            params=_discussion_page(limit, cursor),
        )

    def delivery_discussion_message_version(
        self, thread_id: str, message_id: str, revision: int
    ) -> dict[str, Any]:
        _discussion_integer(revision, "revision")
        return self._request(
            "GET",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/messages/{_discussion_id(message_id)}/versions/{revision}",
        )

    def delivery_discussion_reference(
        self,
        kind: str,
        resource_id: str,
        *,
        field: str,
        criterion_index: int | None = None,
        source_content_basis: str | None = None,
    ) -> dict[str, Any]:
        _discussion_selection(kind, resource_id, field, criterion_index, source_content_basis)
        params: dict[str, Any] = {"field": field}
        if criterion_index is not None:
            params["criterion_index"] = criterion_index
        if source_content_basis is not None:
            params["source_content_basis"] = source_content_basis
        return self._request(
            "GET",
            f"/api/v1/delivery/discussion-references/{kind}/{_discussion_id(resource_id)}",
            params=params,
        )

    def delivery_discussion_links(
        self, thread_id: str, *, resolution_event_id: str = "", limit: int = 20, cursor: str = ""
    ) -> dict[str, Any]:
        if resolution_event_id:
            _discussion_id(resolution_event_id)
        return self._request(
            "GET",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/links",
            params=_discussion_page(limit, cursor, resolution_event_id=resolution_event_id),
        )

    def delivery_sources(
        self, target_kind: str, target_id: str, *, limit: int = 20, cursor: str = ""
    ) -> dict[str, Any]:
        _discussion_kind(target_kind)
        _discussion_id(target_id)
        return self._request(
            "GET",
            "/api/v1/delivery/sources",
            params=_discussion_page(limit, cursor, target_kind=target_kind, target_id=target_id),
        )

    def delivery_discussion_create(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST", "/api/v1/delivery/discussions", json_body=_discussion_body(body, "create")
        )

    def delivery_discussion_reply(self, thread_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/messages",
            json_body=_discussion_body(body, "reply"),
        )

    def delivery_discussion_edit(
        self, thread_id: str, message_id: str, body: Mapping[str, Any]
    ) -> dict[str, Any]:
        return self._request(
            "PATCH",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/messages/{_discussion_id(message_id)}",
            json_body=_discussion_body(body, "edit"),
        )

    def delivery_discussion_withdraw(
        self, thread_id: str, message_id: str, body: Mapping[str, Any]
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/messages/{_discussion_id(message_id)}/withdraw",
            json_body=_discussion_body(body, "withdraw"),
        )

    def delivery_discussion_resolve(self, thread_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/resolve",
            json_body=_discussion_body(body, "resolve"),
        )

    def delivery_discussion_reopen(self, thread_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/reopen",
            json_body=_discussion_body(body, "reopen"),
        )

    def delivery_discussion_archive(self, thread_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/archive",
            json_body=_discussion_body(body, "archive"),
        )

    def delivery_discussion_restore(self, thread_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/restore",
            json_body=_discussion_body(body, "restore"),
        )

    def delivery_discussion_link(self, thread_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/delivery/discussions/{_discussion_id(thread_id)}/links",
            json_body=_discussion_body(body, "link"),
        )

    def delivery_command(self, body: Mapping[str, Any]) -> dict[str, Any]:
        """Caller preserves expected_version and idempotency_key across retries."""
        return self._request("POST", "/api/v1/delivery/commands", json_body=_delivery_command_body(body))

    def __init__(
        self,
        base_url: str,
        *,
        auth: Auth | None = None,
        project_id: str = "",
        tenant_code: str = "",
        business_code: str = "",
        project_code: str = "",
        timeout: float = 30,
        max_retries: int = 3,
        verify: bool = True,
        user_agent: str = _USER_AGENT,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.auth: Auth = auth or NoAuth()
        self.project_id = project_id
        self.tenant_code = tenant_code
        self.business_code = business_code
        self.project_code = project_code
        self.timeout = timeout
        self.max_retries = max_retries
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            verify=verify,
            headers={**_DEFAULT_HEADERS, "User-Agent": user_agent},
            follow_redirects=False,
        )

    # ── lifecycle ──────────────────────────────────────────────────
    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> ManagerClient:
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def _scope_headers(self) -> dict[str, str]:
        h: dict[str, str] = {}
        if self.project_id:
            h["X-Project-Id"] = self.project_id
        tc = (self.tenant_code or "").strip()
        if tc:
            h["X-Tenant-Code"] = tc
        bc = (self.business_code or "").strip()
        if bc:
            h["X-Business-Code"] = bc
        pc = (self.project_code or "").strip()
        if pc:
            h["X-Project-Code"] = pc
        return h

    # ── 核心 _request ──────────────────────────────────────────────
    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: Mapping[str, Any] | None = None,
        extra_headers: Mapping[str, str] | None = None,
        retry: bool = True,
    ) -> Any:
        url_path = path if path.startswith("/") else "/" + path
        body_bytes = b""
        if json_body is not None:
            body_bytes = json.dumps(json_body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

        def _do() -> Any:
            headers: dict[str, str] = dict(extra_headers or {})
            for k, v in self._scope_headers().items():
                headers.setdefault(k, v)
            if body_bytes:
                headers["Content-Type"] = "application/json"
            self.auth.attach(method, url_path, headers, body_bytes)
            try:
                resp = self._client.request(
                    method,
                    url_path,
                    content=body_bytes if body_bytes else None,
                    params=params,
                    headers=headers,
                )
            except httpx.HTTPError as e:
                raise SopTransportError(f"网络错误：{e}") from e
            self._raise_for_status(resp)
            if resp.status_code == 204 or not resp.content:
                return None
            ct = resp.headers.get("content-type", "")
            if ct.startswith("application/json") or ct.startswith("application/problem+json"):
                return resp.json()
            return resp.text

        if not retry:
            return _do()

        try:
            for attempt in Retrying(
                stop=stop_after_attempt(self.max_retries + 1),
                wait=wait_exponential(multiplier=0.5, min=0.5, max=30),
                retry=retry_if_exception_type((SopTransportError, SopServerError)),
                reraise=True,
            ):
                with attempt:
                    return _do()
        except RetryError as e:  # pragma: no cover
            raise SopTransportError(f"重试耗尽：{e}") from e

    @staticmethod
    def _raise_for_status(resp: httpx.Response) -> None:
        if resp.is_success:
            return
        try:
            payload = resp.json()
        except Exception:
            payload = {"detail": resp.text}
        msg = payload.get("title") or payload.get("detail") or resp.text or "manager 请求失败"
        code = resp.status_code
        if code == 401:
            raise SopAuthError(msg, status=code, detail=payload)
        if code == 403:
            raise SopForbiddenError(msg, status=code, detail=payload)
        if code == 404:
            raise SopNotFoundError(msg, status=code, detail=payload)
        if code == 409:
            raise SopConflictError(msg, status=code, detail=payload)
        if 500 <= code < 600:
            raise SopServerError(msg, status=code, detail=payload)
        raise SopTransportError(msg, status=code, detail=payload)

    # ── 公开方法（与 openapi.yaml 一一对应；保持精简）──────────────
    def health(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/health")

    def rag_backend(self) -> dict[str, Any]:
        """RAG 向量后端与 SQL 类型探测（无需鉴权时部分部署可能 401，doctor 内捕获）。"""
        return self._request("GET", "/api/v1/rag/health")

    def system_pages(
        self,
        *,
        view: str = "react",
        domain: str = "",
        status: str = "",
        q: str = "",
    ) -> dict[str, Any]:
        params = {"view": view, "domain": domain, "status": status, "q": q}
        return self._request("GET", "/api/v1/system/pages", params=params)

    def system_pages_manifest(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/system/pages/manifest")

    def system_readiness_full(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/system/readiness/full")

    def pages_productization(self, *, domain: str = "all", q: str = "") -> dict[str, Any]:
        return self._request("GET", "/api/v1/pages/productization", params={"domain": domain, "q": q})

    def pages_interaction_analysis(
        self,
        *,
        domain: str = "all",
        q: str = "",
        status: str = "all",
        limit: int = 80,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            "/api/v1/pages/interaction-analysis",
            params={"domain": domain, "q": q, "status": status, "limit": limit},
        )

    def pages_interaction_tasks(self, **body: Any) -> dict[str, Any]:
        return self._request("POST", "/api/v1/pages/interaction-analysis/tasks", json_body=body)

    def pages_interaction_ops(
        self,
        *,
        domain: str = "all",
        q: str = "",
        status: str = "watch",
        limit: int = 80,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            "/api/v1/pages/interaction-ops",
            params={"domain": domain, "q": q, "status": status, "limit": limit},
        )

    def pages_interaction_ops_tasks(self, **body: Any) -> dict[str, Any]:
        return self._request("POST", "/api/v1/pages/interaction-ops/tasks", json_body=body)

    def pages_interaction_ops_memory(self, **body: Any) -> dict[str, Any]:
        return self._request("POST", "/api/v1/pages/interaction-ops/memory", json_body=body)

    def pages_interaction_ops_export(self, **body: Any) -> dict[str, Any]:
        return self._request("POST", "/api/v1/pages/interaction-ops/export", json_body=body)

    def skills_runtime(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/skills/runtime")

    def plugins_governance(self, *, q: str = "") -> dict[str, Any]:
        return self._request("GET", "/api/v1/plugins/governance", params={"q": q})

    def graph_loop_summary(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/graph-loop/summary")

    def graph_loop_runs(self, *, limit: int = 50) -> dict[str, Any]:
        return self._request("GET", "/api/v1/graph-loop/runs", params={"limit": limit})

    def graph_loop_slo(self, *, run_id: str = "") -> dict[str, Any]:
        if run_id:
            return self._request("GET", f"/api/v1/graph-loop/runs/{run_id}/slo")
        return self._request("GET", "/api/v1/graph-loop/slo")

    def graph_loop_plan(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/graph-loop/plan", json_body=dict(body))

    def graph_loop_run(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/graph-loop/runs", json_body=dict(body))

    def graph_loop_detail(self, run_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/graph-loop/runs/{run_id}")

    def graph_loop_events(self, run_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/graph-loop/runs/{run_id}/events")

    def graph_loop_action(self, run_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/graph-loop/runs/{run_id}/action", json_body=dict(body))

    def graph_loop_transition(self, run_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/graph-loop/runs/{run_id}/transition", json_body=dict(body))

    def graph_loop_interrupt_decision(self, run_id: str, interrupt_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/graph-loop/runs/{run_id}/interrupts/{interrupt_id}/decision", json_body=dict(body))

    def graph_loop_replay(self, run_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/graph-loop/runs/{run_id}/replay", json_body=dict(body))

    def graph_loop_export(self, run_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/graph-loop/runs/{run_id}/export", json_body=dict(body))

    def system_pages_manifest_me(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/system/pages/manifest/me")

    def system_pages_capabilities(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/system/pages/capabilities")

    def system_pages_capabilities_me(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/system/pages/capabilities/me")

    def system_pages_health(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/system/pages/health")

    def system_pages_isolation(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/system/pages/isolation-audit")

    def system_pages_isolation_scan(self, *, status: str = "", q: str = "") -> dict[str, Any]:
        return self._request("GET", "/api/v1/system/pages/isolation-audit/scan", params={"status": status, "q": q})

    def system_pages_isolation_scan_tasks(self, **body: Any) -> dict[str, Any]:
        return self._request("POST", "/api/v1/system/pages/isolation-audit/scan/tasks", json_body=body)

    def system_pages_isolation_scan_runs(self, *, limit: int = 20) -> dict[str, Any]:
        return self._request("GET", "/api/v1/system/pages/isolation-audit/scan/runs", params={"limit": limit})

    def system_pages_isolation_scan_run_create(self, **body: Any) -> dict[str, Any]:
        return self._request("POST", "/api/v1/system/pages/isolation-audit/scan/runs", json_body=body)

    def system_pages_isolation_scan_compare(
        self,
        *,
        base_id: str = "",
        target_id: str = "",
        status: str = "",
        q: str = "",
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            "/api/v1/system/pages/isolation-audit/scan/runs/compare",
            params={"base_id": base_id, "target_id": target_id, "status": status, "q": q},
        )

    def system_pages_isolation_scan_compare_tasks(self, **body: Any) -> dict[str, Any]:
        return self._request("POST", "/api/v1/system/pages/isolation-audit/scan/runs/compare/tasks", json_body=body)

    def system_pages_isolation_tasks(self, **body: Any) -> dict[str, Any]:
        return self._request("POST", "/api/v1/system/pages/isolation-audit/tasks", json_body=body)

    def system_pages_readiness(self, *, domain: str = "", status: str = "", q: str = "") -> dict[str, Any]:
        return self._request("GET", "/api/v1/system/pages/readiness", params={"domain": domain, "status": status, "q": q})

    def system_pages_readiness_tasks(self, **body: Any) -> dict[str, Any]:
        return self._request("POST", "/api/v1/system/pages/readiness/tasks", json_body=body)

    def system_pages_governance_tasks(
        self,
        *,
        status: str = "",
        source: str = "",
        q: str = "",
        limit: int = 50,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            "/api/v1/system/pages/governance-tasks",
            params={"status": status, "source": source, "q": q, "limit": limit},
        )

    def system_pages_governance_tasks_bulk_update(self, **body: Any) -> dict[str, Any]:
        return self._request("POST", "/api/v1/system/pages/governance-tasks/bulk-update", json_body=body)

    def system_pages_menu_preferences_me(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/system/pages/menu/preferences/me")

    def system_pages_menu_preferences_update(self, **body: Any) -> dict[str, Any]:
        return self._request("PUT", "/api/v1/system/pages/menu/preferences/me", json_body=body)

    # auth
    def login(self, username: str, password: str, tenant_slug: str | None = None) -> dict[str, Any]:
        body = {"username": username, "password": password}
        if tenant_slug:
            body["tenant_slug"] = tenant_slug
        out = self._request("POST", "/api/v1/auth/login", json_body=body)
        if isinstance(out, dict):
            tok = (out.get("access_token") or out.get("token") or "").strip()
            if tok:
                out = {**out, "access_token": tok, "token": tok, "token_type": out.get("token_type") or "Bearer"}
        return out

    def pair_project(self, pair_code: str, hostname: str = "", local_path: str = "") -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/auth/pair",
            json_body={"pair_code": pair_code, "hostname": hostname, "local_path": local_path},
        )

    def create_pair_code(self, *, local_path: str = "", preferred_project_id: str = "") -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/auth/pair/codes",
            json_body={"local_path": local_path, "preferred_project_id": preferred_project_id},
        )

    # projects
    def list_projects(self, *, tenant_id: str | None = None, page: int = 1, size: int = 50) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "size": size}
        if tenant_id:
            params["tenant_id"] = tenant_id
        return self._request("GET", "/api/v1/projects", params=params)

    def create_project(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/projects", json_body=body)

    def project_onboarding(self, project_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/projects/{project_id}/onboarding")

    def project_review(self, project_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/projects/{project_id}/review")

    def project_ops_plan(self, project_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/projects/{project_id}/ops-plan")

    def project_ops_tasks(self, project_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/projects/{project_id}/ops-tasks", json_body=body)

    def project_clone_preview(self, template_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/projects/{template_id}/clone-preview", json_body=body)

    # dev flow
    def dev_flow_ops_plan(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/dev-flow/ops-plan")

    def dev_flow_ops_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/dev-flow/ops-tasks", json_body=dict(body))

    def dev_flow_lifecycle(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/dev-flow/lifecycle")

    # workflows
    def workflow_instances(self, *, limit: int = 100, status: str = "", type: str = "", q: str = "") -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit}
        if status:
            params["status"] = status
        if type:
            params["type"] = type
        if q:
            params["q"] = q
        return self._request("GET", "/api/v1/workflows/instances", params=params)

    def workflow_events(self, *, limit: int = 100, workflow_id: str = "") -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit}
        if workflow_id:
            params["workflow_id"] = workflow_id
        return self._request("GET", "/api/v1/workflows/events", params=params)

    def workflow_ops_plan(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/workflows/ops-plan")

    def workflow_ops_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/workflows/ops-tasks", json_body=body)

    def start_workflow(self, body: Mapping[str, Any]) -> dict[str, Any]:
        """Start a caller-named workflow so retries retain the same execution."""
        if not body.get("workflow_id"):
            raise ValueError("workflow_id is required for retry-safe workflow start")
        _resource_segment(body["workflow_id"])
        return self._request("POST", "/api/v1/workflows/start", json_body=dict(body))

    def workflow_detail(self, workflow_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/workflows/{_resource_segment(workflow_id)}/detail")

    def signal_workflow(self, workflow_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/workflows/{_resource_segment(workflow_id)}/signal", json_body=dict(body))

    def review_workflow(self, workflow_id: str, decision: str, comment: str, signal_id: str) -> dict[str, Any]:
        if decision not in {"approve", "request_changes", "reject"} or not comment.strip() or not signal_id.strip():
            raise ValueError("Review requires an explicit decision, comment and stable signal_id")
        return self.signal_workflow(workflow_id, {
            "signal": decision, "payload": {"comment": comment, "signal_id": signal_id},
        })

    # tasks
    def list_tasks(self, *, status: str | None = None, priority: str | None = None,
                   page: int = 1, size: int = 50) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "size": size}
        if status:
            params["status"] = status
        if priority:
            params["priority"] = priority
        out = self._request("GET", "/api/v1/tasks", params=params)
        if isinstance(out, list):
            items = out
            if priority:
                items = [x for x in items if isinstance(x, dict) and x.get("priority") == priority]
            return {"total": len(items), "page": page, "size": size, "items": items}
        return out

    def get_task(self, task_id: str) -> dict[str, Any]:
        """Read one task in the client's authorized project; never switch scope."""
        if not isinstance(task_id, str) or not re.fullmatch(r"T-[a-zA-Z0-9._-]{2,80}", task_id):
            raise ValueError("task_id must be T- followed by 2-80 ASCII letters, digits, dots, underscores or hyphens")
        return self._request("GET", f"/api/v1/tasks/{quote(task_id, safe='')}")

    def create_task(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/tasks", json_body=body)

    def update_task(self, task_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("PATCH", f"/api/v1/tasks/{task_id}", json_body=body)

    def pull_task(self, task_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/tasks/{task_id}:pull")

    def task_scheduler_plan(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/tasks/scheduler/plan", json_body=dict(body))

    def task_scheduler_runs(self, *, limit: int = 20, q: str = "", include_archived: bool = False) -> dict[str, Any]:
        return self._request(
            "GET",
            "/api/v1/tasks/scheduler/runs",
            params={"limit": limit, "q": q, "include_archived": str(include_archived).lower()},
        )

    def task_scheduler_run_detail(self, schedule_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/tasks/scheduler/runs/{schedule_id}")

    def task_scheduler_run_action(self, schedule_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/tasks/scheduler/runs/{schedule_id}/action", json_body=dict(body))

    def task_scheduler_ops_summary(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/tasks/scheduler/ops-summary")

    def task_scheduler_runbook(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/tasks/scheduler/runbook", json_body=dict(body))

    def task_scheduler_insights(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/tasks/scheduler/insights", json_body=dict(body))

    def task_scheduler_insight_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/tasks/scheduler/insights/tasks", json_body=dict(body))

    def task_agent_feed(
        self,
        *,
        limit: int = 10,
        agent: str = "",
        include_blocked: bool = False,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit, "include_blocked": str(include_blocked).lower()}
        if agent:
            params["agent"] = agent
        return self._request("GET", "/api/v1/tasks/agent-feed", params=params)

    def task_agent_claims(self, *, status: str = "active", limit: int = 50) -> dict[str, Any]:
        return self._request("GET", "/api/v1/tasks/agent-feed/claims", params={"status": status, "limit": limit})


    def task_agent_execution_plan(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/tasks/agent-feed/execution-plan", json_body=dict(body))

    def task_agent_plan(
        self,
        task_id: str,
        *,
        claim_id: str = "",
        agent: str = "",
        include_context: bool = True,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/api/v1/tasks/{task_id}/agent-plan",
            params={"claim_id": claim_id, "agent": agent, "include_context": str(include_context).lower()},
        )



    def task_agent_reports(
        self,
        *,
        limit: int = 100,
        status: str = "",
        agent: str = "",
        task_id: str = "",
        q: str = "",
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            "/api/v1/tasks/agent-feed/reports",
            params={"limit": limit, "status": status, "agent": agent, "task_id": task_id, "q": q},
        )

    def task_quality_policy(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/tasks/quality/policy")

    def task_quality_policy_update(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("PUT", "/api/v1/tasks/quality/policy", json_body=dict(body))

    def task_quality_summary(self, *, limit: int = 100) -> dict[str, Any]:
        return self._request("GET", "/api/v1/tasks/quality/summary", params={"limit": limit})

    def task_quality_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/tasks/quality/tasks", json_body=dict(body))

    def task_quality(self, task_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/tasks/{task_id}/quality")

    def task_quality_evaluate(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/tasks/quality/evaluate", json_body=dict(body))

    def task_dependencies(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/tasks/dependencies")

    def task_dependency_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/tasks/dependencies/tasks", json_body=dict(body))

    def delete_task(self, task_id: str) -> dict[str, Any]:
        return self._request("DELETE", f"/api/v1/tasks/{task_id}")

    # requirements
    def list_requirements(
        self,
        *,
        status: str | None = None,
        priority: str | None = None,
        page: int = 1,
        size: int = 50,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "size": size}
        if status:
            params["status"] = status
        if priority:
            params["priority"] = priority
        out = self._request("GET", "/api/v1/requirements", params=params)
        if isinstance(out, list):
            items = out
            if status:
                items = [x for x in items if isinstance(x, dict) and x.get("status") == status]
            if priority:
                items = [
                    x
                    for x in items
                    if isinstance(x, dict) and str(x.get("priority") or "").upper() == priority.upper()
                ]
            start = max(page - 1, 0) * size
            return {"total": len(items), "page": page, "size": size, "items": items[start : start + size]}
        return out

    def create_requirement(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/requirements", json_body=body)

    def batch_create_requirements(self, items: Iterable[Mapping[str, Any]] | Mapping[str, Any]) -> dict[str, Any]:
        body = dict(items) if isinstance(items, Mapping) else {"items": [dict(x) for x in items]}
        return self._request("POST", "/api/v1/requirements/batch", json_body=body)

    def parse_requirements_document(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/requirements/parse-document", json_body=dict(body))

    def update_requirement(self, req_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("PATCH", f"/api/v1/requirements/{req_id}", json_body=body)

    def review_requirement(self, req_id: str, body: Mapping[str, Any] | None = None) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/requirements/{_resource_segment(req_id)}/review",
                             json_body=dict(body) if body is not None else None)

    def apply_requirement_review(self, req_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/requirements/{req_id}/apply-review", json_body=body)

    def generate_requirement_prototype(self, req_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/requirements/{_resource_segment(req_id)}/prototype", json_body=dict(body))

    def apply_requirement_prototype(self, req_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/requirements/{_resource_segment(req_id)}/prototype/apply", json_body=dict(body))

    def requirement_assistance_history(self, req_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/requirements/{_resource_segment(req_id)}/assistance-history")

    def delete_requirement(self, req_id: str) -> dict[str, Any]:
        return self._request("DELETE", f"/api/v1/requirements/{req_id}")

    def requirement_ops_plan(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/requirements/ops-plan")

    def requirement_ops_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/requirements/ops-tasks", json_body=dict(body))

    # issues
    def list_issues(
        self,
        *,
        status: str | None = None,
        severity: str | None = None,
        page: int = 1,
        size: int = 50,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "size": size}
        if status:
            params["status"] = status
        if severity:
            params["severity"] = severity
        return self._request("GET", "/api/v1/issues", params=params)

    def create_issue(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/issues", json_body=body)

    def update_issue(self, issue_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("PATCH", f"/api/v1/issues/{issue_id}", json_body=body)

    def resolve_issue(self, issue_id: str, *, resolution: str = "") -> dict[str, Any]:
        return self._request("PATCH", f"/api/v1/issues/{issue_id}/resolve", json_body={"resolution": resolution})

    def delete_issue(self, issue_id: str) -> dict[str, Any]:
        return self._request("DELETE", f"/api/v1/issues/{issue_id}")

    def issue_ops_plan(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/issues/ops-plan")

    def issue_ops_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/issues/ops-tasks", json_body=dict(body))

    # sprints
    def list_sprints(self, *, page: int = 1, size: int = 20) -> dict[str, Any]:
        return self._request("GET", "/api/v1/sprints", params={"page": page, "size": size})

    def create_sprint(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/sprints", json_body=body)

    def update_sprint(self, sprint_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("PATCH", f"/api/v1/sprints/{sprint_id}", json_body=body)

    def sprint_progress(self, sprint_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/sprints/{sprint_id}/progress")

    def delete_sprint(self, sprint_id: str) -> dict[str, Any]:
        return self._request("DELETE", f"/api/v1/sprints/{sprint_id}")

    def sprint_ops_plan(self, *, sprint_id: str = "") -> dict[str, Any]:
        params = {"sprint_id": sprint_id} if sprint_id else None
        return self._request("GET", "/api/v1/sprints/ops-plan", params=params)

    def sprint_ops_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/sprints/ops-tasks", json_body=dict(body))

    # llm gateway
    def llm_chat(
        self,
        messages: Iterable[Mapping[str, str]],
        *,
        model: str | None = None,
        task_type: str | None = None,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        cache_ttl: int | None = None,
        stream: bool = False,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"messages": list(messages), "temperature": temperature, "stream": stream}
        if model:
            body["model"] = model
        if task_type:
            body["task_type"] = task_type
        if max_tokens:
            body["max_tokens"] = max_tokens
        if cache_ttl is not None:
            body["cache_ttl"] = cache_ttl
        return self._request("POST", "/api/v1/llm/chat", json_body=body)

    def llm_embeddings(self, inputs: str | list[str], *, model: str = "bge-m3") -> dict[str, Any]:
        return self._request("POST", "/api/v1/llm/embeddings", json_body={"input": inputs, "model": model})

    def rag_search(self, query: str, *, collections: list[str] | None = None,
                   limit: int = 8, hybrid: bool = True, rerank: bool = True) -> dict[str, Any]:
        body: dict[str, Any] = {"query": query, "limit": limit, "hybrid": hybrid, "rerank": rerank}
        if collections:
            body["collections"] = collections
        return self._request("POST", "/api/v1/rag/search", json_body=body)

    # ── v4 记忆（可扩展后端 file → mem0）────────────────────────────
    def memory_health(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/memory/health", retry=False)

    def memory_add(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/memory", json_body=body)

    def memory_search(self, q: str, *, limit: int = 20) -> dict[str, Any]:
        return self._request("GET", "/api/v1/memory/search", params={"q": q, "limit": limit})

    def memory_recent(self, *, limit: int = 30) -> dict[str, Any]:
        return self._request("GET", "/api/v1/memory/recent", params={"limit": limit})

    def memory_forget(
        self,
        *,
        ids: list[str] | None = None,
        query: str = "",
        kind: str = "",
    ) -> dict[str, Any]:
        return self._request("POST", "/api/v1/memory/forget", json_body={"ids": ids or [], "query": query, "kind": kind})

    def memory_summarize(
        self,
        *,
        query: str = "",
        limit: int = 50,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._request("POST", "/api/v1/memory/summarize", json_body={"query": query, "limit": limit, "metadata": dict(metadata or {})})

    def memory_attach_run(
        self,
        memory_id: str,
        *,
        run_id: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/memory/{memory_id}/attach-run", json_body={"run_id": run_id, "metadata": dict(metadata or {})})

    def knowledge_search_workspace(self, q: str, *, category: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"q": q}
        if category:
            params["category"] = category
        return self._request("GET", "/api/v1/knowledge/search", params=params)

    def knowledge_create(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/knowledge", json_body=body)

    def knowledge_index(self) -> dict[str, Any]:
        return self._request("POST", "/api/v1/knowledge/index")

    def intelligence_hub(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/intelligence/hub")

    def reflection_distill(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/reflections/distill", json_body=dict(body))

    def reflection_proposals(self, *, limit: int = 100) -> list[dict[str, Any]]:
        r = self._request("GET", "/api/v1/reflections/proposals", params={"limit": limit})
        return r if isinstance(r, list) else []

    def reflection_review_proposal(self, proposal_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/reflections/proposals/{proposal_id}/review", json_body=dict(body))

    def sync_pull(
        self,
        *,
        cursor: str = "",
        modules: str = "tasks,requirements,issues,sprints,rules,specs,templates",
        limit: int = 200,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            "/api/v1/sync/pull",
            params={"cursor": cursor, "modules": modules, "limit": limit},
        )

    def sync_health(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/sync/health", retry=False)

    def sync_modules(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/sync/modules")

    def sync_summary(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/sync/summary")

    def worker_enqueue(self, job_type: str, payload: Mapping[str, Any] | None = None) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/worker/jobs",
            json_body={"type": job_type, "payload": dict(payload or {})},
        )

    def worker_job_status(self, job_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/worker/jobs/{job_id}")

    def worker_health(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/worker/health", retry=False)

    def worker_types(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/worker/types")

    def worker_jobs(self, *, limit: int = 100, status: str = "", job_type: str = "") -> dict[str, Any]:
        return self._request("GET", "/api/v1/worker/jobs", params={"limit": limit, "status": status, "type": job_type})

    def worker_cancel(self, job_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/worker/jobs/{job_id}/cancel")

    def worker_retry(self, job_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/worker/jobs/{job_id}/retry")

    def notify_list_channels(self) -> list[dict[str, Any]]:
        r = self._request("GET", "/api/v1/notify/channels")
        return r if isinstance(r, list) else []

    def notify_connectors(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/notify/connectors")

    def notify_connector_callback_template(self, connector_type: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/notify/connectors/{connector_type}/callback-template")

    def notify_connector_verify(
        self,
        connector_type: str,
        *,
        secret: str = "",
        timestamp: str = "",
        nonce: str = "",
        signature: str = "",
        body: str = "",
        payload: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/notify/connectors/{connector_type}/verify",
            json_body={
                "secret": secret,
                "timestamp": timestamp,
                "nonce": nonce,
                "signature": signature,
                "body": body,
                "payload": dict(payload or {}),
            },
        )

    def notify_inbound_connector(self, connector_type: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/notify/connectors/{connector_type}/inbound", json_body=dict(payload))

    def notify_test_channel(self, channel_name: str) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/notify/test/{channel_name}")

    def notify_summary(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/notify/summary")

    def notify_messages(self, *, limit: int = 100, direction: str = "") -> dict[str, Any]:
        return self._request("GET", "/api/v1/notify/messages", params={"limit": limit, "direction": direction})

    def notify_send(self, channel: str, title: str, content: str, level: str = "info") -> dict[str, Any]:
        return self._request("POST", "/api/v1/notify/send", json_body={"channel": channel, "title": title, "content": content, "level": level})

    def notify_inbound(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/notify/inbound", json_body=dict(body))

    def notify_inbound_action(self, message_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/notify/inbound/{message_id}/action", json_body=dict(body))

    def list_businesses(self) -> list[dict[str, Any]]:
        r = self._request("GET", "/api/v1/businesses")
        return r if isinstance(r, list) else []

    def list_auth_users(self) -> list[dict[str, Any]]:
        r = self._request("GET", "/api/v1/auth/users")
        return r if isinstance(r, list) else []

    def organization_policy(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/organization/policy")

    def organization_policy_update(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("PUT", "/api/v1/organization/policy", json_body=dict(body))

    def organization_policy_reset(self) -> dict[str, Any]:
        return self._request("POST", "/api/v1/organization/policy/reset")

    def organization_policy_check(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/organization/policy/check", json_body=dict(body))

    def organization_policy_history(self, *, limit: int = 50) -> dict[str, Any]:
        return self._request("GET", "/api/v1/organization/policy/history", params={"limit": limit})

    def organization_access_review(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/organization/access-review")

    def organization_access_review_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/organization/access-review/tasks", json_body=dict(body))

    def data_analytics_overview(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/analytics/overview")

    def data_analytics_blueprint(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/analytics/blueprint")

    def data_analytics_blueprint_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/blueprint/tasks", json_body=dict(body))

    def data_assets(self, *, type: str = "", status: str = "", q: str = "") -> dict[str, Any]:
        params: dict[str, str] = {}
        if type:
            params["type"] = type
        if status:
            params["status"] = status
        if q:
            params["q"] = q
        return self._request("GET", "/api/v1/analytics/assets", params=params)

    def data_metrics_center(self, *, domain: str = "", q: str = "") -> dict[str, Any]:
        params: dict[str, str] = {}
        if domain:
            params["domain"] = domain
        if q:
            params["q"] = q
        return self._request("GET", "/api/v1/analytics/metrics/center", params=params)

    def data_tags(self, *, category: str = "", q: str = "") -> dict[str, Any]:
        params: dict[str, str] = {}
        if category:
            params["category"] = category
        if q:
            params["q"] = q
        return self._request("GET", "/api/v1/analytics/tags", params=params)

    def data_quality_rules(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/analytics/quality/rules")

    def data_quality_evaluate(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/quality/evaluate", json_body=dict(body))

    def data_governance_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/governance/tasks", json_body=dict(body))

    def data_metric_upsert(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/metrics/center", json_body=dict(body))

    def data_tag_upsert(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/tags", json_body=dict(body))

    def data_services(self, *, status: str = "", q: str = "") -> dict[str, Any]:
        params: dict[str, str] = {}
        if status:
            params["status"] = status
        if q:
            params["q"] = q
        return self._request("GET", "/api/v1/analytics/services", params=params)

    def data_service_upsert(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/services", json_body=dict(body))

    def data_service_publish(self, service_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/analytics/services/{service_id}/publish", json_body=dict(body))

    def data_quality_alerts(self, *, severity: str = "", q: str = "") -> dict[str, Any]:
        params: dict[str, str] = {}
        if severity:
            params["severity"] = severity
        if q:
            params["q"] = q
        return self._request("GET", "/api/v1/analytics/quality/alerts", params=params)

    def data_quality_alert_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/quality/alerts/tasks", json_body=dict(body))

    def data_quality_alert_notify(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/quality/alerts/notify", json_body=dict(body))

    def data_dev_templates(self, *, status: str = "", q: str = "") -> dict[str, Any]:
        params: dict[str, str] = {}
        if status:
            params["status"] = status
        if q:
            params["q"] = q
        return self._request("GET", "/api/v1/analytics/development/templates", params=params)

    def data_dev_template_upsert(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/development/templates", json_body=dict(body))

    def data_dev_template_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/development/tasks", json_body=dict(body))

    def data_dev_schedule(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/development/schedule", json_body=dict(body))

    def data_dev_ops_summary(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/analytics/development/ops-summary")

    def data_dev_runbook(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/development/runbook", json_body=dict(body))

    def data_dev_schedules(self, *, limit: int = 20, q: str = "") -> dict[str, Any]:
        params: dict[str, str] = {"limit": str(limit)}
        if q:
            params["q"] = q
        return self._request("GET", "/api/v1/analytics/development/schedules", params=params)

    def data_dev_schedule_detail(self, schedule_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/analytics/development/schedules/{schedule_id}")

    def data_dev_schedule_action(self, schedule_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/analytics/development/schedules/{schedule_id}/action", json_body=dict(body))

    def data_dev_agent_feed(self, *, limit: int = 20, schedule_id: str = "", agent: str = "", include_blocked: bool = False) -> dict[str, Any]:
        params: dict[str, str] = {"limit": str(limit), "include_blocked": str(include_blocked).lower()}
        if schedule_id:
            params["schedule_id"] = schedule_id
        if agent:
            params["agent"] = agent
        return self._request("GET", "/api/v1/analytics/development/agent-feed", params=params)

    def data_dev_agent_feed_action(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/development/agent-feed/action", json_body=dict(body))

    def data_dev_evidence(self, *, limit: int = 50, schedule_id: str = "", packet_id: str = "", decision: str = "") -> dict[str, Any]:
        params: dict[str, str] = {"limit": str(limit)}
        if schedule_id:
            params["schedule_id"] = schedule_id
        if packet_id:
            params["packet_id"] = packet_id
        if decision:
            params["decision"] = decision
        return self._request("GET", "/api/v1/analytics/development/evidence", params=params)

    def data_dev_evidence_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/development/evidence/tasks", json_body=dict(body))

    def data_dev_evidence_notify(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/development/evidence/notify", json_body=dict(body))

    def data_analytics_nlq(self, question: str) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analytics/nlq", json_body={"question": question})

    def db_config(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/db-config")

    def db_connections(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/db-config/connections")

    def db_drivers(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/db-config/drivers")

    def db_upsert_connection(self, name: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("PUT", f"/api/v1/db-config/connections/{name}", json_body=dict(body))

    def db_delete_connection(self, name: str) -> dict[str, Any]:
        return self._request("DELETE", f"/api/v1/db-config/connections/{name}")

    def db_test_connection(self, name: str, *, url: str = "") -> dict[str, Any]:
        params = {"url": url} if url else None
        return self._request("POST", f"/api/v1/db-config/connections/{name}/test", params=params)

    def platforms_list(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/platforms")

    def platforms_install_shims(self, platform_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/platforms/install-shims/{platform_id}")

    def platforms_ops_plan(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/platforms/ops-plan")

    def platforms_ops_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/platforms/ops-tasks", json_body=dict(body))

    def agents_runs_summary(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/agents/runs/summary")

    def agents_runs(self, *, agent: str = "", status: str = "", limit: int = 100) -> dict[str, Any]:
        return self._request("GET", "/api/v1/agents/runs", params={"agent": agent, "status": status, "limit": limit})

    def agents_runs_slo(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/agents/runs/slo")

    def agents_runs_rebalance_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/agents/runs/rebalance-tasks", json_body=dict(body))

    def copilot_ask(
        self,
        query: str,
        *,
        context: Mapping[str, Any] | None = None,
        session_id: str = "",
        run_id: str = "",
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"query": query}
        if context:
            body["context"] = dict(context)
        if session_id:
            body["session_id"] = session_id
        if run_id:
            body["run_id"] = run_id
        return self._request("POST", "/api/v1/copilot/ask", json_body=body)

    def copilot_sessions(self, *, limit: int = 100) -> dict[str, Any]:
        return self._request("GET", "/api/v1/copilot/sessions", params={"limit": limit})

    def copilot_session(self, session_id: str, *, limit: int = 100) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/copilot/sessions/{session_id}", params={"limit": limit})

    def copilot_classify(self, text: str) -> dict[str, Any]:
        return self._request("POST", "/api/v1/copilot/classify", json_body={"text": text})

    def copilot_summarize(self, items: list[str]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/copilot/summarize", json_body={"items": items})

    def copilot_suggest(self, context: str, *, goal: str = "") -> dict[str, Any]:
        return self._request("POST", "/api/v1/copilot/suggest", json_body={"context": context, "goal": goal})

    def context_me(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/context/me")

    def sync_push(
        self,
        module: str,
        record: Mapping[str, Any],
        *,
        action: str = "upsert",
        idempotency_key: str = "",
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/sync/push",
            json_body={
                "module": module,
                "action": action,
                "record": dict(record),
                "idempotency_key": idempotency_key,
            },
        )

    def sync_journal(self, *, since: str = "", limit: int = 100) -> dict[str, Any]:
        return self._request("GET", "/api/v1/sync/journal", params={"since": since, "limit": limit})

    def events_ingest(self, events: list[Mapping[str, Any]]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/events:ingest", json_body={"events": [dict(e) for e in events]})

    def events_list(self, *, since: str = "", limit: int = 100) -> dict[str, Any]:
        return self._request("GET", "/api/v1/events", params={"since": since, "limit": limit})

    def usage_record(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/usage/record", json_body=dict(body))

    def usage_summary(self, *, since: str = "", limit: int = 5000) -> dict[str, Any]:
        return self._request("GET", "/api/v1/usage/summary", params={"since": since, "limit": limit})

    def usage_quota(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/usage/quota")

    def usage_check(self, metric: str, delta: float, *, source: str = "sop-sdk", subject: str = "") -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/usage/check",
            json_body={"metric": metric, "delta": delta, "source": source, "subject": subject},
        )

    def usage_set_quota(self, limits: Mapping[str, float]) -> dict[str, Any]:
        return self._request("PUT", "/api/v1/usage/quota", json_body={"limits": dict(limits)})

    def usage_alerts(self, *, limit: int = 5000) -> dict[str, Any]:
        return self._request("GET", "/api/v1/usage/alerts", params={"limit": limit})

    def usage_alert_tasks(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/usage/alerts/tasks", json_body=dict(body))

    # 工作台驾驶舱（原 console/overview 合并至此）
    def console_overview(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/dashboard")

    def health_detail(self) -> dict[str, Any]:
        """含 DB/向量/系统检查；带 Bearer 时 paths 中含 v4 三码作用域。"""
        return self._request("GET", "/api/v1/health/detail")


def build_default_client(config: AgentConfig | None = None) -> ManagerClient:
    """根据项目配置 + 环境变量自动构建 ManagerClient。"""
    cfg = config or load_config()
    if cfg.bearer_token:
        auth: Auth = BearerAuth(cfg.bearer_token)
    elif cfg.api_key:
        auth = HmacAuth(cfg.api_key)
    else:
        auth = auth_from_env()
    tenant_code = (cfg.tenant_code or "").strip() or (cfg.tenant_id or "").strip()
    business_code = (cfg.business_code or "").strip()
    project_code = (cfg.project_code or "").strip() or (cfg.project_id or "").strip()
    return ManagerClient(
        base_url=cfg.manager_url,
        auth=auth,
        project_id=cfg.project_id,
        tenant_code=tenant_code,
        business_code=business_code,
        project_code=project_code,
        timeout=cfg.timeout_seconds,
        max_retries=cfg.max_retries,
        verify=cfg.verify_ssl,
    )
