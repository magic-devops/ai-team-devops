"""Authenticated SQL design catalogue; legacy user files are never traversed or removed."""
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy.orm import Session

from .auth_sql import current_user_or_apikey
from .design_contract import DocumentPage, DocumentView, RevisionPage, RevisionView, RevisionCompare
from .sql_models import User, get_session

router = APIRouter(prefix="/api/v1/design-docs", tags=["design-docs"])
Actor = Annotated[User, Depends(current_user_or_apikey)]
Database = Annotated[Session, Depends(get_session)]
ProjectHeader = Annotated[str, Header(alias="X-Project-Id")]


def _project(db, user, identity):
    from .delivery import _project as project

    return project(db, user, identity)


@router.get("", response_model=DocumentPage)
def list_docs(user: Actor, db: Database, project_id: ProjectHeader,
              limit: Annotated[int, Query(ge=1, le=100)] = 20,
              cursor: Annotated[str, Query(max_length=4000)] = "",
              q: Annotated[str, Query(max_length=200)] = "", include_archived: bool = False):
    from .design_query import documents

    with db.no_autoflush:
        return documents(db, _project(db, user, project_id), user, limit=limit, cursor=cursor, q=q, include_archived=include_archived)


@router.get("/{document_id}", response_model=DocumentView)
def get_doc(document_id: str, user: Actor, db: Database, project_id: ProjectHeader):
    from .design_query import document

    with db.no_autoflush:
        return document(db, _project(db, user, project_id), user, document_id)


@router.get("/{document_id}/revisions", response_model=RevisionPage)
def list_versions(document_id: str, user: Actor, db: Database, project_id: ProjectHeader,
                  limit: Annotated[int, Query(ge=1, le=100)] = 20,
                  cursor: Annotated[str, Query(max_length=4000)] = ""):
    from .design_query import revisions

    with db.no_autoflush:
        return revisions(db, _project(db, user, project_id), user, document_id, limit=limit, cursor=cursor)


@router.get("/{document_id}/revisions/{revision_id}", response_model=RevisionView)
def get_version(document_id: str, revision_id: str, user: Actor, db: Database, project_id: ProjectHeader):
    from .design_query import revision

    with db.no_autoflush:
        return revision(db, _project(db, user, project_id), user, document_id, revision_id)


@router.get("/{document_id}/compare", response_model=RevisionCompare)
def compare_versions(document_id: str, user: Actor, db: Database, project_id: ProjectHeader,
                     from_id: Annotated[str, Query(alias="from", min_length=1, max_length=64)],
                     to_id: Annotated[str, Query(alias="to", min_length=1, max_length=64)]):
    from .design_query import compare

    with db.no_autoflush:
        return compare(db, _project(db, user, project_id), user, document_id, from_id, to_id)


# Model generation is an independent durable preview; saving is always an explicit
# design.revision.save command after the user has inspected the complete result.
from .design_generation_contract import PreviewInput, PreviewView  # noqa: E402


@router.post("/{document_id}/previews", response_model=PreviewView)
def generate_design(document_id: str, body: PreviewInput, request: Request,
                    user: Actor, db: Database, project_id: ProjectHeader):
    from .design_generation import generate_preview

    return generate_preview(db, _project(db, user, project_id), user, document_id, body, request)


@router.get("/{document_id}/previews/{preview_id}", response_model=PreviewView)
def design_preview(document_id: str, preview_id: str, user: Actor, db: Database, project_id: ProjectHeader):
    from .design_generation import preview_detail

    with db.no_autoflush:
        return preview_detail(db, _project(db, user, project_id), user, document_id, preview_id)
