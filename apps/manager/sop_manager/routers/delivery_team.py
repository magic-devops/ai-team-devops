"""Project responsibility identities; labels and runtime actors are separate."""

from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import or_, select

from .sql_models import DeliveryWorkspace, ProjectMember, User


def _reason(code, message):
    return {"code": code, "message": message}


def semantic_owner(owner):
    if owner is None:
        return None
    return {
        "id": owner["id"],
        "kind": owner.get("kind"),
        "available": owner.get("available", owner.get("active", False)),
    }


class TeamContext:
    """Resolve only stable IDs against actual project membership and registry."""

    def __init__(self, db, project, data=None, *, owner_ids=None):
        self.db, self.project = db, project
        with db.no_autoflush:
            if data is None:
                data = (
                    db.connection()
                    .execute(
                        select(DeliveryWorkspace.data).where(
                            DeliveryWorkspace.project_id == project.id,
                            DeliveryWorkspace.tenant_id == project.tenant_id,
                        )
                    )
                    .scalar()
                )
            self.data = data or {}
            query = self._humans()
            if owner_ids is not None:
                query = query.where(
                    User.id.in_([value[5:] for value in owner_ids if value.startswith("user:")])
                )
            else:
                query = query.where(
                    or_(
                        ProjectMember.project_id == project.id,
                        User.role.in_(["tenant_admin", "super_admin"]),
                    )
                )
            humans = db.connection().execute(query).mappings().all()
        self._humans_by_id = {"user:" + row["id"]: self._human(row) for row in humans}
        self._resources = {}
        for row in self.data.get("members", []):
            if isinstance(row, dict) and isinstance(row.get("id"), str) and not row["id"].startswith("user:"):
                self._resources.setdefault(row["id"], []).append(row)

    def _humans(self):
        return (
            select(
                User.id,
                User.username,
                User.status,
                User.role.label("user_role"),
                ProjectMember.role.label("project_role"),
            )
            .outerjoin(
                ProjectMember,
                (ProjectMember.user_id == User.id) & (ProjectMember.project_id == self.project.id),
            )
            .where(User.tenant_id == self.project.tenant_id)
        )

    def _human(self, row):
        active = row["status"] == "active"
        member = row["project_role"] is not None or row["user_role"] in {"tenant_admin", "super_admin"}
        reasons = []
        if not active:
            reasons.append(_reason("task_owner_inactive", "The responsible person is inactive."))
        if not member:
            reasons.append(
                _reason(
                    "task_owner_outside_project",
                    "The responsible person is no longer a member of this project.",
                )
            )
        return {
            "id": "user:" + row["id"],
            "name": row["username"],
            "kind": "human",
            "role": row["project_role"] or row["user_role"],
            "tool": "",
            "active": active,
            "available": not reasons,
            "reasons": reasons,
            "can_own_task": not reasons,
        }

    def resolve_owner(self, owner_id):
        if not owner_id:
            return None
        member = self._humans_by_id.get(owner_id)
        if member is None and owner_id.startswith("user:"):
            with self.db.no_autoflush:
                row = (
                    self.db.connection()
                    .execute(self._humans().where(User.id == owner_id[5:]))
                    .mappings()
                    .first()
                )
            if row:
                member = self._human(row)
        if member is None:
            candidates = self._resources.get(owner_id, [])
            if len(candidates) == 1 and candidates[0].get("kind") in {"agent", "tool"}:
                row = candidates[0]
                active = row.get("active") is True
                reasons = (
                    []
                    if active
                    else [_reason("task_owner_inactive", "The responsible resource is inactive.")]
                )
                if row["kind"] == "tool":
                    reasons.append(
                        _reason(
                            "task_owner_is_tool",
                            "Tools can support delivery but cannot be responsible for a task.",
                        )
                    )
                member = {
                    "id": owner_id,
                    "name": row.get("name"),
                    "kind": row["kind"],
                    "active": active,
                    "available": not reasons,
                    "reasons": reasons,
                }
            else:
                member = {
                    "id": owner_id,
                    "name": None,
                    "kind": None,
                    "active": False,
                    "available": False,
                    "reasons": [
                        _reason(
                            "task_owner_missing_identity",
                            "The responsible identity is missing or unavailable in this project.",
                        )
                    ],
                }
        return {
            key: deepcopy(member[key]) for key in ("id", "name", "kind", "active", "available", "reasons")
        }

    @property
    def roster(self):
        result = list(self._humans_by_id.values())
        for owner_id, rows in self._resources.items():
            owner = self.resolve_owner(owner_id)
            if len(rows) == 1:
                resource = {
                    **owner,
                    "role": rows[0].get("role", ""),
                    "tool": rows[0].get("tool", ""),
                    "can_own_task": owner["available"] and owner["kind"] in {"human", "agent"},
                }
                if owner["kind"] == "tool":
                    resource["reasons"] = [
                        reason for reason in owner["reasons"] if reason["code"] != "task_owner_is_tool"
                    ]
                    resource["available"] = not resource["reasons"]
                result.append(resource)
        return deepcopy(result)


def validate_task_owner(db, project, owner_id, data=None):
    if not isinstance(owner_id, str) or len(owner_id) > 100 or owner_id != owner_id.strip():
        raise HTTPException(
            422, _reason("task_owner_invalid", "Choose a stable responsible identity from this project.")
        )
    owner = TeamContext(db, project, data).resolve_owner(owner_id)
    if owner is not None and (not owner["available"] or owner["kind"] not in {"human", "agent"}):
        raise HTTPException(422, owner["reasons"][0])
    return owner
