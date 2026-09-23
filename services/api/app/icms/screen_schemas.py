"""Request and response bodies for /api/app/screens. Rules live in screens.py."""

from __future__ import annotations

from typing import Annotated, Any

from ada_core.datetimes import IstDateTime
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

__all__ = [
    "RollbackIn",
    "ScreenDraftIn",
    "ScreenIndexItem",
    "ScreenIndexOut",
    "ScreenOut",
    "ScreenVersionOut",
    "PublishIn",
]

Runtime = Annotated[str, StringConstraints(pattern=r"^\d{1,3}(\.\d{1,3}){0,2}$")]
Capability = Annotated[
    str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$", max_length=64)
]


class ScreenDraftIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    definition: dict[str, Any] = Field(description="The screen tree; docs/Agents-Mobile/sdui.md.")
    schema_version: int = Field(default=1, ge=1, le=100)
    min_app_runtime: Runtime | None = Field(
        default=None,
        description="Oldest SDUI runtime that may be served this screen. Defaults to the "
                    "runtime its components need; a lower value is refused.",
    )
    required_capability: Capability | None = Field(
        default=None, description="A permission code the caller must hold to be served it.")


class PublishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int | None = Field(default=None, ge=1, description="Defaults to the newest draft.")


class RollbackIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    to_version: int = Field(ge=1, description="A previously published version to serve again.")


class ScreenOut(BaseModel):
    """What the app renders: the version it is being served, and the tree."""

    screen_id: str
    version: int
    schema_version: int
    min_app_runtime: str
    title: str
    definition: dict[str, Any]
    etag: str
    published_at: IstDateTime


class ScreenIndexItem(BaseModel):
    screen_id: str
    version: int
    title: str
    min_app_runtime: str
    etag: str


class ScreenIndexOut(BaseModel):
    items: list[ScreenIndexItem]


class ScreenVersionOut(BaseModel):
    """One stored version, for the admin history. Carries the tree for review."""

    screen_id: str
    version: int
    status: str
    serving: bool
    schema_version: int
    min_app_runtime: str
    title: str
    required_capability: str | None
    source_version: int | None
    definition: dict[str, Any]
    created_at: IstDateTime
    created_by: str
    published_at: IstDateTime | None
    published_by: str | None
