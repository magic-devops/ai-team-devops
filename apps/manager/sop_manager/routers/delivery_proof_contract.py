"""Independent canonical proof budgets and impact counts for composed domains."""
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field

Count = Annotated[int, Field(ge=0)]

class ProofContract(BaseModel):
    model_config = ConfigDict(extra="forbid")

class RequirementReadBudget(ProofContract):
    max_tasks: int = 10000
    max_closure_tasks: int = 10000
    max_requirements: int = 10000
    max_records_per_collection: int = 10000
    max_bytes: int = 16777216
    max_item_bytes: int = 1048576
    max_dependency_depth: int = 64
    task_count: int | None = None
    closure_task_count: int | None = None
    requirement_count: int | None = None
    execution_count: int | None = None
    release_candidate_count: int | None = None
    deployment_count: int | None = None
    bytes_used: int | None = None


class RequirementImpactCounts(ProofContract):
    direct_task: Count
    dependent_task: Count
    execution: Count
    release_candidate: Count
    deployment: Count
    restricted_execution: Count
    restricted_deployment: Count


class RequirementPreviewImpact(ProofContract):
    counts: RequirementImpactCounts | None
    invalidates_current_acceptance: bool | None
