"""Authenticated canonical reflection reads. GET never repairs storage."""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from . import reflection_contract as c
from . import reflection_query as q
from . import sql_models as m
from .auth_sql import current_user_or_apikey
from .event_common import authorize, fail

router = APIRouter(prefix="/api/v1/reflections", tags=["reflections"])
User = Annotated[m.User, Depends(current_user_or_apikey)]
Database = Annotated[Session, Depends(m.get_session)]


def read(call, *args, **kwargs):
    try:
        return call(*args, **kwargs)
    except (OperationalError, ProgrammingError) as exc:
        from fastapi import HTTPException

        raise HTTPException(503, {"code": "reflection_storage_unavailable", "message": "Reflection storage schema is unavailable"}) from exc


def stamp(value):
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    except ValueError:
        fail("reflection_time_invalid", "Reflection filters require an offset-aware timestamp", 422)


@router.get("/inputs", response_model=c.ReflectionInputsPage)
def inputs(user: User, db: Database, request: Request, project_id: str = Header(default="", alias="X-Project-Id"),
           limit: int = Query(default=20, ge=1, le=100), cursor: str | None = Query(default=None, max_length=4000)):
    project, actor, access, _ = authorize(db, user, project_id, request)
    return read(q.list_inputs, db, project, actor, access, limit=limit, cursor=cursor)


@router.get("/inputs/{input_id}", response_model=c.ReflectionInputDetail)
def input_detail(input_id: str, user: User, db: Database, request: Request,
                 project_id: str = Header(default="", alias="X-Project-Id")):
    project, actor, _, _ = authorize(db, user, project_id, request)
    return read(q.input_detail, db, project, actor, input_id, store=getattr(request.app.state, "hermes_store", None))


@router.get("", response_model=c.ReflectionPage)
def reflections(user: User, db: Database, request: Request, project_id: str = Header(default="", alias="X-Project-Id"),
                category: c.Category | None = None, occurred_from: str | None = Query(default=None, max_length=64),
                occurred_to: str | None = Query(default=None, max_length=64), limit: int = Query(default=20, ge=1, le=100),
                cursor: str | None = Query(default=None, max_length=4000)):
    project, actor, access, _ = authorize(db, user, project_id, request)
    start, end = stamp(occurred_from), stamp(occurred_to)
    if start and end and end <= start:
        fail("reflection_time_invalid", "End filter must be later than start", 422)
    return read(q.list_records, db, project, actor, access, category=category, occurred_from=start,
                occurred_to=end, limit=limit, cursor=cursor, store=getattr(request.app.state, "hermes_store", None))


@router.get("/{reflection_id}", response_model=c.ReflectionDetail)
def detail(reflection_id: str, user: User, db: Database, request: Request,
           project_id: str = Header(default="", alias="X-Project-Id")):
    project, actor, _, _ = authorize(db, user, project_id, request)
    return read(q.exact, db, project, actor, reflection_id, store=getattr(request.app.state, "hermes_store", None))
