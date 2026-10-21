"""Thin, scoped activity facts for delivery progress; never read a packet body."""

from sqlalchemy import select

from .delivery_external_work_order_model import DeliveryExternalWorkOrder as Order


def active_activity(db, project, task_ids):
    """A held slot stays active even when stale or cancellation was requested."""
    selected = set(task_ids)
    if not selected:
        return {}
    rows = db.execute(
        select(Order.active_task_id, Order.state, Order.progress["status"].as_string(),
               Order.id, Order.claimed_by["id"].as_string())
        .where(Order.tenant_id == project.tenant_id, Order.project_id == project.id,
               Order.active_task_id.in_(selected))
    )
    return {
        task_id: {"state": state, "reported_status": status, "id": identity, "claimant_id": claimant}
        for task_id, state, status, identity, claimant in rows
    }
