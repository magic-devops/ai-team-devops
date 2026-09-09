from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import CroniterBadCronError, croniter
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import CoreError

MAX_PREVIEW_RUNS = 20
MAX_CRON_LOOKAHEAD_SECONDS = 366 * 24 * 60 * 60 * 2


class ScheduleTrigger(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["interval", "cron", "webhook"] = "interval"
    interval_seconds: int | None = Field(default=None, ge=10, le=31_536_000)
    starts_at: datetime | None = None
    cron_expression: str = Field(default="", max_length=120)
    timezone: str = Field(default="UTC", max_length=100)
    secret_ref: str = Field(default="", pattern=r"^[A-Z_][A-Z0-9_]{0,127}$")
    max_body_bytes: int = Field(default=65_536, ge=1, le=1_048_576)

    @field_validator("starts_at")
    @classmethod
    def utc_start(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("starts_at must include a UTC offset")
        return value.astimezone(timezone.utc)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("timezone must be a valid IANA time zone") from exc
        return value

    @model_validator(mode="after")
    def valid_trigger(self):
        if self.type == "interval":
            if self.interval_seconds is None or self.starts_at is None:
                raise ValueError("interval triggers require interval_seconds and starts_at")
            if self.cron_expression or self.secret_ref:
                raise ValueError("interval triggers cannot include cron or webhook fields")
            return self
        if self.type == "cron":
            if not self.cron_expression.strip():
                raise ValueError("cron triggers require cron_expression")
            if len(self.cron_expression.split()) != 5:
                raise ValueError("cron_expression must contain five fields")
            try:
                croniter(self.cron_expression)
            except CroniterBadCronError as exc:
                raise ValueError("cron_expression is invalid") from exc
            if self.interval_seconds is not None or self.secret_ref:
                raise ValueError("cron triggers cannot include interval or webhook fields")
            return self
        if self.type == "webhook":
            if not self.secret_ref:
                raise ValueError("webhook triggers require secret_ref")
            if self.interval_seconds is not None or self.starts_at is not None or self.cron_expression:
                raise ValueError("webhook triggers cannot include interval or cron fields")
            return self
        return self


def build_trigger_data(trigger: ScheduleTrigger) -> dict[str, Any]:
    if trigger.type == "interval":
        assert trigger.interval_seconds is not None
        assert trigger.starts_at is not None
        return {
            "type": "interval",
            "interval_seconds": trigger.interval_seconds,
            "starts_at": trigger.starts_at.astimezone(timezone.utc).isoformat(),
        }
    if trigger.type == "cron":
        return {
            "type": "cron",
            "cron_expression": trigger.cron_expression.strip(),
            "timezone": trigger.timezone,
            **({"starts_at": trigger.starts_at.astimezone(timezone.utc).isoformat()} if trigger.starts_at else {}),
        }
    return {
        "type": "webhook",
        "secret_ref": trigger.secret_ref,
        "max_body_bytes": trigger.max_body_bytes,
    }


def first_due_after(trigger_data: dict[str, Any], now_utc: datetime) -> datetime | None:
    trigger_type = trigger_data.get("type", "interval")
    if trigger_type == "webhook":
        return None
    if trigger_type == "interval":
        starts_at = parse_utc(trigger_data.get("starts_at"))
        if starts_at is None:
            raise CoreError("schedule_invalid", "Interval schedule is missing starts_at", 409)
        if starts_at >= now_utc:
            return starts_at
        return next_due_after(trigger_data, starts_at, now_utc, True)
    cursor = parse_utc(trigger_data.get("starts_at")) or now_utc
    if cursor < now_utc:
        cursor = now_utc
    return next_due_after(trigger_data, cursor, now_utc, True)


def initial_due_cursor(trigger_data: dict[str, Any], now_utc: datetime) -> datetime | None:
    trigger_type = trigger_data.get("type", "interval")
    if trigger_type == "webhook":
        return None
    if trigger_type == "interval":
        starts_at = parse_utc(trigger_data.get("starts_at"))
        if starts_at is None:
            raise CoreError("schedule_invalid", "Interval schedule is missing starts_at", 409)
        return starts_at
    starts_at = parse_utc(trigger_data.get("starts_at"))
    if starts_at is None:
        return first_due_after(trigger_data, now_utc)
    return next_due_after(trigger_data, starts_at, starts_at, False)


def next_due_after(trigger_data: dict[str, Any], due_at: datetime, current_time: datetime, coalesce: bool) -> datetime | None:
    trigger_type = trigger_data.get("type", "interval")
    if trigger_type == "webhook":
        return None
    if trigger_type == "interval":
        interval_seconds = int(trigger_data["interval_seconds"])
        if coalesce:
            missed = max(0, int((current_time.timestamp() - due_at.timestamp()) // interval_seconds) + 1)
            return datetime.fromtimestamp(due_at.timestamp() + missed * interval_seconds, timezone.utc)
        return datetime.fromtimestamp(due_at.timestamp() + interval_seconds, timezone.utc)
    return next_cron_after(str(trigger_data["cron_expression"]), str(trigger_data["timezone"]), due_at)


def preview_next_runs(trigger_data: dict[str, Any], from_time: datetime, *, count: int = 5) -> list[str]:
    count = max(0, min(count, MAX_PREVIEW_RUNS))
    runs: list[str] = []
    due_at = first_due_after(trigger_data, from_time)
    while due_at is not None and len(runs) < count:
        runs.append(due_at.isoformat())
        due_at = next_due_after(trigger_data, due_at, due_at, False)
    return runs


def parse_utc(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(timezone.utc)


def next_cron_after(expression: str, timezone_name: str, cursor_utc: datetime) -> datetime:
    tz = ZoneInfo(timezone_name)
    base = cursor_utc.astimezone(tz)
    try:
        value = croniter(expression, base, max_years_between_matches=2).get_next(datetime)
    except CroniterBadCronError as exc:
        raise CoreError("cron_invalid", "Cron expression is invalid", 422) from exc
    if value.tzinfo is None or value.utcoffset() is None:
        value = value.replace(tzinfo=tz)
    result = value.astimezone(timezone.utc)
    if result.timestamp() - cursor_utc.astimezone(timezone.utc).timestamp() > MAX_CRON_LOOKAHEAD_SECONDS:
        raise CoreError("cron_no_due", "Cron expression has no due time within bounded preview window", 422)
    return result
