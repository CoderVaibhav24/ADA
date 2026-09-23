"""Templates: what a notification actually says.

A project manages its own templates with its own machine token. There is no
shared template library and no cross-project read — `project_id` comes from the
token's `azp` claim, exactly as it does for ingestion, so one project cannot see
or overwrite another's wording.

## Versioning by row

POST does not update. It writes the next version and deactivates the previous
one, in one transaction.

That is not filing-cabinet tidiness. `deliveries.template_id` records which
template produced a message, so editing a row in place would silently rewrite the
history of what was sent — a delivery from last Tuesday would start claiming it
contained today's wording. Version-by-row keeps the old text readable for as long
as the delivery rows that point at it.

The cost is that this table grows. Templates are small and edited rarely, so the
growth is measured in kilobytes a year.
"""

from __future__ import annotations

import uuid
from typing import Annotated

import structlog
from fastapi import APIRouter, HTTPException, Path, Query, status
from sqlalchemy import func, select, update

from app.dependencies import CurrentProject, DbSession
from app.models import Channel, Template
from app.schemas import ErrorResponse, TemplateCreate, TemplateResponse

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/templates", tags=["templates"])


def _to_response(template: Template) -> TemplateResponse:
    return TemplateResponse(
        id=template.id,
        key=template.key,
        channel=template.channel.value,
        locale=template.locale,
        version=template.version,
        subject=template.subject,
        body=template.body,
        active=template.active,
        created_at=template.created_at,
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=TemplateResponse,
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        422: {"description": "The body does not satisfy the contract"},
    },
    summary="Store a new version of a template",
)
async def create_template(
    body: TemplateCreate,
    project: CurrentProject,
    session: DbSession,
) -> TemplateResponse:
    """Write the next version of one template and make it the active one.

    201 rather than 200: a version is created every time, even when the text is
    unchanged. Returning 200 would suggest an in-place edit, which is exactly
    what this does not do.
    """
    project_id = project.id
    project_key = project.key
    channel = Channel(body.channel)

    if channel == Channel.EMAIL and not body.subject:
        # Enforced here as well as by the database's check constraint, so the
        # caller gets a sentence rather than an integrity error.
        raise HTTPException(status_code=422, detail="An email template needs a subject line")

    # The current highest version for this identity. SELECT then INSERT is a race
    # in principle; the unique constraint on (project_id, key, channel, locale,
    # version) turns a lost race into an error rather than a duplicate, and
    # templates are written by hand rather than concurrently.
    highest = await session.scalar(
        select(func.max(Template.version)).where(
            Template.project_id == project_id,
            Template.key == body.key,
            Template.channel == channel,
            Template.locale == body.locale,
        )
    )
    version = (highest or 0) + 1

    # Deactivated before the new row is inserted, so there is never a moment with
    # two active templates for one identity — fan-out picks the highest active
    # version, and two active rows would make that choice a matter of ordering.
    await session.execute(
        update(Template)
        .where(
            Template.project_id == project_id,
            Template.key == body.key,
            Template.channel == channel,
            Template.locale == body.locale,
            Template.active.is_(True),
        )
        .values(active=False)
    )

    template = Template(
        project_id=project_id,
        key=body.key,
        channel=channel,
        locale=body.locale,
        version=version,
        subject=body.subject,
        body=body.body,
        active=True,
    )
    session.add(template)
    await session.commit()

    logger.info(
        "template_stored",
        project=project_key,
        key=body.key,
        channel=body.channel,
        locale=body.locale,
        version=version,
    )
    return _to_response(template)


@router.get(
    "",
    response_model=list[TemplateResponse],
    summary="List this project's templates",
)
async def list_templates(
    project: CurrentProject,
    session: DbSession,
    include_inactive: Annotated[
        bool, Query(description="Include superseded versions, not only the active ones.")
    ] = False,
) -> list[TemplateResponse]:
    statement = select(Template).where(Template.project_id == project.id)
    if not include_inactive:
        statement = statement.where(Template.active.is_(True))

    rows = await session.scalars(
        statement.order_by(Template.key, Template.channel, Template.locale, Template.version.desc())
    )
    return [_to_response(row) for row in rows]


@router.get(
    "/{template_id}",
    response_model=TemplateResponse,
    responses={404: {"model": ErrorResponse}},
    summary="Read one template belonging to the calling project",
)
async def get_template(
    project: CurrentProject,
    session: DbSession,
    template_id: Annotated[uuid.UUID, Path()],
) -> TemplateResponse:
    template = await session.scalar(
        select(Template).where(
            Template.id == template_id,
            # Not an optimisation. Another project's template answers 404 rather
            # than 403, so this cannot be used to discover which ids exist.
            Template.project_id == project.id,
        )
    )
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such template")
    return _to_response(template)
