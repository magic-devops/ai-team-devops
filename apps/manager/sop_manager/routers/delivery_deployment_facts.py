"""Current business release facts combine immutable approval and physical evidence."""

from .delivery_deployment import deployment_verified_for_release


def current_deployed_requirement_ids(db, project, data, *, verification=None):
    from .delivery_release import _candidate_reasons

    deployed = set()
    if not data.get("deployments"):
        return deployed
    for candidate in data.get("release_candidates", []):
        if (
            candidate["decision"] == "approved"
            and not candidate.get("invalidated")
            and deployment_verified_for_release(data, candidate["id"])
            and not _candidate_reasons(db, project, data, candidate, verification=verification)
        ):
            deployed.update(candidate["snapshot"]["selected"]["requirement_ids"])
    return deployed


def release_deployment_view(data, candidate_id, *, business_valid):
    rows = [row for row in data.get("deployments", []) if row["candidate_id"] == candidate_id]
    if not rows:
        return {"status": "not_handed_off", "verified": False, "deployment_id": None}
    current = deployment_verified_for_release(data, candidate_id)
    row = next(
        (
            item
            for item in reversed(rows)
            if current and item["status"] in {"verified", "rolled_back"} and item.get("actual_traffic") == 100
        ),
        rows[-1],
    )
    verified = current and business_valid
    status = row["status"]
    if status in {"verified", "rolled_back"} and not verified:
        status = "superseded"
    return {"status": status, "verified": verified, "deployment_id": row["id"]}
