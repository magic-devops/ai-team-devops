"""Pure canonical task delivery definition shared by every evidence consumer."""

import hashlib
import json
from copy import deepcopy


def requirement_definition(requirement):
    return {
        key: requirement.get(key) or ([] if key == "acceptance_criteria" else "")
        for key in ("id", "title", "description", "acceptance_criteria")
    }


def requirement_definition_basis(requirement):
    return hashlib.sha256(
        json.dumps(
            requirement_definition(requirement), sort_keys=True, ensure_ascii=False, default=str
        ).encode()
    ).hexdigest()


def _criteria(value):
    return (
        isinstance(value, list)
        and len(value) <= 80
        and all(isinstance(item, str) and bool(item.strip()) and len(item.strip()) <= 2000 for item in value)
    )


def delivery_task_definition(task, requirement, planning, owner, dependency_basis, *, requirement_revision=0):
    """Resolve explicit references; never query, mutate, infer inheritance or repair old data."""
    reasons = []

    def reject(code, message):
        reasons.append({"code": code, "message": message})

    own = task.get("acceptance_criteria")
    if not _criteria(own):
        reject(
            "task_acceptance_invalid",
            "Task acceptance conditions are unavailable or invalid; define them explicitly.",
        )
        own = []
    own = [text.strip() for text in own]
    refs = planning.get("requirement_criteria_indices", [])
    refs_valid = (
        isinstance(refs, list)
        and len(refs) <= 80
        and all(type(index) is int and index >= 0 for index in refs)
        and len(set(refs)) == len(refs)
    )
    if not refs_valid:
        reject("task_requirement_criteria_invalid", "Select valid requirement acceptance conditions.")
        refs = []
    linked = bool(task.get("req_id"))
    if linked and (not requirement or requirement.get("id") != task["req_id"]):
        reject("task_requirement_missing", "The linked requirement is no longer in this project.")
        requirement = None
    if refs and not linked:
        reject(
            "task_requirement_criteria_invalid",
            "An independent task cannot reference requirement conditions.",
        )
    if requirement and refs:
        if not _criteria(requirement.get("acceptance_criteria")) or any(
            index >= len(requirement["acceptance_criteria"]) for index in refs
        ):
            reject(
                "task_requirement_criteria_invalid", "A selected condition is missing from the requirement."
            )
        elif planning.get("requirement_basis") != requirement_definition_basis(requirement):
            reject(
                "task_requirement_basis_changed",
                "Requirement changed; explicitly adopt its current conditions before delivery.",
            )
    sources = [{"source": "task", "index": index, "text": text} for index, text in enumerate(own)]
    if not reasons and requirement:
        sources.extend(
            {
                "source": "requirement",
                "index": index,
                "text": requirement["acceptance_criteria"][index].strip(),
            }
            for index in refs
        )
    acceptance = {
        "criteria": [source["text"] for source in sources],
        "sources": sources,
        "available": not reasons,
        "requirement_id": task.get("req_id") or None,
        "requirement_revision": requirement_revision if requirement else None,
    }
    if not acceptance["criteria"] and not reasons:
        reject(
            "task_acceptance_missing",
            "Define at least one task condition or explicitly select a requirement condition before delivery.",
        )
    snapshot = {
        "task_id": task["id"],
        "title": task.get("title") or "",
        "description": task.get("description") or "",
        "assigned_to": task.get("assigned_to") or "",
        "task_acceptance_criteria": own,
        "acceptance_criteria": acceptance["criteria"],
        "requirement": None
        if not requirement
        else {
            **requirement_definition(requirement),
            "revision": requirement_revision,
            "criteria_indices": deepcopy(refs),
        },
        "owner": deepcopy(owner),
        "dependency_basis": deepcopy(dependency_basis),
    }
    return {
        "snapshot": snapshot,
        "acceptance": acceptance,
        "execution_gate": {"eligible": not reasons, "reasons": reasons},
    }
