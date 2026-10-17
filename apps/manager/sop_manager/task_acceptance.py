"""Canonical task acceptance criteria shared by API, import and SQL writers."""

from typing import Annotated, Any

from pydantic import BeforeValidator, Field, StringConstraints


def normalize_task_acceptance(value: Any) -> list[str]:
    """Reject requirement indices and coercion; preserve the caller's criterion order."""
    if not isinstance(value, list) or len(value) > 80:
        raise ValueError("acceptance_criteria must be a list of at most 80 text criteria")
    result = []
    for criterion in value:
        if not isinstance(criterion, str) or not criterion.strip() or len(criterion.strip()) > 2000:
            raise ValueError("acceptance_criteria entries must be nonblank text of at most 2000 characters")
        result.append(criterion.strip())
    return result


TaskAcceptanceCriteria = Annotated[
    list[Annotated[str, StringConstraints(strict=True, min_length=1, max_length=2000)]],
    Field(max_length=80), BeforeValidator(normalize_task_acceptance),
]
