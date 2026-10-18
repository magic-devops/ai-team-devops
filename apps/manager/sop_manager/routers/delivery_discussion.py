"""Independent discussion transactions; no business workspace or observation writes."""

from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import update

from ..project_write_guard import discussion_write_scope, require_project_operation
from . import sql_models as m
from .delivery_discussion_common import (
    authorize,
    digest,
    entity,
    fail,
    identifier,
    message,
    now,
    scope,
    thread,
    version,
)
from .delivery_discussion_sources import (
    assert_runtime_scopes,
    canonical_basis,
    record_adoption_links,
    reference_scopes,
    resolve_reference,
    validate_source_reference,
)


def _receipt(db, project, user, key, fingerprint, store):
    row = db.get(m.DeliveryDiscussionReceipt, key, populate_existing=True)
    if row is None:
        return None
    if (row.tenant_id, row.project_id) != (project.tenant_id, project.id) or row.request_hash != fingerprint:
        fail("discussion_idempotency_conflict", "Idempotency key already used with different input")
    assert_runtime_scopes(store, user, project, row.runtime_scopes)
    return {**deepcopy(row.original_ack), "replayed": True}


def _selected_refs(db, project, user, values, store):
    return [resolve_reference(db, project, user, value, store=store) for value in values]


def _version(db, project, user, current, revision, *, body, refs, state="active", reason=None):
    row = m.DeliveryDiscussionMessageVersion(
        message_id=current.id,
        revision=revision,
        tenant_id=project.tenant_id,
        project_id=project.id,
        thread_id=current.thread_id,
        body=body,
        refs=refs,
        state=state,
        reason=reason,
        editor_id=user.id,
        editor_name=user.username,
    )
    db.add(row)
    db.flush()
    return row


def _new_message(db, project, user, current_thread, body, refs, parent=None):
    if parent:
        message(db, project, current_thread.id, parent)
    row = m.DeliveryDiscussionMessage(
        id=identifier(),
        tenant_id=project.tenant_id,
        project_id=project.id,
        thread_id=current_thread.id,
        parent_message_id=parent,
        author_id=user.id,
        author_name=user.username,
        current_revision=1,
    )
    db.add(row)
    db.flush()
    _version(db, project, user, row, 1, body=body, refs=refs)
    return row


def _advance(db, project, current, values):
    with discussion_write_scope(db, project.tenant_id, project.id):
        result = db.execute(
            update(m.DeliveryDiscussionThread)
            .where(
                *scope(project, m.DeliveryDiscussionThread),
                m.DeliveryDiscussionThread.id == current.id,
                m.DeliveryDiscussionThread.version == current.version,
            )
            .values(version=current.version + 1, last_activity_at=now(), **values)
        )
    if result.rowcount != 1:
        fail("discussion_conflict", "Discussion changed concurrently")
    db.refresh(current)


class _Mutation:
    """One locked command; action helpers never commit or evaluate business state."""

    def __init__(self, db, project, user, permissions, body, action, thread_id, message_id, store):
        self.db, self.project, self.user = db, project, user
        self.permissions, self.body, self.action = permissions, body, action
        self.thread_id, self.message_id, self.store = thread_id, message_id, store
        self.refs, self.selected, self.link_id = [], None, None
        self.changes, self.event_data = {}, {}
        self.current = None

    def _create(self):
        body, project, user = self.body, self.project, self.user
        entity(self.db, project, body.subject_kind, body.subject_id)
        self.refs = _selected_refs(self.db, project, user, body.refs, self.store)
        self.current = m.DeliveryDiscussionThread(
            id=identifier(),
            tenant_id=project.tenant_id,
            project_id=project.id,
            subject_kind=body.subject_kind,
            subject_id=body.subject_id,
            title=body.title,
            created_by_id=user.id,
            created_by_name=user.username,
            version=1,
            state="open",
        )
        self.db.add(self.current)
        self.db.flush()
        self.selected = _new_message(self.db, project, user, self.current, body.body, self.refs)

    def _check_current(self):
        current, body, action = self.current, self.body, self.action
        if current.state == "archived" and action != "restore":
            fail("discussion_archived", "Restore the archived discussion before writing")
        if (
            action in {"reply", "edit", "resolve"}
            and entity(self.db, self.project, current.subject_kind, current.subject_id, required=False)
            is None
        ):
            fail("discussion_subject_missing", "Discussion subject was deleted; history remains readable")
        if (
            action in {"resolve", "reopen", "archive", "restore", "link"}
            and current.version != body.expected_thread_version
        ):
            fail("discussion_conflict", "Discussion version changed")

    def _reply(self):
        self.refs = _selected_refs(self.db, self.project, self.user, self.body.refs, self.store)
        self.selected = _new_message(
            self.db,
            self.project,
            self.user,
            self.current,
            self.body.body,
            self.refs,
            self.body.parent_message_id,
        )
        if self.current.state == "resolved":
            self.changes.update(state="open", current_resolution_event_id=None)

    def _replace_message(self, revision):
        db, project, selected, body = self.db, self.project, self.selected, self.body
        with discussion_write_scope(db, project.tenant_id, project.id):
            result = db.execute(
                update(m.DeliveryDiscussionMessage)
                .where(
                    *scope(project, m.DeliveryDiscussionMessage),
                    m.DeliveryDiscussionMessage.id == selected.id,
                    m.DeliveryDiscussionMessage.current_revision == body.expected_message_revision,
                )
                .values(current_revision=revision)
            )
        if result.rowcount != 1:
            fail("discussion_conflict", "Message changed concurrently")
        db.refresh(selected)
        editing = self.action == "edit"
        _version(
            db,
            project,
            self.user,
            selected,
            revision,
            body=body.body if editing else None,
            refs=self.refs,
            state="active" if editing else "withdrawn",
            reason=None if editing else body.reason,
        )

    def _reopen_selected_conclusion(self):
        if not self.current.current_resolution_event_id:
            return
        event = (
            self.db.query(m.DeliveryDiscussionEvent)
            .filter_by(id=self.current.current_resolution_event_id)
            .one()
        )
        if event.data.get("message_id") == self.selected.id:
            self.changes.update(state="open", current_resolution_event_id=None)

    def _edit(self):
        selected = self.selected = message(self.db, self.project, self.current.id, self.message_id)
        if self.user.id != selected.author_id and (
            self.action == "edit" or not self.permissions["configure"]
        ):
            raise HTTPException(
                403, "Only the original author can edit; configure permission allows withdrawal"
            )
        if selected.current_revision != self.body.expected_message_revision:
            fail("discussion_conflict", "Message revision changed")
        previous = version(self.db, self.project, self.current.id, selected.id, selected.current_revision)
        if previous.state == "withdrawn":
            fail("discussion_conflict", "Message is already withdrawn")
        if self.action == "edit":
            self.refs = (
                deepcopy(previous.refs)
                if self.body.refs is None
                else _selected_refs(self.db, self.project, self.user, self.body.refs, self.store)
            )
        assert_runtime_scopes(self.store, self.user, self.project, reference_scopes(self.refs))
        self._replace_message(selected.current_revision + 1)
        self._reopen_selected_conclusion()

    def _resolve(self):
        selected = self.selected = message(self.db, self.project, self.current.id, self.body.message_id)
        chosen = version(self.db, self.project, self.current.id, selected.id, self.body.message_revision)
        if chosen.state != "active" or selected.current_revision != self.body.message_revision:
            fail("discussion_conflict", "Select the current active message revision")
        self.refs = deepcopy(chosen.refs)
        assert_runtime_scopes(self.store, self.user, self.project, reference_scopes(self.refs))
        self.changes.update(state="resolved", current_resolution_event_id=identifier())
        self.event_data.update(
            message_id=selected.id,
            message_revision=chosen.revision,
            note=self.body.note,
            message_author_id=selected.author_id,
            message_author_name=selected.author_name,
        )

    def _state(self):
        if (
            self.action in {"archive", "restore"}
            and self.current.created_by_id != self.user.id
            and not self.permissions["configure"]
        ):
            raise HTTPException(
                403, "Only the discussion creator or project configurator can archive or restore"
            )
        if self.action == "restore" and self.current.state != "archived":
            fail("discussion_conflict", "Only archived discussions can be restored")
        self.changes["state"] = "archived" if self.action == "archive" else "open"
        if self.action != "archive":
            self.changes["current_resolution_event_id"] = None
        self.event_data["reason"] = self.body.reason

    def _link(self):
        body = self.body
        target = entity(self.db, self.project, body.target_kind, body.target_id)
        if canonical_basis(target, body.target_kind) != body.target_content_basis:
            fail("discussion_source_changed", "Target content changed; review the reference")
        reference = {
            key: body.model_dump()[key]
            for key in ("expected_thread_version", "resolution_event_id", "message_id", "message_revision")
        }
        source = validate_source_reference(
            self.db, self.project, self.user, {"thread_id": self.current.id, **reference}, store=self.store
        )
        self.link_id = record_adoption_links(
            self.db,
            self.project,
            self.user,
            source,
            [{"kind": body.target_kind, "id": body.target_id}],
            relation="reference",
        )[0]
        self.refs = source.source_snapshot["message"]["refs"]
        self.event_id = source.source_id

    def _event(self):
        current = self.current
        self.event_id = current.current_resolution_event_id if self.action == "resolve" else identifier()
        if self.selected:
            self.event_data.setdefault("message_id", self.selected.id)
            self.event_data.setdefault("message_revision", self.selected.current_revision)
        self.db.add(
            m.DeliveryDiscussionEvent(
                id=self.event_id,
                tenant_id=self.project.tenant_id,
                project_id=self.project.id,
                thread_id=current.id,
                thread_version=current.version,
                subject_kind=current.subject_kind,
                subject_id=current.subject_id,
                action=self.action,
                actor_id=self.user.id,
                actor_name=self.user.username,
                data=self.event_data,
            )
        )
        self.db.flush()

    def run(self):
        if self.action == "create":
            self._create()
        else:
            self.current = thread(self.db, self.project, self.thread_id, lock=True)
            self._check_current()
            handlers = {
                "reply": self._reply,
                "edit": self._edit,
                "withdraw": self._edit,
                "resolve": self._resolve,
                "reopen": self._state,
                "archive": self._state,
                "restore": self._state,
                "link": self._link,
            }
            handlers[self.action]()
            if self.action != "link":
                _advance(self.db, self.project, self.current, self.changes)
        if self.action != "link":
            self._event()
        return {
            "project_id": self.project.id,
            "thread_id": self.current.id,
            "thread_version": self.current.version,
            "event_id": self.event_id,
            "message_id": self.selected.id if self.selected else None,
            "message_revision": self.selected.current_revision if self.selected else None,
            "link_id": self.link_id,
            "replayed": False,
        }


def mutate(db, project, user, body, action, *, thread_id=None, message_id=None, store=None):
    key = digest([project.tenant_id, project.id, user.id, "discussion", body.idempotency_key])
    fingerprint = digest([action, thread_id, message_id, body.model_dump()])
    project, user, permissions = authorize(db, user, project.id)
    replay = _receipt(db, project, user, key, fingerprint, store)
    if replay:
        return replay
    try:
        require_project_operation(db, project.tenant_id, project.id)
        pid, uid = project.id, user.id
        db.expire_all()
        project, user, permissions = authorize(db, db.get(m.User, uid), pid)
        if not permissions["write"]:
            raise HTTPException(403, "Project write permission required")
        replay = _receipt(db, project, user, key, fingerprint, store)
        if replay:
            return replay
        command = _Mutation(db, project, user, permissions, body, action, thread_id, message_id, store)
        ack = command.run()
        db.add(
            m.DeliveryDiscussionReceipt(
                id=key,
                tenant_id=project.tenant_id,
                project_id=project.id,
                request_hash=fingerprint,
                event_id=ack["event_id"],
                original_ack=deepcopy(ack),
                runtime_scopes=reference_scopes(command.refs),
            )
        )
        db.commit()
        return ack
    except Exception:
        db.rollback()
        raise
