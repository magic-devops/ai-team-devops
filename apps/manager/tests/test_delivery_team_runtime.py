"""Team execution association pins real profiles without granting runtime access."""

from copy import deepcopy
from importlib import import_module, util
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from hermes_core.agents import AgentProfile
from hermes_core.models import Principal
from hermes_core.transactional import Store, digest
from sop_manager.routers import sql_models
from sop_manager.routers.hermes_workspace import runtime_identity
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


def module():
    assert util.find_spec("sop_manager.routers.delivery_team_runtime"), (
        "Scoped team runtime binding service is not implemented"
    )
    return import_module("sop_manager.routers.delivery_team_runtime")


@pytest.fixture(params=["agent", "tool"])
def bindings(tmp_path, request):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    sql_models.Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions() as db:
        db.add_all(
            [
                sql_models.Tenant(id="tenant", name="Tenant", slug="tenant"),
                sql_models.Tenant(id="other", name="Other", slug="other"),
            ]
        )
        db.flush()
        users = {}
        unusable_hash = "not-a-login"
        for uid, role, tenant in [
            ("config", "project_admin", "tenant"),
            ("writer", "developer", "tenant"),
            ("outsider", "project_admin", "tenant"),
            ("foreign", "super_admin", "other"),
        ]:
            users[uid] = sql_models.User(
                id=uid, tenant_id=tenant, username=uid, role=role, password_hash=unusable_hash
            )
            db.add(users[uid])
        project = sql_models.Project(
            id="project", tenant_id="tenant", name="Project", project_path=str(tmp_path)
        )
        db.add(project)
        db.flush()
        db.add_all(
            [
                sql_models.ProjectMember(project_id="project", user_id=uid, role=role)
                for uid, role in [("config", "project_admin"), ("writer", "developer")]
            ]
        )
        db.commit()
        store = Store("sqlite:///" + (tmp_path / "runtime.sqlite").as_posix())
        principal = Principal("config", tenant="tenant", business="team")
        workspace = store.create(
            principal,
            "",
            "workspaces",
            {"name": "Execution workspace", "root": str(tmp_path), "owner": "config", "members": ["writer"]},
            "workspace",
            "test",
        )
        private = store.create(
            principal,
            "",
            "workspaces",
            {"name": "Private workspace", "root": str(tmp_path), "owner": "outsider"},
            "private",
            "test",
        )
        agents = [
            store.create(
                principal,
                workspace["id"],
                "agents",
                AgentProfile(
                    title="Same label",
                    provider=provider,
                    instructions="private instructions are never public",
                ).model_dump(),
                provider,
                "test",
            )
            for provider in ["codex", "opencode"]
        ]
        private_agent = store.create(
            principal,
            private["id"],
            "agents",
            AgentProfile(title="Private", provider="codex").model_dump(),
            "private-agent",
            "test",
        )
        state = {
            "members": [
                {
                    "id": "member-a",
                    "name": "Same label",
                    "kind": request.param,
                    "active": True,
                    "role": "Implementer",
                    "tool": "codex",
                },
                {
                    "id": "member-b",
                    "name": "Same label",
                    "kind": "agent",
                    "active": True,
                    "role": "Implementer",
                    "tool": "codex",
                },
                {"id": "tool", "name": "Tool", "kind": "tool", "active": True},
                {"id": "inactive", "name": "Inactive", "kind": "agent", "active": False},
            ]
        }
        yield SimpleNamespace(
            db=db,
            project=project,
            users=users,
            store=store,
            principal=principal,
            workspace=workspace,
            private=private,
            private_agent=private_agent,
            agents=agents,
            state=state,
        )
        store.engine.dispose()
    engine.dispose()


def bind(env, *, member_id="member-a", agent=None, user=None, workspace=None):
    agent = agent or env.agents[0]
    body = SimpleNamespace(
        member_id=member_id,
        workspace_id=(workspace or env.workspace)["id"],
        agent_id=agent["id"],
        agent_version=agent["version"],
    )
    return module().apply_runtime_binding(
        env.db, env.project, env.state, user or env.users["config"], env.store, "member.runtime.bind", body
    )


def view(env, *, user=None, can_configure=True, store=...):
    return module().runtime_bindings_view(
        env.db,
        env.project,
        env.state,
        user or env.users["config"],
        env.store if store is ... else store,
        can_configure=can_configure,
        version=7,
    )


def resolve(env, *, member_id="member-a", basis=None, agent=None, user=None):
    agent = agent or env.agents[0]
    return module().resolve_executor_binding(
        env.db,
        env.project,
        env.state,
        user or env.users["config"],
        env.store,
        member_id=member_id,
        expected_basis=basis or module().binding_basis(env.project, env.state, member_id),
        workspace_id=env.workspace["id"],
        agent_id=agent["id"],
        agent_version=agent["version"],
    )


def test_unbound_state_is_read_only_and_cannot_supply_an_executor(bindings):
    api = module()
    before = deepcopy(bindings.state)
    result = view(bindings)
    row = next(m for m in result["members"] if m["member_id"] == "member-a")
    assert result["version"] == 7 and result["runtime_configured"]
    assert row["status"] == "unbound" and row["generation"] == 0 and row["binding"] is None
    assert row["permissions"] == {"can_bind": True, "can_unbind": False}
    assert row["reasons"][0]["code"] == "executor_unbound"
    assert not api.execution_binding_current(
        bindings.project, bindings.state, "member-a", row["binding_basis"]
    )["current"]
    assert bindings.state == before


def test_configure_and_runtime_read_without_execute_can_bind_and_pin_profile(bindings):
    principal = runtime_identity(bindings.users["config"], bindings.store)
    assert "read" in principal.permissions and "execute" not in principal.permissions
    _, before = bind(bindings)
    assert before is None
    saved = bindings.state["member_runtime_bindings"]["member-a"]
    assert saved["generation"] == 1 and saved["status"] == "bound"
    assert saved["binding"]["profile_digest"] == digest(bindings.agents[0]["data"])
    snapshot = resolve(bindings)
    assert snapshot["member_id"] == "member-a" and snapshot["member_name"] == "Same label"
    assert snapshot["binding_generation"] == 1
    assert snapshot["recorded_at"] == saved["binding"]["bound_at"]
    assert snapshot["recorded_by"] == "config"
    assert "instructions" not in str(view(bindings))
    assert runtime_identity(bindings.users["config"], bindings.store) == principal
    assert "execute" not in principal.permissions


def test_same_name_members_share_a_profile_without_merging_identity(bindings):
    bind(bindings)
    bind(bindings, member_id="member-b")
    first, second = resolve(bindings), resolve(bindings, member_id="member-b")
    assert first["agent_id"] == second["agent_id"]
    assert first["member_id"] != second["member_id"]
    assert first["binding_basis"] != second["binding_basis"]


@pytest.mark.parametrize("member_id", ["user:config", "inactive", "missing"])
def test_only_available_registered_executors_can_bind(bindings, member_id):
    with pytest.raises(HTTPException) as error:
        bind(bindings, member_id=member_id)
    assert error.value.status_code in {409, 422}
    assert "member_runtime_bindings" not in bindings.state


def test_tool_catalogue_and_binding_pin_real_profile_without_changing_permissions(bindings):
    before = deepcopy(bindings.state)
    unbound = next(row for row in view(bindings)["members"] if row["member_id"] == "tool")
    assert unbound["member_name"] == "Tool" and unbound["member_kind"] == "tool"
    assert unbound["status"] == "unbound" and unbound["permissions"]["can_bind"]
    assert bindings.state == before
    principal = runtime_identity(bindings.users["config"], bindings.store)
    bind(bindings, member_id="tool")
    row = next(row for row in view(bindings)["members"] if row["member_id"] == "tool")
    assert row["status"] == "current" and row["generation"] == 1
    snapshot = resolve(bindings, member_id="tool")
    assert snapshot["member_id"] == "tool" and snapshot["member_name"] == "Tool"
    assert snapshot["profile_digest"] == digest(bindings.agents[0]["data"])
    assert "instructions" not in str(view(bindings))
    assert runtime_identity(bindings.users["config"], bindings.store) == principal
    assert "execute" not in principal.permissions


@pytest.mark.parametrize("kind,active,code", [
    ("human", True, "executor_member_kind_unsupported"),
    ("unknown", True, "executor_member_kind_unsupported"),
    ("tool", False, "executor_member_inactive"),
])
def test_humans_unsupported_kinds_and_inactive_tools_cannot_bind(bindings, kind, active, code):
    bindings.state["members"].append({"id": "candidate", "kind": kind, "active": active})
    before = deepcopy(bindings.state)
    with pytest.raises(HTTPException) as error:
        bind(bindings, member_id="candidate")
    assert error.value.status_code == 422 and error.value.detail["code"] == code
    assert bindings.state == before


def test_directory_identity_is_null_for_a_removed_member_and_does_not_invent_a_label(bindings):
    bind(bindings, member_id="tool")
    bindings.state["members"] = [row for row in bindings.state["members"] if row["id"] != "tool"]
    row = next(row for row in view(bindings)["members"] if row["member_id"] == "tool")
    assert row["member_name"] is None and row["member_kind"] is None
    assert row["status"] == "unavailable" and row["reasons"][0]["code"] == "executor_member_missing"


def test_binding_requires_project_configuration_authority(bindings):
    with pytest.raises(HTTPException) as error:
        bind(bindings, user=bindings.users["writer"])
    assert error.value.status_code == 403
    assert "member_runtime_bindings" not in bindings.state


def test_project_admin_role_does_not_replace_membership_of_this_project(bindings):
    with pytest.raises(HTTPException) as error:
        bind(
            bindings,
            user=bindings.users["outsider"],
            workspace=bindings.private,
            agent=bindings.private_agent,
        )
    assert error.value.status_code == 403
    assert "member_runtime_bindings" not in bindings.state


def test_stale_selected_version_is_rejected_before_binding_mutation(bindings):
    body = SimpleNamespace(
        member_id="member-a",
        workspace_id=bindings.workspace["id"],
        agent_id=bindings.agents[0]["id"],
        agent_version=2,
    )
    before = deepcopy(bindings.state)
    with pytest.raises(HTTPException) as error:
        module().apply_runtime_binding(
            bindings.db,
            bindings.project,
            bindings.state,
            bindings.users["config"],
            bindings.store,
            "member.runtime.bind",
            body,
        )
    assert error.value.detail["code"] == "runtime_agent_changed"
    assert before == bindings.state


def test_configurer_can_unbind_without_runtime_or_active_member(bindings):
    bind(bindings)
    bindings.state["members"][0]["active"] = False
    module().apply_runtime_binding(
        bindings.db,
        bindings.project,
        bindings.state,
        bindings.users["config"],
        None,
        "member.runtime.unbind",
        SimpleNamespace(member_id="member-a"),
    )
    assert bindings.state["member_runtime_bindings"]["member-a"]["binding"] is None


def test_runtime_acl_is_checked_before_reading_any_agent_profile(bindings):
    statements = []

    def observed(conn, cursor, statement, parameters, context, executemany):
        statements.append(parameters)

    event.listen(bindings.store.engine, "before_cursor_execute", observed)
    with pytest.raises(HTTPException) as error:
        bind(bindings, workspace=bindings.private, agent=bindings.private_agent)
    assert error.value.status_code == 403
    assert all("agents" not in parameters for parameters in statements)
    event.remove(bindings.store.engine, "before_cursor_execute", observed)


def test_super_admin_cannot_bind_another_tenants_workspace_into_project(bindings):
    foreign = Principal("foreign", tenant="other", business="team")
    workspace = bindings.store.create(
        foreign,
        "",
        "workspaces",
        {"name": "Other", "owner": "foreign", "root": "."},
        "foreign-workspace",
        "test",
    )
    agent = bindings.store.create(
        foreign,
        workspace["id"],
        "agents",
        AgentProfile(title="Other", provider="codex").model_dump(),
        "foreign-agent",
        "test",
    )
    with pytest.raises(HTTPException) as error:
        bind(bindings, user=bindings.users["foreign"], workspace=workspace, agent=agent)
    assert error.value.status_code in {403, 404}


@pytest.mark.parametrize("change", ["version", "digest", "archive", "workspace_archive"])
def test_current_profile_drift_is_never_silently_adopted(bindings, change):
    bind(bindings)
    agent = bindings.agents[0]
    if change == "digest":
        from sqlalchemy import update

        with bindings.store.engine.begin() as conn:
            conn.execute(
                update(bindings.store.entities)
                .where(bindings.store.entities.c.id == agent["id"])
                .values(data={**agent["data"], "model": "changed-without-version"})
            )
    else:
        entity, workspace, kind = (
            (bindings.workspace, "", "workspaces")
            if change == "workspace_archive"
            else (agent, bindings.workspace["id"], "agents")
        )
        bindings.store.mutate(
            bindings.principal,
            workspace,
            kind,
            entity["id"],
            operation="test.change",
            key=change,
            request={},
            trace="test",
            expected=entity["version"],
            transform=lambda row: (
                {"status": "archived"}
                if change in {"archive", "workspace_archive"}
                else {"data": {**row["data"], "model": "new-model"}}
            ),
        )
    with pytest.raises(HTTPException) as error:
        resolve(bindings)
    assert error.value.status_code == 409
    row = next(m for m in view(bindings)["members"] if m["member_id"] == "member-a")
    assert row["status"] in {"stale", "unavailable"}
    assert row["binding"]["agent_version"] == 1


def test_generation_prevents_unbind_and_rebind_to_original_from_reviving_plan(bindings):
    api = module()
    bind(bindings)
    original = api.binding_basis(bindings.project, bindings.state, "member-a")
    api.apply_runtime_binding(
        bindings.db,
        bindings.project,
        bindings.state,
        bindings.users["config"],
        None,
        "member.runtime.unbind",
        SimpleNamespace(member_id="member-a"),
    )
    record = bindings.state["member_runtime_bindings"]["member-a"]
    assert record["status"] == "unbound" and record["binding"] is None and record["generation"] == 2
    bind(bindings)
    assert bindings.state["member_runtime_bindings"]["member-a"]["generation"] == 3
    assert not api.execution_binding_current(bindings.project, bindings.state, "member-a", original)[
        "current"
    ]


def test_binding_a_b_a_preserves_staleness_and_new_snapshot_generation(bindings):
    api = module()
    bind(bindings)
    original = resolve(bindings)
    bind(bindings, agent=bindings.agents[1])
    bind(bindings)
    assert not api.execution_binding_current(
        bindings.project, bindings.state, "member-a", original["binding_basis"]
    )["current"]
    assert resolve(bindings)["binding_generation"] == 3
    assert original["binding_generation"] == 1


def test_member_display_and_workspace_general_version_do_not_change_binding_basis(bindings):
    api = module()
    bind(bindings)
    original = api.binding_basis(bindings.project, bindings.state, "member-a")
    bindings.state["members"][0].update(name="Renamed", role="A different role", tool="zed")
    bindings.store.mutate(
        bindings.principal,
        "",
        "workspaces",
        bindings.workspace["id"],
        operation="test.rename",
        key="rename",
        request={},
        trace="test",
        expected=1,
        transform=lambda row: {"data": {**row["data"], "name": "Renamed workspace"}},
    )
    assert api.binding_basis(bindings.project, bindings.state, "member-a") == original
    assert resolve(bindings)["binding_basis"] == original
    assert resolve(bindings)["workspace_name"] == "Execution workspace"


def test_member_deactivation_leaves_tombstone_and_reactivation_requires_explicit_binding(bindings):
    api = module()
    bind(bindings)
    original = resolve(bindings)
    bindings.state["members"][0]["active"] = False
    assert api.invalidate_member_runtime_binding(
        bindings.state, "member-a", actor="config", reason="executor_member_inactive"
    )
    assert not api.invalidate_member_runtime_binding(
        bindings.state, "member-a", actor="config", reason="executor_member_inactive"
    )
    bindings.state["members"][0]["active"] = True
    record = bindings.state["member_runtime_bindings"]["member-a"]
    assert record["generation"] == 2 and record["binding"] is None
    assert not api.execution_binding_current(
        bindings.project, bindings.state, "member-a", original["binding_basis"]
    )["current"]
    with pytest.raises(HTTPException):
        resolve(bindings)


def test_explicit_agent_selection_cannot_disagree_with_bound_profile(bindings):
    bind(bindings)
    with pytest.raises(HTTPException) as error:
        resolve(bindings, agent=bindings.agents[1])
    assert error.value.detail["code"] == "executor_selection_mismatch"


def test_unreadable_runtime_preserves_saved_provenance_and_allows_unbind(bindings):
    bind(bindings)
    before = deepcopy(bindings.state)
    row = next(
        m for m in view(bindings, user=bindings.users["outsider"])["members"] if m["member_id"] == "member-a"
    )
    assert row["status"] == "unavailable" and row["permissions"] == {"can_bind": True, "can_unbind": True}
    assert row["binding"]["source"]["agent_title"] == "Same label"
    assert row["reasons"][0]["code"] == "runtime_workspace_forbidden"
    assert bindings.state == before
    absent = next(m for m in view(bindings, store=None)["members"] if m["member_id"] == "member-a")
    assert absent["status"] == "unavailable" and absent["permissions"]["can_unbind"]


def test_binding_view_and_resolution_do_not_change_either_store(bindings):
    bind(bindings)
    state = deepcopy(bindings.state)
    with bindings.store.engine.connect() as conn:
        counts = [
            conn.scalar(select(func.count()).select_from(table))
            for table in [bindings.store.entities, bindings.store.events, bindings.store.receipts]
        ]
    first, second = resolve(bindings), resolve(bindings)
    assert first == second
    view(bindings)
    assert state == bindings.state
    with bindings.store.engine.connect() as conn:
        assert counts == [
            conn.scalar(select(func.count()).select_from(table))
            for table in [bindings.store.entities, bindings.store.events, bindings.store.receipts]
        ]
    assert not bindings.db.new and not bindings.db.dirty
