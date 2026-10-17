"""Current delivery proof without materialization, progress capture or SQL writes."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy

from sqlalchemy import func

from .delivery_contract import default_flow, stage_gates
from .delivery_task_contract import delivery_task_definition
from .sql_models import DeliveryTaskReview, Issue, Requirement, Task


def fingerprint(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


class VerificationContext:
    """One authorized project's canonical rows and effective approval facts."""

    def __init__(self, db, project, data):
        from .delivery_service import members

        self.project, self.data = project, data

        def scoped(model):
            return db.query(model).filter_by(tenant_id=project.tenant_id, project_id=project.id).all()

        self.tasks = {row.id: row for row in scoped(Task)}
        self.requirements = {row.id: row for row in scoped(Requirement)}
        self.issues = scoped(Issue)
        self.roster = members(db, project, data, None)
        self.executions = {entry["task_id"]: entry for entry in data.get("executions", [])}
        latest = (
            db.query(func.max(DeliveryTaskReview.seq).label("seq"))
            .filter_by(tenant_id=project.tenant_id, project_id=project.id)
            .group_by(DeliveryTaskReview.task_id)
            .subquery()
        )
        self.reviews = {
            row.task_id: row
            for row in db.query(DeliveryTaskReview).join(latest, DeliveryTaskReview.seq == latest.c.seq)
        }
        self._snapshots, self._definitions, self._verified, self._accepted = {}, {}, {}, {}
        self._accepting = set()

    def owner(self, task):
        explicit = task.id in self.data.get("task_owners", {})
        owner_id = self.data.get("task_owners", {}).get(task.id, "")
        candidates = [
            member
            for member in self.roster
            if member.get("active")
            and member.get("kind") != "tool"
            and member["name"] == task.assigned_to
            and (not explicit or member["id"] == owner_id)
        ]
        # A legacy name only identifies someone when it is unique across all kinds.
        if (
            not explicit
            and len([m for m in self.roster if m.get("active") and m["name"] == task.assigned_to]) != 1
        ):
            return None
        if len(candidates) != 1:
            return None
        return {key: candidates[0][key] for key in ("id", "name", "kind", "active")}

    def snapshot(self, task_id, trail=frozenset()):
        if task_id in trail or task_id not in self.tasks:
            return None
        if task_id in self._snapshots:
            return deepcopy(self._snapshots[task_id])
        task = self.tasks[task_id]
        requirement = self.requirements.get(task.req_id)
        flow = self.data.get("flows", {}).get(task.req_id, default_flow())
        planning = self.data.get("task_details", {}).get(task_id, {})
        dependencies = {}
        for predecessor in planning.get("depends_on", []):
            dependencies[predecessor] = fingerprint(
                {
                    "snapshot": self.snapshot(predecessor, trail | {task_id}),
                    "verified": self.verified(predecessor, trail | {task_id}),
                }
            )
        value = {
            "task": {
                "id": task.id,
                "title": task.title,
                "description": task.description or "",
                "acceptance_criteria": task.acceptance_criteria,
                "req_id": task.req_id or "",
                "status": task.status,
                "assigned_to": task.assigned_to or "",
                "priority": task.priority,
                "estimate": task.estimate or "",
                "blocked_reason": planning.get("blocked_reason") or "",
            },
            "owner": self.owner(task),
            "requirement": None
            if requirement is None
            else {
                "id": requirement.id,
                "title": requirement.title,
                "description": requirement.description or "",
                "revision": flow["revision"],
                "acceptance_criteria": requirement.acceptance_criteria or [],
                "blocked_reason": flow.get("blocked_reason") or "",
            },
            "planning": {
                "requirement_criteria_indices": planning.get("requirement_criteria_indices", []),
                "depends_on": planning.get("depends_on", []),
            },
            "dependency_basis": dependencies,
        }
        definition = delivery_task_definition(
            value["task"],
            value["requirement"],
            planning,
            value["owner"],
            dependencies,
            requirement_revision=flow["revision"],
        )
        value["acceptance"] = definition["acceptance"]
        self._definitions[task_id] = definition
        self._snapshots[task_id] = value
        return deepcopy(value)

    def definition(self, task_id):
        if self.snapshot(task_id) is None:
            return None
        return deepcopy(self._definitions[task_id])

    def acceptance(self, task_id):
        """Conditions do not recurse into predecessor proof or collective review."""
        task = self.tasks[task_id]
        requirement = self.requirements.get(task.req_id)
        value = {
            key: getattr(task, key)
            for key in ("id", "req_id", "title", "description", "assigned_to", "acceptance_criteria")
        }
        parent = (
            None
            if not requirement
            else {
                key: getattr(requirement, key)
                for key in ("id", "title", "description", "acceptance_criteria")
            }
        )
        return delivery_task_definition(
            value,
            parent,
            self.data.get("task_details", {}).get(task_id, {}),
            None,
            {},
            requirement_revision=self.data.get("flows", {}).get(task.req_id, default_flow())["revision"],
        )["acceptance"]

    def execution_gate(self, task_id):
        definition = self.definition(task_id)
        if definition is None:
            return {
                "eligible": False,
                "reasons": [{"code": "task_missing", "message": "Task is no longer in this project."}],
            }
        reasons = definition["execution_gate"]["reasons"]
        task = self.tasks[task_id]
        planning = self.data.get("task_details", {}).get(task_id, {})
        flow = self.data.get("flows", {}).get(task.req_id, {})
        if task.status == "completed" or flow.get("stage") in {
            "testing",
            "acceptance",
            "release",
            "operations",
        }:
            reasons.append(
                {
                    "code": "task_dispatch_stage_blocked",
                    "message": "Reopen the task and requirement before dispatch.",
                }
            )
        if planning.get("blocked_reason") or flow.get("blocked_reason") or self.blocked(task_id):
            reasons.append(
                {
                    "code": "task_dependencies_blocked",
                    "message": "Resolve blocking reasons and verify predecessor delivery before dispatch.",
                }
            )
        entry = self.executions.get(task_id)
        if entry and entry["status"] not in {"accepted", "changes_requested", "cancelled"}:
            reasons.append(
                {
                    "code": "task_execution_active",
                    "message": "Review or cancel the current execution before redispatch.",
                }
            )
        return {"eligible": not reasons, "reasons": reasons}

    def basis(self, task_id):
        return fingerprint(self.snapshot(task_id))

    def execution_valid(self, task_id):
        """Validate one current execution snapshot before assigning any review state."""
        task = self.tasks.get(task_id)
        entry = self.executions.get(task_id)
        if not entry or not task or entry.get("stale") is not False or entry.get("planning_invalidated"):
            return False
        if (
            not entry.get("run_id")
            or not isinstance(entry.get("run_version"), int)
            or entry["run_version"] < 1
        ):
            return False
        definition = self.definition(task_id)
        return definition["execution_gate"]["eligible"] and entry.get("snapshot") == definition["snapshot"]

    def native_accepted(self, task_id):
        if not self.execution_valid(task_id):
            return False
        entry = self.executions[task_id]
        review = entry.get("review") or {}
        return (
            entry.get("status") == "accepted"
            and review.get("decision") == "accept"
            and review.get("run_version") == entry["run_version"]
            and bool(review.get("evidence_sha256"))
        )

    def delivery_status(self, task_id):
        """One six-state delivery vocabulary shared by progress and scheduling."""
        task = self.tasks[task_id]
        planned = self.data.get("task_details", {}).get(task_id, {})
        flow = self.data.get("flows", {}).get(task.req_id, {})
        if (
            task.status == "blocked"
            or planned.get("blocked_reason")
            or flow.get("blocked_reason")
            or self.blocked(task_id)
        ):
            return "blocked"
        entry = self.executions.get(task_id)
        if self.execution_valid(task_id) and entry.get("status") == "awaiting_review":
            return "awaiting_review"
        if task.status == "completed":
            return "verified_completed" if self.verified(task_id) else "recorded_completed"
        return "in_progress" if task.status == "in_progress" else "pending"

    def requirement_accepted(self, requirement_id):
        if requirement_id in self._accepted:
            return self._accepted[requirement_id]
        if requirement_id in self._accepting:
            return False
        requirement = self.requirements.get(requirement_id)
        flow = self.data.get("flows", {}).get(requirement_id)
        if not requirement or not flow or flow["stage"] not in {"release", "operations"}:
            return False
        self._accepting.add(requirement_id)
        reviewed = any(
            r.get("stage") == "acceptance"
            and r.get("revision") == flow["revision"]
            and r.get("decision") == "approved"
            for r in flow["reviews"]
        )
        tasks = []
        for task in self.tasks.values():
            status = task.status
            if self.data.get("task_details", {}).get(task.id, {}).get("blocked_reason"):
                status = "blocked"
            elif task.id in self.executions and not self.native_accepted(task.id) and status == "completed":
                status = "in_progress"
            tasks.append(
                {
                    "id": task.id,
                    "req_id": task.req_id,
                    "status": status,
                    "acceptance": self.acceptance(task.id),
                }
            )
        issues = [
            {"task_id": issue.task_id, "status": issue.status, "severity": issue.severity}
            for issue in self.issues
        ]
        accepted = reviewed and all(
            gate["ok"]
            for gate in stage_gates({"id": requirement.id}, {**flow, "stage": "acceptance"}, tasks, issues)
        )
        self._accepted[requirement_id] = accepted
        self._accepting.remove(requirement_id)
        return accepted

    def verified(self, task_id, trail=frozenset()):
        if task_id in trail:
            return False
        if task_id in self._verified:
            return self._verified[task_id]
        task = self.tasks.get(task_id)
        planning = self.data.get("task_details", {}).get(task_id, {})
        flow = self.data.get("flows", {}).get(task.req_id, {}) if task else {}
        if (
            not task
            or task.status != "completed"
            or planning.get("blocked_reason")
            or flow.get("blocked_reason")
        ):
            return False
        if any(not self.verified(dep, trail | {task_id}) for dep in planning.get("depends_on", [])):
            return False
        if not self.definition(task_id)["execution_gate"]["eligible"]:
            return False
        review = self.reviews.get(task_id)
        manual = (
            task_id not in self.executions
            and review is not None
            and review.decision == "accept"
            and not review.invalidated
            and review.task_basis == self.basis(task_id)
            and (owner := self.owner(task)) is not None
            and owner["kind"] == "human"
            and (not task.req_id or task.req_id in self.requirements)
        )
        # Runtime tasks retain their stricter current run review boundary.
        value = (
            self.native_accepted(task_id)
            if task_id in self.executions
            else (manual or self.requirement_accepted(task.req_id))
        )
        self._verified[task_id] = bool(value)
        return bool(value)

    def blocked(self, task_id):
        return [
            dep
            for dep in self.data.get("task_details", {}).get(task_id, {}).get("depends_on", [])
            if not self.verified(dep, frozenset({task_id}))
        ]


def verified_tasks(db, project, data):
    context = VerificationContext(db, project, data)
    return {task_id for task_id in context.tasks if context.verified(task_id)}
