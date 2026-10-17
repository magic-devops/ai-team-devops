"""Task-local acceptance is distinct from selected requirement criteria."""

import pytest
from pydantic import ValidationError
from sop_manager.routers.delivery_contract import TaskCreate, TaskDraft, TaskEdit, default_flow, stage_gates
from sop_manager.routers.delivery_execution_contract import ExecutionSnapshot


def test_task_contract_has_text_criteria_and_explicit_requirement_references():
    draft = TaskDraft(
        title="Standalone delivery",
        acceptance_criteria=["  Check the produced artifact  "],
        requirement_criteria_indices=[0],
    )
    assert draft.acceptance_criteria == ["Check the produced artifact"]
    assert draft.requirement_criteria_indices == [0]
    assert TaskCreate(title="Independent").requirement_id == ""


@pytest.mark.parametrize("criteria", [[0], [" "], ["x" * 2001], ["x"] * 81])
def test_task_criteria_are_bounded_text(criteria):
    with pytest.raises(ValidationError):
        TaskDraft(title="Task", acceptance_criteria=criteria)


def test_condition_changes_require_exact_task_basis_and_explicit_arrays():
    for changes in (
        {"acceptance_criteria": []},
        {"requirement_criteria_indices": []},
        {"depends_on": []},
        {"owner_id": "user:owner"},
    ):
        with pytest.raises(ValidationError):
            TaskEdit(id="task", **changes)
        TaskEdit(id="task", task_basis="a" * 64, **changes)
    with pytest.raises(ValidationError):
        TaskEdit(id="task", task_basis="a" * 64, acceptance_criteria=None)


@pytest.mark.parametrize("owner_id", [None, True, 17, " user:lead", "user:lead\n"])
@pytest.mark.parametrize("model", [TaskDraft, TaskEdit])
def test_task_owner_ids_are_strict_nonnullable_stable_ids(model, owner_id):
    values = {"title": "Task"} if model is TaskDraft else {"id": "task", "task_basis": "a" * 64}
    with pytest.raises(ValidationError):
        model(**values, owner_id=owner_id)


def test_owner_edit_uses_exclude_unset_to_distinguish_clear_from_omission():
    omitted = TaskEdit(id="task", description="Text edit")
    assert omitted.owner_id == ""
    assert "owner_id" not in omitted.model_dump(exclude_unset=True)
    cleared = TaskEdit(id="task", owner_id="", task_basis="a" * 64)
    assert cleared.model_dump(exclude_unset=True)["owner_id"] == ""


def test_native_task_snapshot_has_real_optional_requirement():
    data = dict(
        task_id="task",
        title="Independent task",
        description="Deliver an artifact",
        assigned_to="",
        task_acceptance_criteria=["Artifact passes"],
        acceptance_criteria=["Artifact passes"],
        owner=None,
        dependency_basis={},
        requirement=None,
    )
    assert ExecutionSnapshot(**data).requirement is None
    data["requirement"] = dict(
        id="req",
        title="Requirement",
        description="Scope",
        revision=2,
        acceptance_criteria=["Requirement condition"],
        criteria_indices=[0],
    )
    assert ExecutionSnapshot(**data).requirement.revision == 2


@pytest.mark.parametrize(
    "acceptance",
    [None, {}, {"available": True, "criteria": []}, {"available": False, "criteria": ["Old source"]}],
)
def test_requirement_progress_cannot_bypass_task_acceptance(acceptance):
    task = {"id": "task", "req_id": "req", "status": "completed", "acceptance": acceptance}
    gates = stage_gates({"id": "req"}, {**default_flow(), "stage": "development"}, [task], [])
    assert next(gate for gate in gates if gate["id"] == "task_acceptance")["ok"] is False
