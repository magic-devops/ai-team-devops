"""Current delivery proof without materialization, progress capture or SQL writes."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from copy import deepcopy

from sqlalchemy import func

from .delivery_contract import default_flow, stage_gates
from .delivery_task_contract import delivery_task_definition, semantic_snapshot, snapshots_match
from .delivery_team import TeamContext
from .sql_models import DeliveryTaskReview, Issue, Requirement, Task


def fingerprint(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


class VerificationContext:
    """One authorized project's canonical rows and effective approval facts."""

    def __init__(
        self, db, project, data, *, tasks=None, requirements=None, issues=None, reviews=None, team=None,
        external_proofs=None, latest_submissions=None, design_selections=None,
    ):
        self.project, self.data = project, data

        def scoped(model):
            return db.query(model).filter_by(tenant_id=project.tenant_id, project_id=project.id).all()

        self.tasks = {row.id: row for row in (scoped(Task) if tasks is None else tasks)}
        self.requirements = {
            row.id: row for row in (scoped(Requirement) if requirements is None else requirements)
        }
        self.issues = scoped(Issue) if issues is None else issues
        self.tasks_by_requirement = defaultdict(list)
        self.issues_by_task = defaultdict(list)
        for task in self.tasks.values():
            self.tasks_by_requirement[task.req_id].append(task)
        for issue in self.issues:
            self.issues_by_task[issue.task_id].append(issue)
        self.team = team if team is not None else TeamContext(db, project, data)
        self.roster = self.team.roster
        self.executions = {entry["task_id"]: entry for entry in data.get("executions", [])}
        if reviews is None:
            latest = (
                db.query(func.max(DeliveryTaskReview.seq).label("seq"))
                .filter_by(tenant_id=project.tenant_id, project_id=project.id)
                .group_by(DeliveryTaskReview.task_id)
                .subquery()
            )
            reviews = db.query(DeliveryTaskReview).join(latest, DeliveryTaskReview.seq == latest.c.seq)
        self.reviews = {row.task_id: row for row in reviews}
        from .delivery_task_submission_service import load_external_proofs, load_latest_submissions

        self.external_proofs = external_proofs if external_proofs is not None else load_external_proofs(
            db, project, self.tasks, reviews=self.reviews.values())
        self.latest_submissions = latest_submissions if latest_submissions is not None else load_latest_submissions(db, project, self.tasks)
        from .design_service import load_design_selections

        self.design_selections = design_selections if design_selections is not None else load_design_selections(db, project, self.requirements, self.tasks)
        self.reset_proof()

    def reset_proof(self):
        """Reconciliation mutates effective metadata before proof can be reused."""
        self._snapshots, self._definitions, self._verified, self._accepted = {}, {}, {}, {}
        self._bases = {}
        self._accepting = set()

    def owner(self, task):
        return self.team.resolve_owner(task.owner_id)

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
                    "snapshot": semantic_snapshot(self.snapshot(predecessor, trail | {task_id})),
                    "verified": self.verified(predecessor, trail | {task_id}),
                }
            )
        from .design_service import design_basis, effective_designs

        _own_designs, designs = effective_designs(self.design_selections, "task", task_id, task.req_id)
        value = {
            "designs": designs,
            "design_basis": design_basis(designs),
            "task": {
                "id": task.id,
                "title": task.title,
                "description": task.description or "",
                "acceptance_criteria": task.acceptance_criteria,
                "req_id": task.req_id or "",
                "status": task.status,
                "owner_id": task.owner_id,
                "assigned_to": (self.owner(task) or {}).get("name") or "",
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
            requirement_revision=flow["revision"], designs=designs,
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
            for key in ("id", "req_id", "title", "description", "owner_id", "acceptance_criteria")
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
        owner = self.owner(task)
        if owner is None:
            reasons.append(
                {
                    "code": "task_owner_missing",
                    "message": "Assign a responsible person or agent before dispatch.",
                }
            )
        elif not owner["available"]:
            reasons.append(
                {
                    "code": "task_owner_unavailable",
                    "message": "The responsible identity is unavailable; choose an active project person or agent.",
                }
            )
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
        from .delivery_task_submission_service import native_takeover_closed

        replaced_failed = bool(entry and entry["status"] == "failed" and native_takeover_closed(self, entry))
        if replaced_failed and task.status == "blocked":
            reasons.append({"code": "task_dispatch_reopen_required", "message": "Explicitly reopen the task before preparing a new native execution after external takeover."})
        if entry and entry["status"] not in {"accepted", "changes_requested", "cancelled"} and not replaced_failed:
            reasons.append(
                {
                    "code": "task_execution_active",
                    "message": "Review or cancel the current execution before redispatch.",
                }
            )
        return {"eligible": not reasons, "reasons": reasons}

    def basis(self, task_id):
        if task_id not in self._bases:
            self._bases[task_id] = fingerprint(semantic_snapshot(self.snapshot(task_id)))
        return self._bases[task_id]

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
        return self.execution_snapshot_current(entry)

    def execution_snapshot_current(self, entry):
        definition = self.definition(entry["task_id"])
        return bool(
            definition
            and definition["execution_gate"]["eligible"]
            and not entry.get("planning_invalidated")
            and definition["snapshot"]["owner"]
            and definition["snapshot"]["owner"]["available"]
            and snapshots_match(entry.get("snapshot"), definition["snapshot"])
        )

    def pending_executor_binding_invalidated(self, entry):
        """An affiliation gate before handoff; never part of task scope or proof."""
        if (
            entry.get("run_id")
            or not entry.get("executor_member_id")
            or entry.get("status") in {"accepted", "changes_requested", "cancelled"}
        ):
            return False
        if entry.get("executor_binding_invalidated") or not entry.get("executor_snapshot"):
            return True
        from .delivery_team_runtime import execution_binding_current

        return not execution_binding_current(
            self.project, self.data, entry["executor_member_id"], entry.get("executor_binding_basis", "")
        )["current"]

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

    def external_accepted(self, task_id):
        from .delivery_task_submission_service import external_review_valid

        review = self.reviews.get(task_id)
        proof = self.external_proofs.get(review.id) if review else None
        return bool(external_review_valid(self, task_id, review, proof)
                    and snapshots_match(review.snapshot, self.snapshot(task_id)))

    def delivery_accepted(self, task_id):
        from .delivery_task_submission_service import current_submission, external_is_latest_delivery

        review = self.reviews.get(task_id)
        proof = self.external_proofs.get(review.id) if review else None
        submitted = current_submission(self, task_id)
        if submitted:
            return bool(proof and proof["id"] == submitted["id"] and self.external_accepted(task_id))
        if proof and external_is_latest_delivery(self, task_id, proof):
            return self.external_accepted(task_id)
        return self.native_accepted(task_id)

    def delivery_status(self, task_id):
        """One six-state delivery vocabulary shared by progress and scheduling."""
        task = self.tasks[task_id]
        planned = self.data.get("task_details", {}).get(task_id, {})
        flow = self.data.get("flows", {}).get(task.req_id, {})
        from .delivery_task_submission_service import current_submission

        submitted = current_submission(self, task_id)
        if (submitted and not submitted["decision_id"]
                and not planned.get("blocked_reason") and not flow.get("blocked_reason") and not self.blocked(task_id)):
            return "awaiting_review"
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
        linked = self.tasks_by_requirement.get(requirement_id, [])
        for task in linked:
            status = task.status
            if self.data.get("task_details", {}).get(task.id, {}).get("blocked_reason"):
                status = "blocked"
            elif ((task.id in self.executions or task.id in self.latest_submissions or self.reviews.get(task.id) and self.reviews[task.id].id in self.external_proofs)
                  and not self.delivery_accepted(task.id) and status == "completed"):
                status = "in_progress"
            tasks.append(
                {
                    "id": task.id,
                    "req_id": task.req_id,
                    "status": status,
                    "acceptance": self.acceptance(task.id),
                    "owner_id": task.owner_id,
                    "owner_active": bool(self.owner(task) and self.owner(task)["available"]),
                }
            )
        issues = [
            {"task_id": issue.task_id, "status": issue.status, "severity": issue.severity}
            for task in linked
            for issue in self.issues_by_task.get(task.id, [])
        ]
        accepted = reviewed and all(
            gate["ok"]
            for gate in stage_gates({"id": requirement.id}, {**flow, "stage": "acceptance"}, tasks, issues, designs=self.design_selections.get(("requirement", requirement.id), []))
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
        owner = self.owner(task)
        if owner is None or not owner["available"]:
            return False
        review = self.reviews.get(task_id)
        manual = (
            task_id not in self.executions
            and review is not None
            and review.decision == "accept"
            and not review.invalidated
            and snapshots_match(review.snapshot, self.snapshot(task_id))
            and (not task.req_id or task.req_id in self.requirements)
        )
        from .delivery_task_submission_service import current_submission

        # A current fixed report cannot borrow manual or older native approval.
        value = (self.delivery_accepted(task_id) if current_submission(self, task_id) or review and review.id in self.external_proofs else
                 self.native_accepted(task_id) if task_id in self.executions else
                 (manual or self.requirement_accepted(task.req_id)))
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
