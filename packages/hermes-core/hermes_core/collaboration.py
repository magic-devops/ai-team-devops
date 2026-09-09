from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import insert, select, update

from .models import API_BASE, CoreError, Envelope, Principal, payload
from .transactional import Store, digest, now

CHANNEL_KIND = "channels"
THREAD_KIND = "threads"
MESSAGE_KIND = "messages"
CURSOR_KIND = "message_cursors"
COLLAB_ACTIONS = [
    {"id": "collaboration.members", "permissions": ["read"], "method": "GET", "path": f"{API_BASE}/collaboration/members", "resource": "members"},
    {"id": "collaboration.channels.list", "permissions": ["read"], "method": "GET", "path": f"{API_BASE}/collaboration/channels", "resource": CHANNEL_KIND},
    {"id": "collaboration.channel.configure", "permissions": ["config"], "method": "POST", "path": f"{API_BASE}/collaboration/channels/{{id}}/configure", "resource": CHANNEL_KIND},
    {"id": "collaboration.threads.list", "permissions": ["read"], "method": "GET", "path": f"{API_BASE}/collaboration/channels/{{id}}/threads", "resource": THREAD_KIND},
    {"id": "collaboration.thread.create", "permissions": ["write"], "method": "POST", "path": f"{API_BASE}/collaboration/threads", "resource": THREAD_KIND},
    {"id": "collaboration.thread.archive", "permissions": ["write"], "method": "POST", "path": f"{API_BASE}/collaboration/threads/{{id}}/archive", "resource": THREAD_KIND},
    {"id": "collaboration.messages.list", "permissions": ["read"], "method": "GET", "path": f"{API_BASE}/collaboration/threads/{{id}}/messages", "resource": MESSAGE_KIND},
    {"id": "collaboration.message.send", "permissions": ["write"], "method": "POST", "path": f"{API_BASE}/collaboration/messages", "resource": MESSAGE_KIND},
    {"id": "collaboration.message.edit", "permissions": ["write"], "method": "PATCH", "path": f"{API_BASE}/collaboration/messages/{{id}}", "resource": MESSAGE_KIND},
    {"id": "collaboration.message.archive", "permissions": ["write"], "method": "POST", "path": f"{API_BASE}/collaboration/messages/{{id}}/archive", "resource": MESSAGE_KIND},
    {"id": "collaboration.inbox", "permissions": ["read"], "method": "GET", "path": f"{API_BASE}/collaboration/inbox", "resource": MESSAGE_KIND},
    {"id": "collaboration.read.mark", "permissions": ["write"], "method": "POST", "path": f"{API_BASE}/collaboration/read", "resource": CURSOR_KIND},
]


class CollaborationAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    idempotency_key: str = Field(min_length=1, max_length=160)
    expected_version: int | None = Field(default=None, ge=1)
    dry_run: bool = True


class ChannelConfigure(CollaborationAction):
    title: str = Field(min_length=1, max_length=120)
    members: list[str] = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    archived: bool = False

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("title must not be blank")
        return stripped


class ThreadCreate(CollaborationAction):
    channel_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(default="", max_length=8000)
    mentions: list[str] = Field(default_factory=list, max_length=50)
    recipients: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("title must not be blank")
        return stripped


class MessageSend(CollaborationAction):
    channel_id: str = Field(min_length=1, max_length=64)
    thread_id: str = Field(min_length=1, max_length=64)
    parent_id: str = Field(default="", max_length=64)
    body: str = Field(min_length=1, max_length=8000)
    mentions: list[str] = Field(default_factory=list, max_length=50)
    recipients: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("body")
    @classmethod
    def clean_body(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("body must not be blank")
        return stripped


class MessageEdit(CollaborationAction):
    body: str = Field(min_length=1, max_length=8000)
    mentions: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("body")
    @classmethod
    def clean_body(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("body must not be blank")
        return stripped


class MarkRead(CollaborationAction):
    channel_id: str = Field(min_length=1, max_length=64)
    thread_id: str = Field(default="", max_length=64)
    cursor: int = Field(ge=0)


class Collaboration:
    def __init__(self, store: Store, actor_directory: Callable[[Principal, str], list[str]] | None = None):
        self.store = store
        self.actor_directory = actor_directory

    def configure_channel(self, principal: Principal, workspace: str, channel_id: str, body: ChannelConfigure, trace: str):
        request = body.model_dump(mode="json")
        self._workspace(principal, workspace)
        entity_id = self._resolve_channel_id(principal, workspace, channel_id)
        members = self._normalize_actors(body.members, "members")
        self._validate_workspace_actors(principal, workspace, members, "members")
        if principal.actor not in members:
            members.append(principal.actor)
        data = {
            "logical_id": channel_id,
            "title": body.title,
            "description": body.description.strip(),
            "members": members,
            "configured_by": principal.actor,
        }
        status = "archived" if body.archived else "active"
        if body.dry_run:
            return self._preview_configure(principal, workspace, entity_id, data, status, body.expected_version)
        with self.store.transaction() as conn:
            self._workspace(principal, workspace, conn)
            existing = self._maybe_get(conn, principal, workspace, CHANNEL_KIND, entity_id)
            receipt_id, cached = self.store._receipt(conn, principal, workspace, f"collaboration.channel.configure:{entity_id}", body.idempotency_key, request)
            if cached is not None:
                if existing is None:
                    raise CoreError("not_found", "Channel no longer exists", 404)
                self._assert_member(principal, existing)
                return cached
            if existing is None:
                if body.expected_version is not None:
                    raise CoreError("version_conflict", "New channels do not have an expected_version yet", 409)
                item = self._insert_entity(conn, principal, workspace, CHANNEL_KIND, entity_id, status, {**data, "client_channel_id": uuid.uuid4().hex})
                action = "collaboration.channel.created"
            else:
                if body.expected_version is None or existing["version"] != body.expected_version:
                    raise CoreError("version_conflict", "Channel changed; reload before configuring", 409)
                item = self._update_entity(conn, principal, workspace, existing, {"status": status, "data": {**existing["data"], **data, "logical_id": existing["data"]["logical_id"], "client_channel_id": existing["data"].get("client_channel_id") or uuid.uuid4().hex}})
                action = "collaboration.channel.configured"
            self.store._record(conn, principal, workspace, item, action, trace, {"members": members, "status": status})
            conn.execute(insert(self.store.receipts).values(id=receipt_id, request_hash=digest(request), result=item, created_at=now()))
            return item

    def list_channels(self, principal: Principal, workspace: str, *, include_archived: bool = False):
        query = select(self.store.entities).where(
            self.store._scope(self.store.entities, principal, workspace),
            self.store.entities.c.kind == CHANNEL_KIND,
        )
        if not include_archived:
            query = query.where(self.store.entities.c.status != "archived")
        with self.store.engine.connect() as conn:
            rows = conn.execute(query.order_by(self.store.entities.c.id)).mappings()
            return [dict(row) for row in rows if self._is_member(principal, dict(row))]

    def create_thread(self, principal: Principal, workspace: str, body: ThreadCreate, trace: str):
        request = body.model_dump(mode="json")
        channel = self._channel(principal, workspace, body.channel_id)
        channel_entity_id = channel["id"]
        data = {
            "channel_id": channel_entity_id,
            "logical_channel_id": body.channel_id,
            "title": body.title,
            "created_by": principal.actor,
            "last_message_seq": 0,
        }
        if body.dry_run:
            self._assert_channel_open(channel)
            members = self._channel_members(channel)
            mentions = self._validated_actor_list(body.mentions, members, "mentions")
            recipients = self._recipients(body.recipients, members)
            return self._preview(principal, workspace, THREAD_KIND, {**data, "mentions": mentions, "recipients": recipients})
        with self.store.transaction() as conn:
            channel = self._channel_for_update(conn, principal, workspace, channel_entity_id)
            receipt_id, cached = self.store._receipt(conn, principal, workspace, "collaboration.thread.create", body.idempotency_key, request)
            if cached is not None:
                return cached
            self._assert_channel_open(channel)
            members = self._channel_members(channel)
            mentions = self._validated_actor_list(body.mentions, members, "mentions")
            recipients = self._recipients(body.recipients, members)
            data = {**data, "channel_id": channel["id"], "mentions": mentions, "recipients": recipients}
            thread = self._insert_entity(conn, principal, workspace, THREAD_KIND, uuid.uuid4().hex, "active", data)
            self.store._record(conn, principal, workspace, thread, "collaboration.thread.created", trace, {"channel_id": channel["id"]})
            if body.body.strip():
                message = self._insert_message(conn, principal, workspace, channel, thread["id"], "", body.body, mentions, recipients, trace)
                thread = self._update_entity(conn, principal, workspace, thread, {"data": {**thread["data"], "last_message_seq": message["data"]["event_seq"]}})
            conn.execute(insert(self.store.receipts).values(id=receipt_id, request_hash=digest(request), result=thread, created_at=now()))
            return thread

    def list_threads(self, principal: Principal, workspace: str, channel_id: str, *, include_archived: bool = False, cursor: str = "", limit: int = 100):
        channel = self._channel(principal, workspace, channel_id)
        query = select(self.store.entities).where(
            self.store._scope(self.store.entities, principal, workspace),
            self.store.entities.c.kind == THREAD_KIND,
            self.store.entities.c.data["channel_id"].as_string() == channel["id"],
        )
        if not include_archived:
            query = query.where(self.store.entities.c.status != "archived")
        if cursor:
            query = query.where(self.store.entities.c.id > cursor)
        with self.store.engine.connect() as conn:
            return [dict(row) for row in conn.execute(query.order_by(self.store.entities.c.id).limit(limit)).mappings()]

    def archive_thread(self, principal: Principal, workspace: str, thread_id: str, body: CollaborationAction, trace: str):
        return self._archive(principal, workspace, THREAD_KIND, thread_id, body, trace, owner_field="created_by", operation="collaboration.thread.archive")

    def send_message(self, principal: Principal, workspace: str, body: MessageSend, trace: str):
        request = body.model_dump(mode="json")
        channel = self._channel(principal, workspace, body.channel_id)
        channel_entity_id = channel["id"]
        thread = self.store.get(principal, workspace, THREAD_KIND, body.thread_id)
        if thread["data"].get("channel_id") != channel_entity_id:
            raise CoreError("scope_mismatch", "Thread does not belong to this channel", 403)
        if body.dry_run:
            self._assert_channel_open(channel)
            self._assert_thread_open(thread)
            members = self._channel_members(channel)
            mentions = self._validated_actor_list(body.mentions, members, "mentions")
            recipients = self._recipients(body.recipients, members)
            if body.parent_id:
                parent = self.store.get(principal, workspace, MESSAGE_KIND, body.parent_id)
                if parent["data"].get("thread_id") != body.thread_id:
                    raise CoreError("scope_mismatch", "Reply parent does not belong to this thread", 403)
            return self._preview(principal, workspace, MESSAGE_KIND, self._message_data(channel["id"], body.thread_id, body.parent_id, body.body, mentions, recipients, principal.actor, 0))
        with self.store.transaction() as conn:
            channel = self._channel_for_update(conn, principal, workspace, channel_entity_id)
            receipt_id, cached = self.store._receipt(conn, principal, workspace, "collaboration.message.send", body.idempotency_key, request)
            if cached is not None:
                return cached
            self._assert_channel_open(channel)
            members = self._channel_members(channel)
            mentions = self._validated_actor_list(body.mentions, members, "mentions")
            recipients = self._recipients(body.recipients, members)
            thread = self.store._get(conn, principal, workspace, THREAD_KIND, body.thread_id)
            if thread["data"].get("channel_id") != channel_entity_id:
                raise CoreError("scope_mismatch", "Thread does not belong to this channel", 403)
            self._assert_thread_open(thread)
            if body.parent_id:
                parent = self.store._get(conn, principal, workspace, MESSAGE_KIND, body.parent_id)
                if parent["data"].get("thread_id") != body.thread_id:
                    raise CoreError("scope_mismatch", "Reply parent does not belong to this thread", 403)
            message = self._insert_message(conn, principal, workspace, channel, body.thread_id, body.parent_id, body.body, mentions, recipients, trace)
            updated_thread = self._update_entity(conn, principal, workspace, thread, {"data": {**thread["data"], "last_message_seq": message["data"]["event_seq"]}})
            self.store._record(conn, principal, workspace, updated_thread, "collaboration.thread.touched", trace, {"message_id": message["id"], "cursor": message["data"]["event_seq"]})
            conn.execute(insert(self.store.receipts).values(id=receipt_id, request_hash=digest(request), result=message, created_at=now()))
            return message

    def list_messages(self, principal: Principal, workspace: str, thread_id: str, *, after: int = 0, limit: int = 100):
        thread = self.store.get(principal, workspace, THREAD_KIND, thread_id)
        self._channel(principal, workspace, str(thread["data"].get("channel_id", "")))
        query = select(self.store.entities).where(
            self.store._scope(self.store.entities, principal, workspace),
            self.store.entities.c.kind == MESSAGE_KIND,
            self.store.entities.c.status != "archived",
            self.store.entities.c.data["thread_id"].as_string() == thread_id,
            self.store.entities.c.data["event_seq"].as_integer() > after,
        )
        with self.store.engine.connect() as conn:
            rows = conn.execute(query.order_by(self.store.entities.c.data["event_seq"].as_integer())).mappings()
            return [dict(row) for row in rows if principal.actor in (row["data"].get("recipients") or [])][:limit]

    def edit_message(self, principal: Principal, workspace: str, message_id: str, body: MessageEdit, trace: str):
        original = self.store.get(principal, workspace, MESSAGE_KIND, message_id)
        channel = self._channel(principal, workspace, str(original["data"].get("channel_id", "")))
        if original["data"].get("author") != principal.actor and "config" not in principal.permissions:
            raise CoreError("forbidden", "Only the author or a config principal can edit this message", 403)
        if body.expected_version is None:
            raise CoreError("version_required", "expected_version is required", 400)
        if body.dry_run:
            self._assert_channel_open(channel)
            thread = self.store.get(principal, workspace, THREAD_KIND, original["data"]["thread_id"])
            self._assert_thread_open(thread)
            if original["status"] == "archived":
                raise CoreError("message_archived", "Archived messages are read-only", 409)
            mentions = self._validated_actor_list(body.mentions, self._channel_members(channel), "mentions")
            if original["version"] != body.expected_version:
                raise CoreError("version_conflict", "Message changed; reload before editing", 409)
            return {**original, "version": original["version"] + 1, "data": {**original["data"], "body": body.body, "mentions": mentions, "edited_by": principal.actor, "edited_at": now()}}

        request = body.model_dump(mode="json")
        with self.store.transaction() as conn:
            channel = self._channel_for_update(conn, principal, workspace, channel["id"])
            item = self.store._get(conn, principal, workspace, MESSAGE_KIND, message_id)
            if item["data"].get("author") != principal.actor and "config" not in principal.permissions:
                raise CoreError("forbidden", "Only the author or a config principal can edit this message", 403)
            receipt_id, cached = self.store._receipt(conn, principal, workspace, f"collaboration.message.edited:{message_id}", body.idempotency_key, request)
            if cached is not None:
                return cached
            self._assert_channel_open(channel)
            thread = self.store._get(conn, principal, workspace, THREAD_KIND, item["data"]["thread_id"])
            self._assert_thread_open(thread)
            if item["status"] == "archived":
                raise CoreError("message_archived", "Archived messages are read-only", 409)
            if item["version"] != body.expected_version:
                raise CoreError("version_conflict", "Message changed; reload before editing", 409)
            members = self._channel_members(channel)
            mentions = self._validated_actor_list(body.mentions, members, "mentions")
            changed = self._update_entity(conn, principal, workspace, item, {"data": {**item["data"], "body": body.body, "mentions": mentions, "edited_by": principal.actor, "edited_at": now()}})
            self.store._record(conn, principal, workspace, changed, "collaboration.message.edited", trace, {"channel_id": changed["data"].get("channel_id"), "thread_id": changed["data"].get("thread_id")})
            conn.execute(insert(self.store.receipts).values(id=receipt_id, request_hash=digest(request), result=changed, created_at=now()))
            return changed

    def archive_message(self, principal: Principal, workspace: str, message_id: str, body: CollaborationAction, trace: str):
        return self._archive(principal, workspace, MESSAGE_KIND, message_id, body, trace, owner_field="author", operation="collaboration.message.archive")

    def mark_read(self, principal: Principal, workspace: str, body: MarkRead, trace: str):
        request = body.model_dump(mode="json")
        channel = self._channel(principal, workspace, body.channel_id)
        if body.thread_id:
            thread = self.store.get(principal, workspace, THREAD_KIND, body.thread_id)
            if thread["data"].get("channel_id") != channel["id"]:
                raise CoreError("scope_mismatch", "Thread does not belong to this channel", 403)
        max_cursor = self._max_visible_cursor(principal, workspace, channel["id"], body.thread_id)
        if body.cursor > max_cursor:
            raise CoreError("cursor_ahead", "Read cursor cannot move beyond the latest visible message", 409)
        cursor_id = self._cursor_id(principal, workspace, channel["id"], body.thread_id)
        data = {"actor": principal.actor, "channel_id": channel["id"], "thread_id": body.thread_id, "cursor": body.cursor}
        if body.dry_run:
            existing = self._maybe_get_preview(principal, workspace, CURSOR_KIND, cursor_id)
            version = (existing["version"] + 1) if existing else 1
            return {"id": cursor_id, "kind": CURSOR_KIND, "tenant": principal.tenant, "business": principal.business,
                    "workspace": workspace, "version": version, "status": "active", "data": data,
                    "created_at": now(), "updated_at": now()}
        with self.store.transaction() as conn:
            self._channel_for_update(conn, principal, workspace, channel["id"])
            receipt_id, cached = self.store._receipt(conn, principal, workspace, f"collaboration.read.mark:{cursor_id}", body.idempotency_key, request)
            if cached is not None:
                return cached
            existing = self._maybe_get(conn, principal, workspace, CURSOR_KIND, cursor_id)
            if existing is None:
                item = self._insert_entity(conn, principal, workspace, CURSOR_KIND, cursor_id, "active", data)
                action = "collaboration.read.created"
            else:
                current = int(existing["data"].get("cursor", 0))
                item = self._update_entity(conn, principal, workspace, existing, {"data": {**existing["data"], "cursor": max(current, body.cursor)}})
                action = "collaboration.read.marked"
            self.store._record(conn, principal, workspace, item, action, trace, {"cursor": item["data"]["cursor"], "actor": principal.actor})
            conn.execute(insert(self.store.receipts).values(id=receipt_id, request_hash=digest(request), result=item, created_at=now()))
            return item

    def inbox(self, principal: Principal, workspace: str, *, limit: int = 100):
        channels = {row["id"]: row for row in self.list_channels(principal, workspace)}
        cursor_rows = self._cursor_rows(principal, workspace)
        channel_cursors = {
            row["data"].get("channel_id"): int(row["data"].get("cursor", 0))
            for row in cursor_rows
            if row["data"].get("actor") == principal.actor and not row["data"].get("thread_id")
        }
        thread_cursors = {
            (row["data"].get("channel_id"), row["data"].get("thread_id")): int(row["data"].get("cursor", 0))
            for row in cursor_rows
            if row["data"].get("actor") == principal.actor and row["data"].get("thread_id")
        }
        rows = self._message_rows_for_channels(principal, workspace, set(channels))
        unread = [
            row for row in rows
            if row["status"] != "archived"
            and row["data"].get("channel_id") in channels
            and principal.actor in row["data"].get("recipients", [])
            and row["data"].get("author") != principal.actor
            and int(row["data"].get("event_seq", 0)) > max(
                channel_cursors.get(row["data"].get("channel_id"), 0),
                thread_cursors.get((row["data"].get("channel_id"), row["data"].get("thread_id")), 0),
            )
        ]
        return sorted(unread, key=lambda row: row["data"].get("event_seq", 0))[:limit]

    def _cursor_rows(self, principal: Principal, workspace: str):
        with self.store.engine.connect() as conn:
            rows = conn.execute(select(self.store.entities).where(
                self.store._scope(self.store.entities, principal, workspace),
                self.store.entities.c.kind == CURSOR_KIND,
            )).mappings()
            return [dict(row) for row in rows if (row["data"] or {}).get("actor") == principal.actor]

    def _message_rows_for_channels(self, principal: Principal, workspace: str, channel_ids: set[str]):
        if not channel_ids:
            return []
        with self.store.engine.connect() as conn:
            rows = conn.execute(select(self.store.entities).where(
                self.store._scope(self.store.entities, principal, workspace),
                self.store.entities.c.kind == MESSAGE_KIND,
                self.store.entities.c.status != "archived",
                self.store.entities.c.data["channel_id"].as_string().in_(sorted(channel_ids)),
            ).order_by(self.store.entities.c.data["event_seq"].as_integer())).mappings()
            return [dict(row) for row in rows]

    def _max_visible_cursor(self, principal: Principal, workspace: str, channel_id: str, thread_id: str):
        query = select(self.store.entities).where(
            self.store._scope(self.store.entities, principal, workspace),
            self.store.entities.c.kind == MESSAGE_KIND,
            self.store.entities.c.status != "archived",
            self.store.entities.c.data["channel_id"].as_string() == channel_id,
        )
        if thread_id:
            query = query.where(self.store.entities.c.data["thread_id"].as_string() == thread_id)
        with self.store.engine.connect() as conn:
            rows = conn.execute(query).mappings()
            visible = [
                int(row["data"].get("event_seq", 0))
                for row in rows
                if principal.actor in (row["data"].get("recipients") or [])
            ]
            return max(visible, default=0)

    def _insert_message(self, conn, principal, workspace, channel, thread_id: str, parent_id: str, body: str, mentions: list[str], recipients: list[str], trace: str):
        data = self._message_data(channel["id"], thread_id, parent_id, body, mentions, recipients, principal.actor, 0)
        item = self._insert_entity(conn, principal, workspace, MESSAGE_KIND, uuid.uuid4().hex, "active", data)
        self.store._record(conn, principal, workspace, item, "collaboration.message.sent", trace, {
            "channel_id": channel["id"],
            "thread_id": thread_id,
            "parent_id": parent_id,
            "mentions": mentions,
            "recipients": recipients,
        })
        seq = conn.execute(select(self.store.events.c.seq).where(
            self.store.events.c.entity_id == item["id"],
            self.store.events.c.action == "collaboration.message.sent",
        ).order_by(self.store.events.c.seq.desc()).limit(1)).scalar_one()
        data = {**data, "event_seq": int(seq)}
        return self._replace_entity_data(conn, principal, workspace, item, data)

    def _message_data(self, channel_id: str, thread_id: str, parent_id: str, body: str, mentions: list[str], recipients: list[str], author: str, event_seq: int):
        return {
            "channel_id": channel_id,
            "thread_id": thread_id,
            "parent_id": parent_id,
            "body": body.strip(),
            "author": author,
            "mentions": mentions,
            "recipients": recipients,
            "event_seq": event_seq,
        }

    def _channel(self, principal: Principal, workspace: str, channel_id: str):
        self._workspace(principal, workspace)
        channel = self.store.get(principal, workspace, CHANNEL_KIND, self._resolve_channel_id(principal, workspace, channel_id))
        self._assert_member(principal, channel)
        return channel

    def _channel_for_update(self, conn, principal: Principal, workspace: str, channel_id: str):
        self._workspace(principal, workspace, conn)
        channel = self.store._get(conn, principal, workspace, CHANNEL_KIND, channel_id)
        self._assert_member(principal, channel)
        return channel

    def _resolve_channel_id(self, principal: Principal, workspace: str, channel_id: str) -> str:
        try:
            self.store.get(principal, workspace, CHANNEL_KIND, channel_id)
            return channel_id
        except CoreError as exc:
            if exc.status != 404:
                raise
        return self._channel_entity_id(principal, workspace, channel_id)

    def _channel_entity_id(self, principal: Principal, workspace: str, logical_id: str) -> str:
        clean = logical_id.strip()
        if not clean or len(clean) > 64:
            raise CoreError("invalid_channel_id", "Channel id must be 1-64 characters", 422)
        return "ch_" + digest(["collaboration.channel", principal.tenant, principal.business, workspace, clean])[:40]

    def _workspace(self, principal: Principal, workspace: str, conn=None):
        if principal.workspace_ids is not None and workspace not in principal.workspace_ids:
            raise CoreError("forbidden", "Workspace access denied", 403)
        row = (self.store._get(conn, principal, "", "workspaces", workspace) if conn is not None
               else self.store.get(principal, "", "workspaces", workspace))
        if row["status"] != "active":
            raise CoreError("workspace_inactive", "Workspace is inactive", 409)
        return row

    def _assert_channel_open(self, channel: dict):
        if channel["status"] == "archived":
            raise CoreError("channel_archived", "Archived channels are read-only", 409)

    def _assert_thread_open(self, thread: dict):
        if thread["status"] == "archived":
            raise CoreError("thread_archived", "Archived threads are read-only", 409)

    def _assert_member(self, principal: Principal, channel: dict):
        if not self._is_member(principal, channel):
            raise CoreError("forbidden", "Channel membership is required", 403)

    def _is_member(self, principal: Principal, channel: dict):
        return principal.actor in self._channel_members(channel)

    def _channel_members(self, channel: dict) -> list[str]:
        return list(channel["data"].get("members") or [])

    def _recipients(self, values: list[str], members: list[str]) -> list[str]:
        recipients = self._validated_actor_list(values, members, "recipients") if values else list(members)
        if not recipients:
            raise CoreError("recipient_required", "At least one valid recipient is required", 422)
        return recipients

    def _validated_actor_list(self, values: list[str], members: list[str], label: str) -> list[str]:
        actors = self._normalize_actors(values, label)
        unknown = sorted(set(actors) - set(members))
        if unknown:
            raise CoreError(f"invalid_{label}", f"{label} must be configured channel members: {', '.join(unknown)}", 422)
        return actors

    def _normalize_actors(self, values: list[str], label: str) -> list[str]:
        actors: list[str] = []
        for value in values:
            actor = str(value).strip()
            if not actor or len(actor) > 128 or any(ch.isspace() for ch in actor):
                raise CoreError(f"invalid_{label}", f"{label} contains an invalid actor", 422)
            if actor not in actors:
                actors.append(actor)
        return actors

    def _validate_workspace_actors(self, principal: Principal, workspace: str, actors: list[str], label: str):
        allowed = set(self.actor_directory(principal, workspace) if self.actor_directory else [principal.actor])
        unknown = sorted(set(actors) - allowed)
        if unknown:
            raise CoreError(f"unknown_{label}", f"{label} must be authenticated workspace actors: {', '.join(unknown)}", 422)

    def _archive(self, principal: Principal, workspace: str, kind: str, entity_id: str, body: CollaborationAction, trace: str, *, owner_field: str, operation: str):
        item = self.store.get(principal, workspace, kind, entity_id)
        channel = self._channel(principal, workspace, str(item["data"].get("channel_id", "")))
        if item["data"].get(owner_field) != principal.actor and "config" not in principal.permissions:
            raise CoreError("forbidden", "Only the owner or a config principal can archive this resource", 403)
        if body.expected_version is None:
            raise CoreError("version_required", "expected_version is required", 400)
        if body.dry_run:
            self._assert_channel_open(channel)
            if kind == MESSAGE_KIND:
                thread = self.store.get(principal, workspace, THREAD_KIND, item["data"]["thread_id"])
                self._assert_thread_open(thread)
            if item["status"] == "archived":
                raise CoreError("resource_archived", "Archived resources are read-only", 409)
            if item["version"] != body.expected_version:
                raise CoreError("version_conflict", "Resource changed; reload before archiving", 409)
            return {**item, "version": item["version"] + 1, "status": "archived", "data": {**item["data"], "archived_by": principal.actor, "archived_at": now()}}
        request = body.model_dump(mode="json")
        with self.store.transaction() as conn:
            current_channel = self._channel_for_update(conn, principal, workspace, channel["id"])
            current = self.store._get(conn, principal, workspace, kind, entity_id)
            if current["data"].get(owner_field) != principal.actor and "config" not in principal.permissions:
                raise CoreError("forbidden", "Only the owner or a config principal can archive this resource", 403)
            receipt_id, cached = self.store._receipt(conn, principal, workspace, f"{operation}:{entity_id}", body.idempotency_key, request)
            if cached is not None:
                return cached
            self._assert_channel_open(current_channel)
            if kind == MESSAGE_KIND:
                thread = self.store._get(conn, principal, workspace, THREAD_KIND, current["data"]["thread_id"])
                self._assert_thread_open(thread)
            if current["status"] == "archived":
                raise CoreError("resource_archived", "Archived resources are read-only", 409)
            if current["version"] != body.expected_version:
                raise CoreError("version_conflict", "Resource changed; reload before archiving", 409)
            changed = self._update_entity(conn, principal, workspace, current, {"status": "archived", "data": {**current["data"], "archived_by": principal.actor, "archived_at": now()}})
            self.store._record(conn, principal, workspace, changed, operation, trace, {"channel_id": channel["id"]})
            conn.execute(insert(self.store.receipts).values(id=receipt_id, request_hash=digest(request), result=changed, created_at=now()))
            return changed

    def _preview_configure(self, principal, workspace, channel_id, data, status, expected_version):
        existing = self._maybe_get_preview(principal, workspace, CHANNEL_KIND, channel_id)
        if existing and expected_version != existing["version"]:
            raise CoreError("version_conflict", "Channel changed; reload before configuring", 409)
        if existing is None and expected_version is not None:
            raise CoreError("version_conflict", "New channels do not have an expected_version yet", 409)
        version = existing["version"] + 1 if existing else 1
        return {"id": channel_id, "kind": CHANNEL_KIND, "tenant": principal.tenant, "business": principal.business,
                "workspace": workspace, "version": version, "status": status, "data": data,
                "created_at": now(), "updated_at": now()}

    def _preview(self, principal, workspace, kind, data):
        return {"id": f"preview-{uuid.uuid4().hex}", "kind": kind, "tenant": principal.tenant, "business": principal.business,
                "workspace": workspace, "version": 1, "status": "active", "data": data,
                "created_at": now(), "updated_at": now()}

    def _maybe_get_preview(self, principal, workspace, kind, entity_id):
        try:
            return self.store.get(principal, workspace, kind, entity_id)
        except CoreError as exc:
            if exc.status == 404:
                return None
            raise

    def _maybe_get(self, conn, principal, workspace, kind, entity_id):
        try:
            return self.store._get(conn, principal, workspace, kind, entity_id)
        except CoreError as exc:
            if exc.status == 404:
                return None
            raise

    def _cursor_id(self, principal: Principal, workspace: str, channel_id: str, thread_id: str):
        return digest(["collaboration.cursor", principal.tenant, principal.business, workspace, principal.actor, channel_id, thread_id])[:32]

    def _insert_entity(self, conn, principal, workspace, kind, entity_id, status, data):
        item = {"id": entity_id, "kind": kind, "tenant": principal.tenant, "business": principal.business,
                "workspace": workspace, "version": 1, "status": status, "data": json.loads(json.dumps(data)),
                "created_at": now(), "updated_at": now()}
        conn.execute(insert(self.store.entities).values(**item))
        return item

    def _update_entity(self, conn, principal, workspace, item, changes):
        changed = {**item, **changes, "version": item["version"] + 1, "updated_at": now()}
        result = conn.execute(update(self.store.entities).where(
            self.store._scope(self.store.entities, principal, workspace),
            self.store.entities.c.id == item["id"],
            self.store.entities.c.version == item["version"],
        ).values(status=changed["status"], data=json.loads(json.dumps(changed["data"])), version=changed["version"], updated_at=changed["updated_at"]))
        if result.rowcount != 1:
            raise CoreError("version_conflict", "Concurrent modification", 409)
        return changed

    def _replace_entity_data(self, conn, principal, workspace, item, data):
        result = conn.execute(update(self.store.entities).where(
            self.store._scope(self.store.entities, principal, workspace),
            self.store.entities.c.id == item["id"],
            self.store.entities.c.version == item["version"],
        ).values(data=json.loads(json.dumps(data)), updated_at=now()))
        if result.rowcount != 1:
            raise CoreError("version_conflict", "Concurrent modification", 409)
        return {**item, "data": data, "updated_at": now()}


def create_collaboration_router(store: Store, identity: Callable, actor_directory: Callable[[Principal, str], list[str]] | None = None):  # noqa: C901
    router = APIRouter(prefix=API_BASE + "/collaboration", tags=["Hermes Collaboration"])
    service = Collaboration(store, actor_directory)
    identity_dependency = Depends(identity)

    def require(principal: Principal, action: Literal["read", "write", "config"]):
        if action not in principal.permissions:
            raise CoreError("forbidden", f"Missing {action} permission", 403)

    def workspace_id(request: Request, principal: Principal):
        workspace = request.headers.get("X-Workspace-Id", "")
        if not workspace:
            raise CoreError("workspace_required", "Select a workspace first", 400)
        if principal.workspace_ids is not None and workspace not in principal.workspace_ids:
            raise CoreError("forbidden", "Workspace access denied", 403)
        row = store.get(principal, "", "workspaces", workspace)
        if row["status"] != "active":
            raise CoreError("workspace_inactive", "Workspace is inactive", 409)
        return workspace

    def response(principal, workspace, items, *, trace: str, **extra):
        return payload(principal, workspace, items, trace=trace, actions=COLLAB_ACTIONS, **extra)

    @router.get("/members", response_model=Envelope)
    def members(request: Request, principal: Principal = identity_dependency):
        require(principal, "read")
        workspace = workspace_id(request, principal)
        actors = actor_directory(principal, workspace) if actor_directory else [principal.actor]
        return response(principal, workspace, [{"id": actor} for actor in sorted(set(actors))], trace=uuid.uuid4().hex)

    @router.get("/channels", response_model=Envelope)
    def channels(request: Request, include_archived: bool = False, principal: Principal = identity_dependency):
        require(principal, "read")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        return response(principal, workspace, service.list_channels(principal, workspace, include_archived=include_archived),
                        trace=trace,
                        cli={"command": "sop hermes collaboration channels --json", "workspace_id": workspace})

    @router.post("/channels/{channel_id}/configure", response_model=Envelope)
    def configure_channel(channel_id: str, body: ChannelConfigure, request: Request, principal: Principal = identity_dependency):
        require(principal, "config")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item = service.configure_channel(principal, workspace, channel_id, body, trace)
        return response(principal, workspace, [item], trace=trace, summary={"dry_run": body.dry_run, "configured": not body.dry_run})

    @router.get("/channels/{channel_id}/threads", response_model=Envelope)
    def threads(channel_id: str, request: Request, include_archived: bool = False, cursor: str = "",
                limit: int = Query(100, ge=1, le=500), principal: Principal = identity_dependency):
        require(principal, "read")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        items = service.list_threads(principal, workspace, channel_id, include_archived=include_archived, cursor=cursor, limit=limit)
        return response(principal, workspace, items, trace=trace, summary={"total": len(items), "cursor": items[-1]["id"] if items else cursor})

    @router.post("/threads", response_model=Envelope)
    def create_thread(body: ThreadCreate, request: Request, principal: Principal = identity_dependency):
        require(principal, "write")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item = service.create_thread(principal, workspace, body, trace)
        return response(principal, workspace, [item], trace=trace, summary={"dry_run": body.dry_run, "created": not body.dry_run})

    @router.post("/threads/{thread_id}/archive", response_model=Envelope)
    def archive_thread(thread_id: str, body: CollaborationAction, request: Request, principal: Principal = identity_dependency):
        require(principal, "write")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item = service.archive_thread(principal, workspace, thread_id, body, trace)
        return response(principal, workspace, [item], trace=trace, summary={"dry_run": body.dry_run, "archived": not body.dry_run})

    @router.get("/threads/{thread_id}/messages", response_model=Envelope)
    def messages(thread_id: str, request: Request, after: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500),
                 principal: Principal = identity_dependency):
        require(principal, "read")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        items = service.list_messages(principal, workspace, thread_id, after=after, limit=limit)
        cursor = max([item["data"].get("event_seq", after) for item in items], default=after)
        return response(principal, workspace, items, trace=trace, summary={"total": len(items), "cursor": cursor})

    @router.post("/messages", response_model=Envelope)
    def send_message(body: MessageSend, request: Request, principal: Principal = identity_dependency):
        require(principal, "write")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item = service.send_message(principal, workspace, body, trace)
        return response(principal, workspace, [item], trace=trace, summary={"dry_run": body.dry_run, "sent": not body.dry_run})

    @router.patch("/messages/{message_id}", response_model=Envelope)
    def edit_message(message_id: str, body: MessageEdit, request: Request, principal: Principal = identity_dependency):
        require(principal, "write")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item = service.edit_message(principal, workspace, message_id, body, trace)
        return response(principal, workspace, [item], trace=trace, summary={"dry_run": body.dry_run, "edited": not body.dry_run})

    @router.post("/messages/{message_id}/archive", response_model=Envelope)
    def archive_message(message_id: str, body: CollaborationAction, request: Request, principal: Principal = identity_dependency):
        require(principal, "write")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item = service.archive_message(principal, workspace, message_id, body, trace)
        return response(principal, workspace, [item], trace=trace, summary={"dry_run": body.dry_run, "archived": not body.dry_run})

    @router.get("/inbox", response_model=Envelope)
    def inbox(request: Request, limit: int = Query(100, ge=1, le=500), principal: Principal = identity_dependency):
        require(principal, "read")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        items = service.inbox(principal, workspace, limit=limit)
        cursor = max([item["data"].get("event_seq", 0) for item in items], default=0)
        return response(principal, workspace, items, trace=trace, summary={"total": len(items), "cursor": cursor})

    @router.post("/read", response_model=Envelope)
    def mark_read(body: MarkRead, request: Request, principal: Principal = identity_dependency):
        require(principal, "write")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        item = service.mark_read(principal, workspace, body, trace)
        return response(principal, workspace, [item], trace=trace, summary={"dry_run": body.dry_run, "marked": not body.dry_run})

    return router


def filter_collaboration_events(store: Store, principal: Principal, workspace: str, rows: list[dict]) -> list[dict]:
    collaboration_rows = [row for row in rows if str(row.get("action", "")).startswith("collaboration.")]
    if not collaboration_rows:
        return rows
    visible_ids = _visible_collaboration_entity_ids(store, principal, workspace)
    filtered = []
    for row in rows:
        if row.get("action") == "collaboration.thread.touched" and (row.get("data") or {}).get("message_id") not in visible_ids:
            continue
        if not str(row.get("action", "")).startswith("collaboration.") or row.get("entity_id") in visible_ids:
            filtered.append(row)
    return filtered


def _visible_collaboration_entity_ids(store: Store, principal: Principal, workspace: str) -> set[str]:
    with store.engine.connect() as conn:
        channel_rows = conn.execute(select(store.entities).where(
            store._scope(store.entities, principal, workspace),
            store.entities.c.kind == CHANNEL_KIND,
        )).mappings()
        channel_ids = {
            row["id"] for row in channel_rows
            if principal.actor in list((row["data"] or {}).get("members") or [])
        }
        if not channel_ids:
            return set()
        entity_rows = conn.execute(select(store.entities).where(
            store._scope(store.entities, principal, workspace),
            store.entities.c.kind.in_([CHANNEL_KIND, THREAD_KIND, MESSAGE_KIND, CURSOR_KIND]),
        )).mappings()
        visible: set[str] = set()
        for row in entity_rows:
            data = row["data"] or {}
            if row["kind"] == CHANNEL_KIND and row["id"] in channel_ids:
                visible.add(row["id"])
            elif row["kind"] == THREAD_KIND and data.get("channel_id") in channel_ids:
                visible.add(row["id"])
            elif row["kind"] == MESSAGE_KIND and data.get("channel_id") in channel_ids and principal.actor in data.get("recipients", []):
                visible.add(row["id"])
            elif row["kind"] == CURSOR_KIND and data.get("actor") == principal.actor and data.get("channel_id") in channel_ids:
                visible.add(row["id"])
        return visible
