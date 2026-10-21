"""Canonical reported-work origins, projected without reading private report bodies."""
from sqlalchemy import select, union

from .delivery_task_submission_model import DeliveryTaskSubmission, DeliveryTaskSubmissionDecision

SOURCES = (DeliveryTaskSubmission, DeliveryTaskSubmissionDecision)


def external_issue_predicate(issue, project):
    """One scoped SQL set before count/paging, including pre-existing query facts."""
    return issue.id.in_(_external_issue_query(project))


def _external_issue_query(project, selected_ids=None):
    queries = []
    for source in SOURCES:
        query = select(source.issue_id).where(source.tenant_id == project.tenant_id,
            source.project_id == project.id, source.issue_id.is_not(None))
        if selected_ids is not None:
            query = query.where(source.issue_id.in_(selected_ids))
        queries.append(query)
    return union(*queries)


def external_issue_ids(db, project, selected_ids=None):
    if selected_ids is not None and not selected_ids:
        return set()
    return set(db.scalars(_external_issue_query(project, selected_ids)))


def project_external_sources(db, project, items):
    ids = external_issue_ids(db, project, [item["id"] for item in items])
    for item in items:
        sources = [source for source in item.get("source_kinds", []) if source != "external"]
        item["source_kinds"] = sources + (["external"] if item["id"] in ids else [])
