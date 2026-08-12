from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import current_user_id, get_owned_project
from ..models import Project
from ..schemas import ProjectCreate, ProjectOut

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("", response_model=ProjectOut)
def create_project(
    body: ProjectCreate,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    project = Project(user_id=user_id, name=body.name, description=body.description)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("", response_model=list[ProjectOut])
def list_projects(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    return (db.query(Project).filter(Project.user_id == user_id)
            .order_by(Project.created_at.desc()).all())


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    return get_owned_project(project_id, db, user_id)


@router.delete("/{project_id}")
def delete_project(
    project_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    project = get_owned_project(project_id, db, user_id)
    db.delete(project)
    db.commit()
    return {"ok": True}
