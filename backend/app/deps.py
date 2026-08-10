from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.session.framework.fastapi import verify_session

from .database import get_db
from .models import Project


async def current_user_id(
    session: SessionContainer = Depends(verify_session()),
) -> str:
    return session.get_user_id()


def get_owned_project(
    project_id: int, db: Session, user_id: str,
) -> Project:
    project = db.get(Project, project_id)
    if project is None or project.user_id != user_id:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
