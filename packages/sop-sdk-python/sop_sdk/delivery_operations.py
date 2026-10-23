"""Reviewable eight-action workflow. Prepare once; send/resume only that original."""
from __future__ import annotations

from copy import copy, deepcopy
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
import uuid

from .delivery_ack import (canonical, command_original, strict_json,
    validate_ack, _digest, _identity, _integer)
from .delivery_journal import DeliveryJournal, DeliveryJournalError, MAX_RECORD_BYTES, _validate
from .submission_rework import (adoption, assert_same_source, validate_adoption,
    validate_preview)

COMMAND_PATH = "/api/v1/delivery/commands"
PERMISSION = {"claim": "can_claim", "progress": "can_progress", "cancel": "can_cancel", "release": "can_release", "report": "can_report"}


class DeliveryScopeError(ValueError):
    """The saved server/actor/project differs from the current authenticated scope."""


def _endpoint(value):
    if not isinstance(value, str) or any(ord(c) <= 32 or ord(c) >= 127 for c in value):
        raise DeliveryScopeError("Manager endpoint must be a canonical HTTP(S) URL")
    parts = urlsplit(value)
    if (parts.scheme not in {"http", "https"} or not parts.hostname or parts.username is not None
            or parts.password is not None or parts.query or parts.fragment or "\\" in value):
        raise DeliveryScopeError("Manager endpoint must not contain credentials, query or fragment")
    host = parts.hostname.lower()
    host = "[" + host + "]" if ":" in host else host
    port = parts.port
    authority = host if port is None or port == (443 if parts.scheme == "https" else 80) else host + ":" + str(port)
    path = parts.path.rstrip("/")
    if any(part in {".", ".."} for part in path.split("/")): raise DeliveryScopeError("Manager endpoint path is not canonical")
    return urlunsplit((parts.scheme, authority, path, "", ""))


def _frozen_client(client):
    frozen = copy(client)
    frozen.auth = copy(client.auth)
    frozen.max_retries = 0
    if _endpoint(client.base_url) != _endpoint(str(frozen._client.base_url)):
        raise DeliveryScopeError("Configured Manager server differs from the actual transport endpoint")
    return frozen


def _context(client):
    endpoint = _endpoint(str(client._client.build_request("POST", COMMAND_PATH).url))
    value = client.context_me()
    if not isinstance(value, dict) or value.get("ok") is not True:
        raise ValueError("Current authenticated Manager identity is unavailable")
    user, scope = value.get("user"), value.get("scope")
    if not isinstance(user, dict) or not isinstance(scope, dict): raise ValueError("Current authenticated scope is incomplete")
    actor, tenant = user.get("id"), scope.get("tenant_id")
    _identity(actor); _identity(tenant)
    if user.get("tenant_id") != tenant: raise DeliveryScopeError("Authenticated tenant scope changed")
    result = {"endpoint": endpoint, "actor_id": actor, "tenant_id": tenant}
    for field in ("project_id", "tenant_code", "business_code", "project_code"):
        actual = scope.get(field)
        _identity(actual, 200 if field.endswith("code") else 64)
        configured = getattr(client, field)
        if configured and configured != actual: raise DeliveryScopeError("Manager resolved a different project scope")
        result[field] = actual
    # All subsequent facts/writes use the explicitly resolved scope, held auth
    # instance and held HTTP transport, even if the caller changes its client.
    for field in ("project_id", "tenant_code", "business_code", "project_code"):
        setattr(client, field, result[field])
    return result


def _view(value, scope, *, task=None):
    canonical(value, 1024 * 1024)
    if not isinstance(value, dict) or value.get("project_id") != scope["project_id"]:
        raise ValueError("Manager facts belong to another project")
    _integer(value.get("version"))
    if task is not None and value.get("task_id") != task: raise ValueError("Manager facts belong to another task")
    return value


def _required(value, name):
    if value is not True: raise ValueError("Current Manager facts do not permit " + name)


def _fresh_body(action, payload, version):
    return command_original({"action": action, "payload": payload, "expected_version": version,
        "idempotency_key": "operation-" + uuid.uuid4().hex})


def read_rework_draft(client, task_id, submission_id):
    """Read an explicit S and its authorized seed, without creating a journal."""
    _identity(task_id); _identity(submission_id)
    client = _frozen_client(client)
    scope = _context(client)
    detail = _view(client.delivery_task_submission(task_id, submission_id), scope, task=task_id)
    summary, decision = detail.get("submission"), detail.get("decision")
    if (not isinstance(summary, dict) or summary.get("id") != submission_id or summary.get("task_id") != task_id
            or not isinstance(decision, dict) or decision.get("decision") != "request_changes"):
        raise ValueError("Select an exact returned submission with a human request-changes decision")
    reference = {"submission_id": submission_id, "submission_digest": summary.get("digest"), "decision_id": decision.get("id")}
    preview = validate_preview(client.delivery_task_submission_rework_preview(task_id, {"rework_reference": reference}),
        project_id=scope["project_id"], task_id=task_id, reference=reference)
    if _context(client) != scope: raise DeliveryScopeError("Authenticated source changed while adopting rework")
    return adoption(preview)


class DeliveryOperations:
    """Explicit consumer API; network calls never execute external tools."""

    def __init__(self, client, journal):
        self.client = client
        self.journal = journal if isinstance(journal, DeliveryJournal) else DeliveryJournal(journal)

    def inspect(self, operation_id):
        """Local original/receipt review; no current-project read is required."""
        return self.journal.inspect(operation_id)

    def list(self, **selection):
        return self.journal.list(**selection)

    def finish(self, operation_id):
        """Close a verified ACK's active slot, retaining its complete audit record."""
        return self.journal.finish(operation_id)

    def discard(self, operation_id):
        """Cancel a never-sent draft locally; retain its complete original history."""
        return self.journal.discard(operation_id)

    def _prepare(self):
        client = _frozen_client(self.client)
        return client, _context(client)

    def _save(self, client, scope, body, binding):
        # Identity may expire while facts/preview were being reviewed. A failed
        # second read saves nothing and never manufactures a replacement source.
        if _context(client) != scope: raise DeliveryScopeError("Authenticated source changed during preparation")
        with self.journal.transaction() as tx: return tx.create(scope, body, binding)

    def prepare_work_order_create(self, task_id, executor_member_id, instructions, *, feedback_reference=None):
        _identity(task_id)
        client, scope = self._prepare()
        current = _view(client.delivery_work_order_current(task_id), scope, task=task_id)
        _required(current.get("can_dispatch"), "external dispatch")
        preview_body = {"task_basis": current.get("task_basis"), "executor_member_id": executor_member_id, "instructions": instructions}
        if feedback_reference is not None: preview_body["feedback_reference"] = deepcopy(feedback_reference)
        preview = _view(client.delivery_work_order_preview(task_id, preview_body), scope, task=task_id)
        for field in ("complete", "allowed", "can_dispatch"): _required(preview.get(field), "the reviewed work-package preview")
        executor = preview.get("executor")
        if not isinstance(executor, dict) or executor.get("id") != executor_member_id or executor.get("available") is not True:
            raise ValueError("The selected formal executor is unavailable")
        if preview.get("task_basis") != current.get("task_basis"): raise ValueError("Task source changed before preview")
        _digest(preview.get("packet_digest"))
        payload = {field: preview.get(field) for field in ("task_id", "task_basis", "definition_digest", "native_boundary_digest", "preview_basis")}
        payload.update(executor_member_id=executor_member_id, instructions=instructions)
        if feedback_reference is not None:
            if not isinstance(preview.get("feedback_context"), dict) or preview["feedback_context"].get("reference") != feedback_reference:
                raise ValueError("The preview did not retain the selected original feedback")
            payload["feedback_reference"] = deepcopy(feedback_reference)
        binding = {"task_id": task_id, "work_order_id": None, "request_digest": None, "packet_digest": preview["packet_digest"], "state": None}
        return self._save(client, scope, _fresh_body("work_order.create", payload, preview["version"]), binding)

    def _order(self, client, scope, work_order_id, action):
        _identity(work_order_id)
        detail = _view(client.delivery_work_order(work_order_id), scope)
        w, permissions = detail.get("work_order"), detail.get("permissions")
        if not isinstance(w, dict) or w.get("id") != work_order_id or not isinstance(permissions, dict):
            raise ValueError("The exact work-order detail is incomplete")
        _required(permissions.get(PERMISSION[action]), "work-order " + action)
        _identity(w.get("task_id")); _integer(w.get("order_revision"), 1)
        binding = {"task_id": w["task_id"], "work_order_id": w["id"], "request_digest": w.get("request_digest"), "packet_digest": w.get("packet_digest"), "state": w.get("state")}
        return detail, binding

    def prepare_work_order_action(self, work_order_id, action, **fields):
        action = action.removeprefix("work_order.") if isinstance(action, str) else ""
        if action not in PERMISSION: raise ValueError("Choose claim, progress, cancel, release or report")
        client, scope = self._prepare()
        detail, binding = self._order(client, scope, work_order_id, action)
        payload = {"id": work_order_id, "order_revision": detail["work_order"]["order_revision"], **deepcopy(fields)}
        if action == "report":
            if set(fields) != {"submission_id", "stopped_attestation"} or fields["stopped_attestation"] is not True:
                raise ValueError("Select an exact submission and explicitly attest this external work stopped")
            s = _view(client.delivery_task_submission(binding["task_id"], fields["submission_id"]), scope, task=binding["task_id"])
            summary = s.get("submission")
            if not isinstance(summary, dict) or summary.get("id") != fields["submission_id"] or summary.get("task_id") != binding["task_id"]:
                raise ValueError("The selected submission does not identify this work-order task")
            payload["submission_digest"] = summary.get("digest")
        return self._save(client, scope, _fresh_body("work_order." + action, payload, detail["version"]), binding)

    def prepare_submit(self, task_id, authored, *, work_order_id=None, stopped_attestation=False):
        """Authored results remain explicit; only current immutable bases are filled."""
        _identity(task_id)
        if not isinstance(authored, dict) or set(authored) != {"source", "summary", "artifacts", "criteria", "tests"}:
            raise ValueError("Provide source, summary, artifacts, explicit criteria results and tests")
        canonical(authored)
        if stopped_attestation is not False and stopped_attestation is not True: raise ValueError("Use an explicit stop attestation")
        if bool(work_order_id) != (stopped_attestation is True): raise ValueError("A selected work order requires a new explicit stop attestation")
        client, scope = self._prepare()
        current = _view(client.delivery_task_submission_current(task_id), scope, task=task_id)
        _required(current.get("can_submit"), "an external delivery report")
        payload = deepcopy(authored)
        payload.update({field: current.get(field) for field in ("task_id", "task_basis", "definition_digest", "native_boundary_digest")})
        rows = current.get("criteria")
        if not isinstance(rows, list) or len(rows) > 160: raise ValueError("Current complete acceptance conditions are unavailable")
        bases = {}
        for row in rows:
            if not isinstance(row, dict) or row.get("source") not in {"task", "requirement"}: raise ValueError("Invalid current acceptance condition")
            _integer(row.get("index")); _digest(row.get("text_digest"))
            key = (row["source"], row["index"])
            if key in bases: raise ValueError("Duplicate current acceptance condition")
            bases[key] = row["text_digest"]
        criteria = payload.get("criteria")
        if not isinstance(criteria, list): raise ValueError("Provide explicit acceptance results")
        seen = set()
        for item in criteria:
            if not isinstance(item, dict) or set(item) != {"source", "index", "result", "evidence_ids"}: raise ValueError("Provide each explicit acceptance result without hand-entered digests")
            if not isinstance(item["source"], str): raise ValueError("Identify the current acceptance condition")
            _integer(item["index"])
            key = (item["source"], item["index"])
            if key not in bases or key in seen: raise ValueError("Acceptance results must match the complete current definition")
            seen.add(key); item["text_digest"] = bases[key]
        if seen != set(bases): raise ValueError("Report every current acceptance condition explicitly")
        if work_order_id:
            _identity(work_order_id)
            context = current.get("work_order")
            if not isinstance(context, dict) or context.get("id") != work_order_id: raise ValueError("The selected work order is not the current explicit handoff")
            _integer(context.get("order_revision"), 1)
            payload["work_order"] = {"id": work_order_id, "order_revision": context["order_revision"], "stopped_attestation": True}
        return self._save(client, scope, _fresh_body("task.delivery.submit", payload, current["version"]), {"task_id": task_id})

    def rework_draft(self, task_id, submission_id):
        """Explicitly adopt this S/decision; reset historical author and results."""
        return read_rework_draft(self.client, task_id, submission_id)

    def prepare_rework(self, task_id, adopted, *, work_order_id=None, stopped_attestation=False):
        """Prepare from an adopted complete source, never silently rebase it."""
        _identity(task_id)
        adopted = validate_adoption(adopted, task_id=task_id)
        if type(stopped_attestation) is not bool or bool(work_order_id) != stopped_attestation:
            raise ValueError("A selected current work order requires this attempt's explicit stop attestation")
        client, scope = self._prepare()
        protected = adopted["preview"]
        fresh = validate_preview(client.delivery_task_submission_rework_preview(task_id,
            {"rework_reference": protected["rework_reference"]}), project_id=scope["project_id"],
            task_id=task_id, reference=protected["rework_reference"])
        assert_same_source(protected, fresh)
        current = fresh["current"]
        payload = deepcopy(adopted["authored"])
        payload.update({field: current[field] for field in ("task_id", "task_basis", "definition_digest", "native_boundary_digest")})
        payload.update(rework_reference=deepcopy(protected["rework_reference"]), rework_basis=protected["rework_basis"])
        if work_order_id:
            _identity(work_order_id)
            w = current.get("work_order")
            if not isinstance(w, dict) or w.get("id") != work_order_id:
                raise ValueError("Select this attempt's exact current work order explicitly")
            _integer(w.get("order_revision"), 1)
            payload["work_order"] = {"id": work_order_id, "order_revision": w["order_revision"], "stopped_attestation": True}
        return self._save(client, scope, _fresh_body("task.delivery.submit", payload, fresh["version"]), {"task_id": task_id})

    def prepare_review(self, task_id, submission_id, decision, comment):
        _identity(task_id)
        client, scope = self._prepare()
        detail = _view(client.delivery_task_submission(task_id, submission_id), scope, task=task_id)
        summary, permissions = detail.get("submission"), detail.get("permissions")
        if not isinstance(summary, dict) or summary.get("id") != submission_id or summary.get("task_id") != task_id or not isinstance(permissions, dict):
            raise ValueError("The exact selected submission is unavailable")
        _required(permissions.get("can_review"), "human review")
        if decision == "accept": _required(permissions.get("can_accept"), "acceptance of this exact original")
        payload = {"task_id": task_id, "submission_id": submission_id, "submission_digest": summary.get("digest"),
            "task_basis": detail.get("task_basis"), "native_boundary_digest": detail.get("native_boundary_digest"), "decision": decision, "comment": comment}
        return self._save(client, scope, _fresh_body("task.delivery.review", payload, detail["version"]), {"task_id": task_id})

    def prepare_file(self, path):
        """Import only a complete prepared journal source, including fixed binding.

        Wire-only command files lack historical scope/packet expectations. Unknown
        operations must resume from their existing journal, never be prepared anew.
        """
        with Path(path).open("rb") as handle: raw = handle.read(MAX_RECORD_BYTES + 1)
        imported = _validate(strict_json(raw, MAX_RECORD_BYTES))
        if imported["state"] != "prepared" or imported["active"] is not True:
            raise ValueError("Import only a complete prepared operation; resume unknown operations in their original journal")
        original, fixed_binding = imported["original"], imported["binding"]
        client, scope = self._prepare()
        if scope != imported["scope"]: raise DeliveryScopeError("Imported operation belongs to another authenticated actor/server/project")
        action, p = original["action"], original["payload"]
        if action == "work_order.create":
            proposal = {k: p[k] for k in ("task_basis", "executor_member_id", "instructions", "feedback_reference") if k in p}
            preview = _view(client.delivery_work_order_preview(p["task_id"], proposal), scope, task=p["task_id"])
            for flag in ("complete", "allowed", "can_dispatch"): _required(preview.get(flag), "the exact imported dispatch preview")
            if preview["version"] != original["expected_version"] or any(preview.get(k) != p[k] for k in ("task_basis", "definition_digest", "native_boundary_digest", "preview_basis")):
                raise ValueError("Imported dispatch source changed; retain and inspect this original")
            executor = preview.get("executor")
            if not isinstance(executor, dict) or executor.get("id") != p["executor_member_id"] or executor.get("available") is not True:
                raise ValueError("Imported dispatch executor changed")
            if p.get("feedback_reference") is not None and (not isinstance(preview.get("feedback_context"), dict) or preview["feedback_context"].get("reference") != p["feedback_reference"]):
                raise ValueError("Imported dispatch feedback changed")
            binding = {"task_id": p["task_id"], "work_order_id": None, "request_digest": None, "packet_digest": preview.get("packet_digest"), "state": None}
        elif action.startswith("work_order."):
            detail, binding = self._order(client, scope, p["id"], action.split(".")[-1])
            if detail["version"] != original["expected_version"] or detail["work_order"]["order_revision"] != p["order_revision"]:
                raise ValueError("Imported work-order source changed; never replace its version or revision")
        else:
            binding = {"task_id": p["task_id"]}
            if action == "task.delivery.submit":
                if "rework_reference" in p:
                    preview = validate_preview(client.delivery_task_submission_rework_preview(p["task_id"],
                        {"rework_reference": p["rework_reference"]}), project_id=scope["project_id"],
                        task_id=p["task_id"], reference=p["rework_reference"])
                    if not preview["allowed"] or preview["rework_basis"] != p["rework_basis"]:
                        raise ValueError("Imported adopted rework source changed; never replace its saved basis")
                current = _view(client.delivery_task_submission_current(p["task_id"]), scope, task=p["task_id"])
                _required(current.get("can_submit"), "the imported external report")
                if current["version"] != original["expected_version"] or any(current.get(k) != p[k] for k in ("task_basis", "definition_digest", "native_boundary_digest")):
                    raise ValueError("Imported report source changed; retain the original")
                if p.get("work_order"):
                    w = current.get("work_order")
                    if not isinstance(w, dict) or any(w.get(k) != p["work_order"][k] for k in ("id", "order_revision")):
                        raise ValueError("Imported report handoff changed")
            else:
                d = _view(client.delivery_task_submission(p["task_id"], p["submission_id"]), scope, task=p["task_id"])
                perms, s = d.get("permissions"), d.get("submission")
                if not isinstance(perms, dict) or not isinstance(s, dict): raise ValueError("Imported review facts are unavailable")
                _required(perms.get("can_accept" if p["decision"] == "accept" else "can_review"), "the imported human review")
                if (d["version"] != original["expected_version"] or d.get("task_basis") != p["task_basis"] or d.get("native_boundary_digest") != p["native_boundary_digest"]
                        or s.get("id") != p["submission_id"] or s.get("task_id") != p["task_id"] or s.get("digest") != p["submission_digest"]):
                    raise ValueError("Imported review source changed; retain the original")
        if binding != fixed_binding: raise ValueError("Imported fixed ACK expectations differ from current facts; the saved binding cannot be replaced")
        return self._save(client, scope, original, fixed_binding)

    def send(self, operation_id):
        """One network attempt, with an unknown marker durable before POST."""
        with self.journal.operation_lock(operation_id):
            record = self.journal.inspect(operation_id)
            if record["state"] == "confirmed": return record
            if record["state"] in {"refused", "cancelled"}: raise DeliveryJournalError("This operation was closed without confirmation; review and prepare a new original")
            client = _frozen_client(self.client)
            if _context(client) != record["scope"]: raise DeliveryScopeError("Current authenticated actor/server/project differs from this saved original")
            was_unknown = record["state"] == "unknown"
            record = self.journal.update(operation_id, record["revision"], state="unknown", error=None)
            try:
                ack = client.delivery_command(record["original"])
                ack = validate_ack(record["original"], ack, project_id=record["scope"]["project_id"], binding=record["binding"])
            except Exception as exc:
                status = getattr(exc, "status", None)
                status = status if type(status) is int and 100 <= status <= 599 else None
                # A later denial proves nothing about an earlier unknown POST.
                refused = not was_unknown and status in {400, 401, 403, 404, 409, 413, 422}
                self.journal.update(operation_id, record["revision"], state="refused" if refused else "unknown", active=not refused,
                    error={"code": "refused" if refused else "unconfirmed", "status": status})
                raise
            return self.journal.update(operation_id, record["revision"], state="confirmed", ack=ack, error=None)

    def resume(self, operation_id):
        """Explicit replay of the same saved original; no latest-source lookup."""
        return self.send(operation_id)
