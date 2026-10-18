"""A selected discussion conclusion is explicit provenance for existing writes."""

import pytest
from pydantic import ValidationError
from sop_manager.routers.delivery_contract import Command


def selected_source(**changes):
    return {
        "thread_id": "thread-fixed",
        "expected_thread_version": 4,
        "resolution_event_id": "decision-fixed",
        "message_id": "message-fixed",
        "message_revision": 2,
        **changes,
    }


def command(action="requirement.update", source=None):
    return {
        "action": action,
        "expected_version": 7,
        "idempotency_key": "fixed-command-retry",
        "payload": {"id": "business-object"},
        "source_reference": selected_source() if source is None else source,
    }


@pytest.mark.parametrize(
    "action", ["requirement.update", "task.update", "tasks.plan", "issue.promote", "issue.diagnosis.adopt"]
)
def test_existing_business_write_can_pin_one_exact_conclusion_without_polluting_its_payload(action):
    value = Command.model_validate(command(action))
    assert value.source_reference.model_dump() == selected_source()
    assert value.payload == {"id": "business-object"}


@pytest.mark.parametrize("action", ["task.manual_review", "execution.queue", "stage.advance", "project.update"])
def test_provenance_cannot_turn_discussion_resolution_into_approval_or_execution(action):
    with pytest.raises(ValidationError):
        Command.model_validate(command(action))


@pytest.mark.parametrize(
    "source",
    [
        selected_source(expected_thread_version=True),
        selected_source(expected_thread_version=0),
        selected_source(expected_thread_version="4"),
        selected_source(message_revision=False),
        selected_source(message_revision=1.5),
        selected_source(message_revision=0),
        selected_source(thread_id=" "),
        selected_source(resolution_event_id=""),
        selected_source(message_id="x" * 65),
        selected_source(author_id="forged"),
        selected_source(body="forged trusted conclusion"),
    ],
)
def test_source_rejects_ambiguous_versions_forged_content_and_identity(source):
    with pytest.raises(ValidationError):
        Command.model_validate(command(source=source))


def test_source_is_optional_and_absence_has_one_canonical_request_meaning():
    body = command()
    body.pop("source_reference")
    absent = Command.model_validate(body)
    explicit_null = Command.model_validate({**body, "source_reference": None})
    assert absent.source_reference is None
    assert absent.model_dump_json(exclude_none=True) == explicit_null.model_dump_json(exclude_none=True)
    assert "source_reference" not in absent.model_dump(exclude_none=True)
