"""Authenticated independent Manager object discussions and bounded provenance reads."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi import Path as ApiPath
from sqlalchemy.orm import Session

from . import delivery_discussion_contract as c
from . import delivery_discussion_query as reads
from .auth_sql import current_user
from .delivery_discussion import mutate
from .delivery_discussion_common import authorize, entity, thread, version
from .delivery_discussion_sources import canonical_basis, public_refs, resolve_reference
from .sql_models import User, get_session

router = APIRouter(prefix="/api/v1/delivery", tags=["delivery-discussions"])
DB = Annotated[Session, Depends(get_session)]
Actor = Annotated[User, Depends(current_user)]
ProjectHeader = Annotated[str | None, Header(alias="X-Project-Id")]
Limit = Annotated[int, Query(ge=1, le=50)]


def _store(request):
    return getattr(request.app.state, "hermes_store", None)


@router.get("/discussions", response_model=c.DiscussionPage)
def discussion_list(
    db: DB,
    user: Actor,
    x_project_id: ProjectHeader = None,
    subject_kind: c.SubjectKind | None = None,
    subject_id: str | None = None,
    state: Literal["all", "open", "resolved", "archived"] = "all",
    limit: Limit = 20,
    cursor: str = "",
):
    project, user, _ = authorize(db, user, x_project_id)
    return reads.thread_page(
        db,
        project,
        user,
        subject_kind=subject_kind,
        subject_id=subject_id,
        state=state,
        limit=limit,
        token=cursor,
    )


@router.post("/discussions", response_model=c.DiscussionAck)
def discussion_create(
    body: c.DiscussionCreate, request: Request, db: DB, user: Actor, x_project_id: ProjectHeader = None
):
    project, user, _ = authorize(db, user, x_project_id)
    return mutate(db, project, user, body, "create", store=_store(request))


@router.get("/discussion-references/{kind}/{entity_id}", response_model=c.ReferenceDetail)
def reference_detail(
    kind: c.ReferenceKind,
    entity_id: str,
    request: Request,
    db: DB,
    user: Actor,
    field: c.ReferenceField,
    criterion_index: Annotated[int | None, Query(ge=0)] = None,
    source_content_basis: Annotated[str | None, Query(pattern="^[a-f0-9]{64}$")] = None,
    x_project_id: ProjectHeader = None,
):
    project, user, _ = authorize(db, user, x_project_id)
    value = resolve_reference(
        db,
        project,
        user,
        {
            "kind": kind,
            "id": entity_id,
            "field": field,
            "criterion_index": criterion_index,
            "source_content_basis": source_content_basis,
        },
        store=_store(request),
        check_basis=source_content_basis is not None,
    )
    return {
        "project_id": project.id,
        "reference": public_refs([value], _store(request), user, project)[0],
        "target_content_basis": canonical_basis(entity(db, project, kind, entity_id), kind)
        if kind != "execution"
        else None,
    }


@router.get("/sources", response_model=c.SourcePage)
def source_list(
    request: Request,
    db: DB,
    user: Actor,
    target_kind: c.SubjectKind,
    target_id: str,
    x_project_id: ProjectHeader = None,
    limit: Limit = 20,
    cursor: str = "",
):
    project, user, _ = authorize(db, user, x_project_id)
    return reads.source_page(
        db,
        project,
        user,
        target_kind=target_kind,
        target_id=target_id,
        limit=limit,
        token=cursor,
        store=_store(request),
    )


@router.get("/discussions/{thread_id}", response_model=c.DiscussionDetail)
def discussion_detail(thread_id: str, db: DB, user: Actor, x_project_id: ProjectHeader = None):
    project, user, permissions = authorize(db, user, x_project_id)
    return reads.thread_detail(db, project, user, permissions, thread_id)


@router.get("/discussions/{thread_id}/links", response_model=c.SourcePage)
def discussion_links(
    thread_id: str,
    request: Request,
    db: DB,
    user: Actor,
    x_project_id: ProjectHeader = None,
    resolution_event_id: str | None = None,
    limit: Limit = 20,
    cursor: str = "",
):
    project, user, _ = authorize(db, user, x_project_id)
    return reads.source_page(
        db,
        project,
        user,
        thread_id=thread_id,
        resolution_event_id=resolution_event_id,
        limit=limit,
        token=cursor,
        store=_store(request),
    )


@router.post("/discussions/{thread_id}/links", response_model=c.DiscussionAck)
def discussion_link(
    thread_id: str,
    body: c.DiscussionLink,
    request: Request,
    db: DB,
    user: Actor,
    x_project_id: ProjectHeader = None,
):
    project, user, _ = authorize(db, user, x_project_id)
    return mutate(db, project, user, body, "link", thread_id=thread_id, store=_store(request))


@router.get("/discussions/{thread_id}/messages", response_model=c.MessagePage)
def message_list(
    thread_id: str,
    request: Request,
    db: DB,
    user: Actor,
    x_project_id: ProjectHeader = None,
    limit: Limit = 20,
    cursor: str = "",
):
    project, user, permissions = authorize(db, user, x_project_id)
    return reads.message_page(
        db, project, user, permissions, thread_id, limit=limit, token=cursor, store=_store(request)
    )


@router.post("/discussions/{thread_id}/messages", response_model=c.DiscussionAck)
def message_create(
    thread_id: str,
    body: c.MessageCreate,
    request: Request,
    db: DB,
    user: Actor,
    x_project_id: ProjectHeader = None,
):
    project, user, _ = authorize(db, user, x_project_id)
    return mutate(db, project, user, body, "reply", thread_id=thread_id, store=_store(request))


@router.get("/discussions/{thread_id}/messages/{message_id}", response_model=c.MessageDetail)
def message_detail(
    thread_id: str, message_id: str, request: Request, db: DB, user: Actor, x_project_id: ProjectHeader = None
):
    project, user, permissions = authorize(db, user, x_project_id)
    return reads.message_detail(db, project, user, permissions, thread_id, message_id, store=_store(request))


@router.patch("/discussions/{thread_id}/messages/{message_id}", response_model=c.DiscussionAck)
def message_edit(
    thread_id: str,
    message_id: str,
    body: c.MessageEdit,
    request: Request,
    db: DB,
    user: Actor,
    x_project_id: ProjectHeader = None,
):
    project, user, _ = authorize(db, user, x_project_id)
    return mutate(
        db, project, user, body, "edit", thread_id=thread_id, message_id=message_id, store=_store(request)
    )


@router.post("/discussions/{thread_id}/messages/{message_id}/withdraw", response_model=c.DiscussionAck)
def message_withdraw(
    thread_id: str,
    message_id: str,
    body: c.MessageWithdraw,
    request: Request,
    db: DB,
    user: Actor,
    x_project_id: ProjectHeader = None,
):
    project, user, _ = authorize(db, user, x_project_id)
    return mutate(
        db, project, user, body, "withdraw", thread_id=thread_id, message_id=message_id, store=_store(request)
    )


@router.get("/discussions/{thread_id}/messages/{message_id}/versions", response_model=c.VersionPage)
def message_versions(
    thread_id: str,
    message_id: str,
    request: Request,
    db: DB,
    user: Actor,
    x_project_id: ProjectHeader = None,
    limit: Limit = 20,
    cursor: str = "",
):
    project, user, _ = authorize(db, user, x_project_id)
    return reads.version_page(
        db, project, user, thread_id, message_id, limit=limit, token=cursor, store=_store(request)
    )


@router.get(
    "/discussions/{thread_id}/messages/{message_id}/versions/{revision}", response_model=c.VersionDetail
)
def message_version(
    thread_id: str,
    message_id: str,
    revision: Annotated[int, ApiPath(ge=1)],
    request: Request,
    db: DB,
    user: Actor,
    x_project_id: ProjectHeader = None,
):
    project, user, _ = authorize(db, user, x_project_id)
    thread(db, project, thread_id)
    selected = version(db, project, thread_id, message_id, revision)
    return {
        "project_id": project.id,
        "thread_id": thread_id,
        "message_id": message_id,
        "version": reads.version_item(selected, _store(request), user, project),
    }


@router.post("/discussions/{thread_id}/resolve", response_model=c.DiscussionAck)
def discussion_resolve(
    thread_id: str,
    body: c.DiscussionResolve,
    request: Request,
    db: DB,
    user: Actor,
    x_project_id: ProjectHeader = None,
):
    project, user, _ = authorize(db, user, x_project_id)
    return mutate(db, project, user, body, "resolve", thread_id=thread_id, store=_store(request))


@router.post("/discussions/{thread_id}/reopen", response_model=c.DiscussionAck)
@router.post("/discussions/{thread_id}/archive", response_model=c.DiscussionAck)
@router.post("/discussions/{thread_id}/restore", response_model=c.DiscussionAck)
def discussion_state(
    thread_id: str,
    body: c.DiscussionStateChange,
    request: Request,
    db: DB,
    user: Actor,
    x_project_id: ProjectHeader = None,
):
    project, user, _ = authorize(db, user, x_project_id)
    return mutate(
        db,
        project,
        user,
        body,
        request.url.path.rsplit("/", 1)[-1],
        thread_id=thread_id,
        store=_store(request),
    )
