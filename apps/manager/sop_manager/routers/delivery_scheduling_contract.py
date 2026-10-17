"""Strict civil-date scheduling contracts; units come from actual project resources."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator

Quantity = Annotated[float, Field(strict=True, ge=0, le=100, allow_inf_nan=False)]
Weekday = Annotated[int, Field(strict=True, ge=0, le=6)]
Unit = Literal["hours", "slots"]


class ScheduleInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def civil_date(value):
    if value is None or isinstance(value, date) and not isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("Use an ISO civil date YYYY-MM-DD")
    return date.fromisoformat(value)


CivilDate = Annotated[date, BeforeValidator(civil_date)]


class AllocationInput(ScheduleInput):
    """An explicit daily reservation spanning at most 366 inclusive civil dates."""

    member_id: str = Field(min_length=1, max_length=100)
    starts_on: date
    ends_on: date
    quantity_per_day: Quantity = Field(gt=0)
    weekdays: list[Weekday] = Field(min_length=1, max_length=7)
    _dates = field_validator("starts_on", "ends_on", mode="before")(civil_date)

    @model_validator(mode="after")
    def valid_period(self):
        if self.ends_on < self.starts_on:
            raise ValueError("Reservation dates must be ordered")
        if (self.ends_on - self.starts_on).days > 365:
            raise ValueError("A reservation may span at most 366 inclusive days")
        if len(set(self.weekdays)) != len(self.weekdays):
            raise ValueError("Reservation weekdays must be unique")
        return self


class CalendarException(ScheduleInput):
    date: date
    available: Quantity | None
    note: str = Field(default="", max_length=2000)
    _date = field_validator("date", mode="before")(civil_date)


class CalendarSave(ScheduleInput):
    member_id: str = Field(min_length=1, max_length=100)
    planning_basis: str = Field(pattern=r"^[0-9a-f]{64}$")
    weekly: list[Quantity | None] = Field(min_length=7, max_length=7)
    exceptions: list[CalendarException] = Field(max_length=366)

    @model_validator(mode="after")
    def unique_exceptions(self):
        if len({item.date for item in self.exceptions}) != len(self.exceptions):
            raise ValueError("Calendar exception dates must be unique")
        return self


class ScheduleChange(ScheduleInput):
    task_id: str = Field(min_length=1, max_length=64)
    starts_on: date | None = None
    ends_on: date | None = None
    allocations: list[AllocationInput] | None = Field(default=None, max_length=80)
    _dates = field_validator("starts_on", "ends_on", mode="before")(civil_date)

    @model_validator(mode="after")
    def explicit_change(self):
        if not self.model_fields_set.intersection({"starts_on", "ends_on", "allocations"}):
            raise ValueError("Choose a task planning field to change")
        if "allocations" in self.model_fields_set and self.allocations is None:
            raise ValueError("Use an array, including [] to clear reservations")
        return self


class ScheduleChanges(ScheduleInput):
    planning_basis: str = Field(pattern=r"^[0-9a-f]{64}$")
    changes: list[ScheduleChange] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def unique_tasks(self):
        if len({item.task_id for item in self.changes}) != len(self.changes):
            raise ValueError("Each task may appear only once in a planning batch")
        return self


class StoredAllocation(BaseModel):
    member_id: str
    starts_on: str
    ends_on: str
    quantity_per_day: float
    weekdays: list[int]
    unit: Unit | None


class ResourceCalendar(BaseModel):
    unit: Unit
    weekly: list[float | None]
    exceptions: list[CalendarException]


class ScheduleContribution(BaseModel):
    task_id: str
    title: str
    quantity: float
    active: bool


class ScheduleCell(BaseModel):
    date: str
    available: float | None
    active_load: float
    total_reserved: float
    overload: float | None
    unavailable: bool
    unregistered_count: int
    incomplete: bool
    contributions: list[ScheduleContribution]


class ScheduleResource(BaseModel):
    id: str
    name: str
    kind: Literal["human", "agent", "tool"] | None
    active: bool
    unit: Unit | None
    calendar: ResourceCalendar | None
    cells: list[ScheduleCell]


class ScheduleIssue(BaseModel):
    code: str
    message: str
    member_id: str = ""
    task_id: str = ""


class ScheduledTask(BaseModel):
    id: str
    title: str
    req_id: str
    requirement_title: str
    owner_id: str
    owner_name: str
    owner_active: bool
    status: str
    delivery_status: str
    verified: bool
    milestone_id: str
    sprint_id: str
    task_basis: str
    starts_on: str | None
    ends_on: str | None
    depends_on: list[str]
    dependency_blocked: list[str]
    allocations: list[StoredAllocation]
    issues: list[ScheduleIssue]


class ScheduleScope(BaseModel):
    id: str
    title: str


class ScheduleRange(BaseModel):
    starts_on: str
    ends_on: str


class ScheduleSummary(BaseModel):
    tasks_total: int
    active_tasks: int
    verified_tasks: int
    unscheduled_tasks: int
    incomplete_tasks: int
    overloaded_cells: int
    unavailable_cells: int
    unknown_capacity_cells: int
    issues_by_code: dict[str, int]


class ScheduleResponse(BaseModel):
    project_id: str
    version: int
    planning_basis: str
    as_of: str
    timezone: Literal["UTC"]
    range: ScheduleRange
    permissions: dict[str, bool]
    resources: list[ScheduleResource]
    tasks: list[ScheduledTask]
    milestones: list[ScheduleScope]
    sprints: list[ScheduleScope]
    summary: ScheduleSummary


class TaskScheduleState(BaseModel):
    starts_on: str | None
    ends_on: str | None
    allocations: list[StoredAllocation]


class SchedulePreviewChange(BaseModel):
    task_id: str
    title: str
    before: TaskScheduleState
    after: TaskScheduleState
    fields: list[str]


class SchedulePreviewResponse(BaseModel):
    project_id: str
    version: int
    planning_basis: str
    changes: list[SchedulePreviewChange]
    affected_task_ids: list[str]
