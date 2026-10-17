"""Project portfolio reads do not select a global working project."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .auth_sql import current_user
from .project_lifecycle_contract import ProjectRiskCode, ProjectStatus
from .project_portfolio_contract import ProjectPortfolioDetail, ProjectPortfolioResponse
from .sql_models import User, get_session

router = APIRouter()


@router.get('/portfolio', response_model=ProjectPortfolioResponse)
def project_portfolio(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    q: Annotated[str, Query(max_length=200)] = '',
    business_id: Annotated[str | None, Query(max_length=64)] = None,
    status: Annotated[list[ProjectStatus] | None, Query()] = None,
    risk: Annotated[list[ProjectRiskCode] | None, Query()] = None,
    cursor: Annotated[str, Query(max_length=1024)] = '',
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
):
    from .project_portfolio import portfolio

    return portfolio(db, user, q=q, business_id=business_id, status=status or (),
                     risk=risk or (), cursor=cursor, limit=limit)


@router.get('/{project_id}/portfolio', response_model=ProjectPortfolioDetail)
def project_portfolio_detail(
    project_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
):
    from .project_portfolio import project_detail

    return project_detail(db, user, project_id)
