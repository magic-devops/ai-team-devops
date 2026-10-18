"""Attach a selected conclusion to the original atomic business result."""


def prepare_adoption(db, project, user, command, request):
    if command.source_reference is None:
        return None
    from .delivery_discussion_sources import validate_source_reference

    store = getattr(request.app.state, "hermes_store", None) if request else None
    return validate_source_reference(db, project, user, command.source_reference, store=store)


def record_adoption(db, project, user, source, command, payload, ack, event):
    if source is None:
        return
    from .delivery_discussion_sources import record_adoption_links

    kind = "task" if command.action in {"task.update", "tasks.plan"} else "requirement"
    targets = [ref for ref in ack["affected_refs"] if ref["kind"] == kind]
    # These are submitted business fields, not a claim that every value changed.
    control_fields = {
        "id", "issue_id", "requirement_id", "diagnosis_id", "requirement_basis",
        "change_preview_basis", "task_basis", "planning_basis", "preview_id",
        "preview_basis", "basis", "issue_basis",
    }
    applied_fields = sorted(payload.model_fields_set - control_fields)
    record_adoption_links(
        db, project, user, source, targets,
        business_event_id=event.id, applied_fields=applied_fields,
    )
