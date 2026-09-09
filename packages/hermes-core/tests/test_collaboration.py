from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from hermes_core.api import create_app
from hermes_core.collaboration import (
    ChannelConfigure,
    Collaboration,
    MarkRead,
    MessageSend,
    ThreadCreate,
    create_collaboration_router,
    filter_collaboration_events,
)
from hermes_core.models import CoreError, Principal
from hermes_core.transactional import Store

BASE = "/api/hermes/v1/collaboration"


def make_core(tmp_path):
    principals = {
        "owner-token": Principal("owner"),
        "alice-token": Principal("alice", permissions=frozenset({"read", "write"})),
        "bob-token": Principal("bob", permissions=frozenset({"read", "write"})),
        "outsider-token": Principal("outsider", permissions=frozenset({"read", "write"})),
        "viewer-token": Principal("alice", permissions=frozenset({"read"})),
        "tenant-token": Principal("alice", tenant="other"),
    }
    store = Store("sqlite:///" + str(tmp_path / "workspace.sqlite"))
    owner = principals["owner-token"]
    workspace = store.create(owner, "", "workspaces", {"name": "W", "root": str(tmp_path)}, "workspace", "trace")["id"]
    app = FastAPI()
    app.state.hermes_store = store

    @app.exception_handler(CoreError)
    def core_error(_request, exc: CoreError):
        return JSONResponse(status_code=exc.status, content={"ok": False, "error": {"code": exc.code, "message": exc.message}})

    def identity(request: Request):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            raise CoreError("unauthorized", "Connect with a workspace access token", 401)
        try:
            return principals[auth[7:]]
        except KeyError as exc:
            raise CoreError("unauthorized", "Workspace token is invalid", 401) from exc

    def actor_directory(principal: Principal, _workspace: str):
        return sorted({
            candidate.actor
            for candidate in principals.values()
            if candidate.tenant == principal.tenant and candidate.business == principal.business
        })

    app.include_router(create_collaboration_router(store, identity, actor_directory))
    client = TestClient(app, headers={"Authorization": "Bearer owner-token", "X-Workspace-Id": workspace})
    return app, client, store, workspace, principals


def configure(client, channel_id="team", members=None, **overrides):
    body = {
        "title": "Team",
        "members": members or ["owner", "alice", "bob"],
        "idempotency_key": "channel-" + channel_id,
        "dry_run": False,
    }
    body.update(overrides)
    result = client.post(f"{BASE}/channels/{channel_id}/configure", json=body)
    assert result.status_code == 200, result.text
    return result.json()["items"][0]


def create_thread(client, channel_id="team", **overrides):
    body = {
        "channel_id": channel_id,
        "title": "Build notes",
        "body": "Initial note",
        "mentions": ["alice"],
        "idempotency_key": "thread-" + channel_id,
        "dry_run": False,
    }
    body.update(overrides)
    result = client.post(f"{BASE}/threads", json=body)
    assert result.status_code == 200, result.text
    return result.json()["items"][0]


def send_message(client, channel_id, thread_id, **overrides):
    body = {
        "channel_id": channel_id,
        "thread_id": thread_id,
        "body": "hello",
        "idempotency_key": "message-" + thread_id,
        "dry_run": False,
    }
    body.update(overrides)
    result = client.post(f"{BASE}/messages", json=body)
    assert result.status_code == 200, result.text
    return result.json()["items"][0]


def test_channel_membership_controls_access_and_uses_authenticated_actor(tmp_path):
    _app, client, _store, _workspace, _principals = make_core(tmp_path)
    channel = configure(client, members=["alice", "bob"])
    assert channel["id"] != "team"
    assert channel["data"]["logical_id"] == "team"
    assert len(channel["data"]["client_channel_id"]) == 32
    assert channel["data"]["members"] == ["alice", "bob", "owner"]
    assert channel["data"]["configured_by"] == "owner"

    thread = create_thread(client)
    alice = client.get(f"{BASE}/channels/team/threads", headers={"Authorization": "Bearer alice-token"})
    assert alice.status_code == 200
    assert alice.json()["items"][0]["id"] == thread["id"]

    outsider = client.get(f"{BASE}/channels/team/threads", headers={"Authorization": "Bearer outsider-token"})
    assert outsider.status_code == 403
    assert outsider.json()["error"]["code"] == "forbidden"

    forged = client.post(f"{BASE}/messages", json={
        "channel_id": "team",
        "thread_id": thread["id"],
        "body": "forged",
        "author": "bob",
        "idempotency_key": "forged",
        "dry_run": False,
    })
    assert forged.status_code == 422


def test_same_logical_channel_id_is_scoped_by_workspace_and_receipt(tmp_path):
    _app, client, store, first_workspace, _principals = make_core(tmp_path)
    first = configure(client, channel_id="general", members=["owner", "alice"])
    second_workspace = store.create(
        Principal("owner"),
        "",
        "workspaces",
        {"name": "W2", "root": str(tmp_path / "w2")},
        "workspace-2",
        "trace",
    )["id"]
    second_response = client.post(
        f"{BASE}/channels/general/configure",
        headers={"X-Workspace-Id": second_workspace},
        json={
            "title": "General",
            "members": ["owner", "alice"],
            "idempotency_key": "channel-general",
            "dry_run": False,
        },
    )
    assert second_response.status_code == 200, second_response.text
    second = second_response.json()["items"][0]
    assert first["id"] != second["id"]
    assert first["workspace"] == first_workspace
    assert second["workspace"] == second_workspace
    assert second_response.json()["trace_id"] == second_response.json()["audit"]["trace_id"]

    duplicate = client.post(
        f"{BASE}/channels/general/configure",
        headers={"X-Workspace-Id": second_workspace},
        json={
            "title": "General",
            "members": ["owner", "alice"],
            "idempotency_key": "channel-general",
            "dry_run": False,
        },
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["items"][0] == second


def test_mentions_and_recipients_must_be_actual_channel_members(tmp_path):
    _app, client, _store, _workspace, _principals = make_core(tmp_path)
    unknown_member = client.post(f"{BASE}/channels/unknown/configure", json={
        "title": "Unknown",
        "members": ["not-authenticated"],
        "idempotency_key": "unknown-member",
        "dry_run": False,
    })
    assert unknown_member.status_code == 422
    assert unknown_member.json()["error"]["code"] == "unknown_members"

    configure(client, members=["owner", "alice"])
    thread = create_thread(client, mentions=["alice"])

    bad_mention = client.post(f"{BASE}/messages", json={
        "channel_id": "team",
        "thread_id": thread["id"],
        "body": "bad mention",
        "mentions": ["outsider"],
        "idempotency_key": "bad-mention",
        "dry_run": False,
    })
    assert bad_mention.status_code == 422
    assert bad_mention.json()["error"]["code"] == "invalid_mentions"

    bad_recipient = client.post(f"{BASE}/messages", json={
        "channel_id": "team",
        "thread_id": thread["id"],
        "body": "bad recipient",
        "recipients": ["bob"],
        "idempotency_key": "bad-recipient",
        "dry_run": False,
    })
    assert bad_recipient.status_code == 422
    assert bad_recipient.json()["error"]["code"] == "invalid_recipients"


def test_idempotency_duplicate_conflict_version_and_dry_run(tmp_path):
    _app, client, store, workspace, _principals = make_core(tmp_path)
    configure(client)
    thread = create_thread(client, body="")
    before_events = store.stream(Principal("owner"), workspace)

    dry_run = client.post(f"{BASE}/messages", json={
        "channel_id": "team",
        "thread_id": thread["id"],
        "body": "preview",
        "idempotency_key": "preview",
    })
    assert dry_run.status_code == 200
    assert dry_run.json()["summary"]["dry_run"]
    assert store.stream(Principal("owner"), workspace) == before_events

    first = send_message(client, "team", thread["id"], body="same", idempotency_key="dup")
    duplicate = client.post(f"{BASE}/messages", json={
        "channel_id": "team",
        "thread_id": thread["id"],
        "body": "same",
        "idempotency_key": "dup",
        "dry_run": False,
    })
    assert duplicate.status_code == 200
    assert duplicate.json()["items"][0] == first

    conflict = client.post(f"{BASE}/messages", json={
        "channel_id": "team",
        "thread_id": thread["id"],
        "body": "different",
        "idempotency_key": "dup",
        "dry_run": False,
    })
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_conflict"

    edited = client.patch(f"{BASE}/messages/{first['id']}", json={
        "body": "edited",
        "expected_version": first["version"],
        "idempotency_key": "edit-1",
        "dry_run": False,
    })
    assert edited.status_code == 200, edited.text
    assert edited.json()["items"][0]["data"]["author"] == "owner"
    assert edited.json()["items"][0]["data"]["body"] == "edited"

    stale = client.patch(f"{BASE}/messages/{first['id']}", json={
        "body": "stale",
        "expected_version": first["version"],
        "idempotency_key": "edit-stale",
        "dry_run": False,
    })
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "version_conflict"


def test_cross_member_edit_and_read_recipient_isolation(tmp_path):
    _app, client, _store, _workspace, _principals = make_core(tmp_path)
    configure(client)
    thread = create_thread(client, body="")
    message = send_message(client, "team", thread["id"], body="secret for alice", recipients=["alice"])

    bob_messages = client.get(f"{BASE}/threads/{thread['id']}/messages", headers={"Authorization": "Bearer bob-token"})
    assert bob_messages.status_code == 200
    assert bob_messages.json()["items"] == []

    alice_messages = client.get(f"{BASE}/threads/{thread['id']}/messages", headers={"Authorization": "Bearer alice-token"})
    assert alice_messages.status_code == 200
    assert alice_messages.json()["items"][0]["id"] == message["id"]

    denied = client.patch(f"{BASE}/messages/{message['id']}", headers={"Authorization": "Bearer alice-token"}, json={
        "body": "takeover",
        "expected_version": message["version"],
        "idempotency_key": "alice-edit",
        "dry_run": False,
    })
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "forbidden"

    readonly = client.post(f"{BASE}/messages", headers={"Authorization": "Bearer viewer-token"}, json={
        "channel_id": "team",
        "thread_id": thread["id"],
        "body": "read only",
        "idempotency_key": "read-only",
        "dry_run": False,
    })
    assert readonly.status_code == 403
    assert readonly.json()["error"]["code"] == "forbidden"


def test_mark_read_and_inbox_are_actor_isolated(tmp_path):
    _app, client, _store, _workspace, _principals = make_core(tmp_path)
    configure(client)
    thread = create_thread(client, body="")
    message = send_message(client, "team", thread["id"], body="for alice only", recipients=["alice"])

    alice_inbox = client.get(f"{BASE}/inbox", headers={"Authorization": "Bearer alice-token"})
    assert [item["id"] for item in alice_inbox.json()["items"]] == [message["id"]]
    bob_inbox = client.get(f"{BASE}/inbox", headers={"Authorization": "Bearer bob-token"})
    assert bob_inbox.json()["items"] == []

    marked = client.post(f"{BASE}/read", headers={"Authorization": "Bearer alice-token"}, json={
        "channel_id": "team",
        "cursor": message["data"]["event_seq"],
        "idempotency_key": "read-alice",
        "dry_run": False,
    })
    assert marked.status_code == 200, marked.text
    assert marked.json()["items"][0]["data"]["actor"] == "alice"
    assert client.get(f"{BASE}/inbox", headers={"Authorization": "Bearer alice-token"}).json()["items"] == []


def test_thread_mark_read_affects_only_thread_and_rejects_future_cursor(tmp_path):
    _app, client, _store, _workspace, _principals = make_core(tmp_path)
    configure(client)
    first_thread = create_thread(client, body="", idempotency_key="thread-one")
    second_thread = create_thread(client, body="", title="Second", idempotency_key="thread-two")
    first_message = send_message(client, "team", first_thread["id"], body="one", recipients=["alice"], idempotency_key="msg-one")
    second_message = send_message(client, "team", second_thread["id"], body="two", recipients=["alice"], idempotency_key="msg-two")

    future = client.post(f"{BASE}/read", headers={"Authorization": "Bearer alice-token"}, json={
        "channel_id": "team",
        "thread_id": first_thread["id"],
        "cursor": first_message["data"]["event_seq"] + 100,
        "idempotency_key": "future",
        "dry_run": False,
    })
    assert future.status_code == 409
    assert future.json()["error"]["code"] == "cursor_ahead"

    marked = client.post(f"{BASE}/read", headers={"Authorization": "Bearer alice-token"}, json={
        "channel_id": "team",
        "thread_id": first_thread["id"],
        "cursor": first_message["data"]["event_seq"],
        "idempotency_key": "thread-read",
        "dry_run": False,
    })
    assert marked.status_code == 200, marked.text
    unread_ids = [item["id"] for item in client.get(f"{BASE}/inbox", headers={"Authorization": "Bearer alice-token"}).json()["items"]]
    assert first_message["id"] not in unread_ids
    assert second_message["id"] in unread_ids

    wrong_thread = client.post(f"{BASE}/read", headers={"Authorization": "Bearer alice-token"}, json={
        "channel_id": "missing-channel",
        "thread_id": second_thread["id"],
        "cursor": second_message["data"]["event_seq"],
        "idempotency_key": "wrong-thread",
        "dry_run": False,
    })
    assert wrong_thread.status_code == 404


def test_soft_archive_preserves_history_and_blocks_new_messages(tmp_path):
    _app, client, store, workspace, _principals = make_core(tmp_path)
    configure(client)
    thread = create_thread(client, body="")
    message = send_message(client, "team", thread["id"])
    archived = client.post(f"{BASE}/messages/{message['id']}/archive", json={
        "expected_version": message["version"],
        "idempotency_key": "archive-message",
        "dry_run": False,
    })
    assert archived.status_code == 200
    assert archived.json()["items"][0]["status"] == "archived"
    assert store.get(Principal("owner"), workspace, "messages", message["id"])["data"]["body"] == "hello"

    archived_thread = client.post(f"{BASE}/threads/{thread['id']}/archive", json={
        "expected_version": thread["version"] + 1,
        "idempotency_key": "archive-thread",
        "dry_run": False,
    })
    assert archived_thread.status_code == 200
    blocked = client.post(f"{BASE}/messages", json={
        "channel_id": "team",
        "thread_id": thread["id"],
        "body": "too late",
        "idempotency_key": "too-late",
        "dry_run": False,
    })
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "thread_archived"


def test_message_queries_apply_thread_and_recipient_filters_before_limit_without_hard_cap(tmp_path):
    _app, client, _store, _workspace, _principals = make_core(tmp_path)
    configure(client)
    thread = create_thread(client, body="", idempotency_key="bulk-thread")
    other = create_thread(client, body="", title="Other", idempotency_key="bulk-other")
    for index in range(520):
        send_message(client, "team", other["id"], body=f"noise {index}", recipients=["bob"], idempotency_key=f"noise-{index}")
    for index in range(505):
        send_message(client, "team", thread["id"], body=f"visible {index}", recipients=["alice"], idempotency_key=f"visible-{index}")

    first_page = client.get(f"{BASE}/threads/{thread['id']}/messages", headers={"Authorization": "Bearer alice-token"}, params={"limit": 500})
    assert first_page.status_code == 200
    assert len(first_page.json()["items"]) == 500
    cursor = first_page.json()["summary"]["cursor"]
    second_page = client.get(f"{BASE}/threads/{thread['id']}/messages", headers={"Authorization": "Bearer alice-token"}, params={"after": cursor, "limit": 20})
    assert second_page.status_code == 200
    assert len(second_page.json()["items"]) == 5


def test_collaboration_event_filter_prevents_generic_sync_leak(tmp_path):
    _app, client, store, workspace, _principals = make_core(tmp_path)
    configure(client, channel_id="alice-only", members=["owner", "alice"])
    configure(client, channel_id="bob-only", members=["owner", "bob"])
    alice_thread = create_thread(client, channel_id="alice-only", idempotency_key="thread-alice", body="")
    bob_thread = create_thread(client, channel_id="bob-only", idempotency_key="thread-bob", body="", mentions=["bob"])
    alice_message = send_message(client, "alice-only", alice_thread["id"], body="alice", recipients=["alice"], idempotency_key="msg-alice")
    bob_message = send_message(client, "bob-only", bob_thread["id"], body="bob", recipients=["bob"], idempotency_key="msg-bob")
    events = store.stream(Principal("owner"), workspace)

    alice_visible = filter_collaboration_events(store, Principal("alice"), workspace, events)
    bob_visible = filter_collaboration_events(store, Principal("bob"), workspace, events)
    alice_ids = {event["entity_id"] for event in alice_visible}
    bob_ids = {event["entity_id"] for event in bob_visible}
    assert alice_message["id"] in alice_ids
    assert bob_message["id"] not in alice_ids
    assert bob_message["id"] in bob_ids
    assert alice_message["id"] not in bob_ids


def test_restricted_message_activity_is_not_synced_to_other_channel_members(tmp_path):
    _app, client, store, workspace, principals = make_core(tmp_path)
    configure(client)
    thread = create_thread(client, body="")
    message = send_message(client, "team", thread["id"], recipients=["owner", "alice"])
    events = store.stream(principals["owner-token"], workspace)
    touched = next(event for event in events if event["action"] == "collaboration.thread.touched")

    for actor in ("owner", "alice"):
        visible = filter_collaboration_events(store, principals[actor + "-token"], workspace, events)
        assert touched in visible

    bob_events = filter_collaboration_events(store, principals["bob-token"], workspace, events)
    assert any(event["entity_id"] == thread["id"] for event in bob_events)
    assert touched not in bob_events
    assert all(event["entity_id"] != message["id"] for event in bob_events)
    assert all(event["data"].get("message_id") != message["id"] for event in bob_events)


def test_service_rejects_other_tenant_workspace_scope(tmp_path):
    _app, _client, store, workspace, _principals = make_core(tmp_path)
    def actor_directory(principal: Principal, _workspace: str):
        return ["owner", "alice"] if principal.tenant == "local" else ["alice"]

    service = Collaboration(store, actor_directory)
    other = Principal("alice", tenant="other")
    try:
        service.configure_channel(other, workspace, "team", ChannelConfigure(
            title="Other",
            members=["alice"],
            idempotency_key="other",
            dry_run=False,
        ), "trace")
    except CoreError as exc:
        assert exc.status == 404
    else:
        raise AssertionError("other tenant should not access workspace-scoped collaboration")

    owner = Principal("owner")
    channel = service.configure_channel(owner, workspace, "team", ChannelConfigure(
        title="Team",
        members=["owner", "alice"],
        idempotency_key="svc-channel",
        dry_run=False,
    ), "trace")
    thread = service.create_thread(owner, workspace, ThreadCreate(
        channel_id=channel["id"],
        title="Thread",
        idempotency_key="svc-thread",
        dry_run=False,
    ), "trace")
    message = service.send_message(owner, workspace, MessageSend(
        channel_id=channel["id"],
        thread_id=thread["id"],
        body="service",
        idempotency_key="svc-message",
        dry_run=False,
    ), "trace")
    marked = service.mark_read(Principal("alice"), workspace, MarkRead(
        channel_id=channel["id"],
        cursor=message["data"]["event_seq"],
        idempotency_key="svc-read",
        dry_run=False,
    ), "trace")
    assert marked["data"]["actor"] == "alice"


def test_native_actor_directory_uses_live_authenticated_workspace_grants(tmp_path):
    principals = {"owner-token": Principal("owner")}
    app = create_app(tmp_path, "unused", principals=principals)
    store = app.state.hermes_store
    workspace = store.create(principals["owner-token"], "", "workspaces", {"name": "W"}, "w", "trace")["id"]
    principals.update({
        "alice-token": Principal("alice", workspace_ids=frozenset({workspace})),
        "bob-token": Principal("bob"),
        "blocked-token": Principal("blocked", workspace_ids=frozenset()),
        "elsewhere-token": Principal("elsewhere", workspace_ids=frozenset({"elsewhere"})),
        "tenant-token": Principal("other-tenant", tenant="other"),
        "business-token": Principal("other-business", business="other"),
        "": Principal("unusable-token"),
    })
    client = TestClient(app, headers={"Authorization": "Bearer owner-token", "X-Workspace-Id": workspace})
    assert client.get(f"{BASE}/members").json()["items"] == [{"id": name} for name in ["alice", "bob", "owner"]]
    configure(client)
    for actor in ["blocked", "elsewhere", "other-tenant", "other-business", "unusable-token"]:
        denied = client.post(f"{BASE}/channels/{actor}/configure", json={
            "title": actor, "members": [actor], "idempotency_key": actor, "dry_run": False,
        })
        assert denied.status_code == 422
        assert denied.json()["error"]["code"] == "unknown_members"

    thread = create_thread(client, body="")
    body = {"channel_id": "team", "thread_id": thread["id"], "body": "private receipt",
            "idempotency_key": "alice-message", "dry_run": False}
    headers = {"Authorization": "Bearer alice-token"}
    assert client.post(f"{BASE}/messages", headers=headers, json=body).status_code == 200
    alice = principals["alice-token"]
    principals["alice-token"] = replace(alice, permissions=frozenset({"read"}))
    denied = client.post(f"{BASE}/messages", headers=headers, json=body)
    assert denied.status_code == 403
    assert denied.json()["items"] == []
    principals["alice-token"] = replace(alice, workspace_ids=frozenset())
    assert {item["id"] for item in client.get(f"{BASE}/members").json()["items"]} == {"owner", "bob"}
    denied = client.post(f"{BASE}/messages", headers=headers, json=body)
    assert denied.status_code == 403
    assert denied.json()["error"]["message"] == "Workspace access denied"
    assert denied.json().get("items", []) == []
    del principals["alice-token"]
    assert client.post(f"{BASE}/messages", headers=headers, json=body).status_code == 401


@pytest.mark.parametrize("archive_scope", ["channel", "thread", "message"])
@pytest.mark.parametrize("dry_run", [True, False])
def test_archived_history_rejects_new_mutations_and_previews(tmp_path, archive_scope, dry_run):
    _app, client, store, workspace, _principals = make_core(tmp_path)
    configure(client)
    thread = create_thread(client, body="")
    message = send_message(client, "team", thread["id"])
    if archive_scope == "channel":
        configure(client, expected_version=1, archived=True, idempotency_key="close-channel")
    else:
        resource, item, version = ("threads", thread, 2) if archive_scope == "thread" else ("messages", message, 1)
        assert client.post(f"{BASE}/{resource}/{item['id']}/archive", json={
            "expected_version": version, "idempotency_key": "archive", "dry_run": False,
        }).status_code == 200
    before = store.stream(Principal("owner"), workspace)
    current = store.get(Principal("owner"), workspace, "messages", message["id"])
    denied = client.patch(f"{BASE}/messages/{message['id']}", json={
        "body": "rewrite history", "expected_version": current["version"],
        "idempotency_key": "edit-archived", "dry_run": dry_run,
    })
    assert denied.status_code == 409
    assert denied.json()["error"]["code"] == f"{archive_scope}_archived"
    if archive_scope != "message":
        denied = client.post(f"{BASE}/messages", json={
            "channel_id": "team", "thread_id": thread["id"], "body": "new message",
            "idempotency_key": "new-message", "dry_run": dry_run,
        })
        assert denied.status_code == 409
        assert denied.json()["error"]["code"] == f"{archive_scope}_archived"
        history = client.get(f"{BASE}/threads/{thread['id']}/messages")
        assert history.status_code == 200
        assert history.json()["items"][0]["data"]["body"] == "hello"
    if archive_scope == "channel":
        denied = client.post(f"{BASE}/threads", json={
            "channel_id": "team", "title": "New thread", "body": "new message",
            "idempotency_key": "new-thread", "dry_run": dry_run,
        })
        assert denied.status_code == 409
        assert denied.json()["error"]["code"] == "channel_archived"
    denied = client.post(f"{BASE}/messages/{message['id']}/archive", json={
        "expected_version": current["version"], "idempotency_key": "archive-again", "dry_run": dry_run,
    })
    assert denied.status_code == 409
    assert store.stream(Principal("owner"), workspace) == before
    assert store.get(Principal("owner"), workspace, "messages", message["id"])["data"]["body"] == "hello"


@pytest.mark.parametrize("archive_scope", ["channel", "thread"])
def test_cached_success_survives_archive_but_not_channel_revocation(tmp_path, archive_scope):
    _app, client, store, workspace, _principals = make_core(tmp_path)
    configure(client)
    thread_body = {"channel_id": "team", "title": "Thread", "idempotency_key": "thread-retry", "dry_run": False}
    headers = {"Authorization": "Bearer alice-token"}
    thread = client.post(f"{BASE}/threads", headers=headers, json=thread_body).json()["items"][0]
    send_body = {"channel_id": "team", "thread_id": thread["id"], "body": "original",
                 "recipients": ["alice", "bob"], "idempotency_key": "send-retry", "dry_run": False}
    sent = client.post(f"{BASE}/messages", headers=headers, json=send_body).json()["items"][0]
    edit_body = {"body": "edited", "expected_version": 1, "idempotency_key": "edit-retry", "dry_run": False}
    edited = client.patch(f"{BASE}/messages/{sent['id']}", headers=headers, json=edit_body).json()["items"][0]
    read_body = {"channel_id": "team", "thread_id": thread["id"], "cursor": sent["data"]["event_seq"],
                 "idempotency_key": "read-retry", "dry_run": False}
    read = client.post(f"{BASE}/read", headers=headers, json=read_body).json()["items"][0]
    archive_body = {"expected_version": 2, "idempotency_key": "thread-archive", "dry_run": False}
    if archive_scope == "channel":
        configure(client, expected_version=1, archived=True, idempotency_key="close-channel")
    else:
        assert client.post(f"{BASE}/threads/{thread['id']}/archive", headers=headers, json=archive_body).status_code == 200
    # Removing another recipient must not invalidate the caller's own successful receipt.
    configure(client, members=["owner", "alice"], expected_version=2 if archive_scope == "channel" else 1,
              archived=archive_scope == "channel", idempotency_key="remove-bob")
    operations = [("POST", f"{BASE}/threads", thread_body, thread),
                  ("POST", f"{BASE}/messages", send_body, sent),
                  ("PATCH", f"{BASE}/messages/{sent['id']}", edit_body, edited),
                  ("POST", f"{BASE}/read", read_body, read)]
    if archive_scope == "thread":
        archived = store.get(Principal("alice"), workspace, "threads", thread["id"])
        operations.append(("POST", f"{BASE}/threads/{thread['id']}/archive", archive_body, archived))
    before = store.stream(Principal("owner"), workspace)
    for method, url, body, expected in operations:
        replay = client.request(method, url, headers=headers, json=body)
        assert replay.status_code == 200, replay.text
        assert replay.json()["items"][0] == expected
    assert store.stream(Principal("owner"), workspace) == before
    conflict = client.post(f"{BASE}/messages", headers=headers, json={**send_body, "body": "different"})
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_conflict"
    configure(client, members=["owner"], expected_version=3 if archive_scope == "channel" else 2,
              archived=archive_scope == "channel", idempotency_key="remove-alice")
    for method, url, body, _expected in operations:
        denied = client.request(method, url, headers=headers, json=body)
        assert denied.status_code == 403
        assert "items" not in denied.json()


@pytest.mark.parametrize("revocation", ["channel", "workspace"])
def test_cached_send_rechecks_channel_membership_inside_transaction(tmp_path, monkeypatch, revocation):
    _app, client, store, workspace, _principals = make_core(tmp_path)
    configure(client)
    thread = create_thread(client, body="")
    service = Collaboration(store)
    body = MessageSend(channel_id="team", thread_id=thread["id"], body="receipt",
                       idempotency_key="race-retry", dry_run=False)
    service.send_message(Principal("alice"), workspace, body, "trace")
    original_channel = service._channel

    def revoke_after_precheck(principal, selected_workspace, channel_id):
        channel = original_channel(principal, selected_workspace, channel_id)
        if revocation == "channel":
            configure(client, members=["owner", "bob"], expected_version=1, idempotency_key="revoke-race")
        else:
            store.mutate(Principal("owner"), "", "workspaces", workspace, operation="archive-workspace",
                         key="revoke-race", request={}, trace="trace", expected=1,
                         transform=lambda _item: {"status": "archived"})
        return channel

    monkeypatch.setattr(service, "_channel", revoke_after_precheck)
    with pytest.raises(CoreError) as denied:
        service.send_message(Principal("alice"), workspace, body, "trace")
    assert denied.value.status == (403 if revocation == "channel" else 409)


def test_configure_receipt_cannot_leak_after_config_principal_removed_from_channel(tmp_path):
    _app, client, store, workspace, principals = make_core(tmp_path)
    body = {"title": "Team", "members": ["owner", "alice"], "idempotency_key": "configure-retry", "dry_run": False}
    assert client.post(f"{BASE}/channels/team/configure", json=body).status_code == 200
    principals["alice-token"] = Principal("alice")
    changed = client.post(f"{BASE}/channels/team/configure", headers={"Authorization": "Bearer alice-token"}, json={
        "title": "Team", "members": ["alice"], "expected_version": 1,
        "idempotency_key": "remove-owner", "dry_run": False,
    })
    assert changed.status_code == 200
    before = store.stream(Principal("owner"), workspace)
    denied = client.post(f"{BASE}/channels/team/configure", json=body)
    assert denied.status_code == 403
    assert denied.json().get("items", []) == []
    assert store.stream(Principal("owner"), workspace) == before
