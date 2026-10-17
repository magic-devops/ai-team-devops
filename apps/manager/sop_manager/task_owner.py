"""Canonical Task owner IDs and shared scoped write validation."""

from typing import Annotated, Any

from fastapi import HTTPException
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator


def normalize_task_owner_id(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 100 or value != value.strip() or any(ord(char) < 32 for char in value):
        raise ValueError("owner_id must be a stable member ID of at most 100 characters or an empty string")
    return value


TaskOwnerId = Annotated[str, Field(strict=True, max_length=100), BeforeValidator(normalize_task_owner_id)]


class TaskOwnerInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def require_owner_id(cls, values):
        if isinstance(values, dict) and "assigned_to" in values:
            raise ValueError("assigned_to is read-only; write owner_id")
        return values


def validate_task_owner_values(db, project, values: dict) -> dict:
    from .routers.delivery_team import validate_task_owner

    if "assigned_to" in values:
        raise HTTPException(422, {"code": "task_owner_id_required", "message": "assigned_to is read-only; write owner_id"})
    result = dict(values)
    if "owner_id" in result:
        try:
            result["owner_id"] = normalize_task_owner_id(result["owner_id"])
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        validate_task_owner(db, project, result["owner_id"])
    return result
