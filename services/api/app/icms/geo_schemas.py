"""Response shapes for the boundary import and the parcel lookup."""

from __future__ import annotations

from typing import Literal

from ada_core.datetimes import IstDateTime
from pydantic import BaseModel, Field

__all__ = [
    "BoundaryCounts",
    "BoundaryImportOut",
    "BoundaryImportRow",
    "LayerCounts",
    "ParcelAtOut",
    "PlacemarkIssue",
]


class ParcelAtOut(BaseModel):
    """What the loaded boundary layers say about a point. All null when nothing covers it."""

    zone_cd: str | None
    zone_name: str | None
    village_lgd: str | None
    village_name: str | None
    khasra_no: str | None
    ulpin: str | None
    sector: str | None = Field(
        description="A scheme plot's sector as the land record writes it, e.g. `SECTOR 4`.")
    plot_no: str | None = Field(description="A scheme plot's number, e.g. `4/285` or `CP-1`.")
    ward: str | None = Field(description="Always null: no ward layer is loaded yet.")
    source: Literal["kml", "none"] = Field(
        description="`kml` when any boundary layer covers the point, else `none`.")


class LayerCounts(BaseModel):
    inserted: int
    updated: int
    deactivated: int
    rejected: int


class BoundaryCounts(BaseModel):
    zones: LayerCounts
    villages: LayerCounts
    parcels: LayerCounts
    reserved: LayerCounts


class PlacemarkIssue(BaseModel):
    folder: str = Field(description="The KML folder, or the unknown folder's own name.")
    index: int = Field(description="1-based position of the placemark within that folder.")
    name: str | None = Field(description="The placemark's <name>, if it has one.")
    key: str | None = Field(description="zone_cd, village_lgd, village_lgd/khasra_no, "
                                        "SECTOR#plot_no or feature_type:source_ref, when it "
                                        "could be read.")
    reasons: list[str]


class BoundaryImportOut(BaseModel):
    import_id: int | None = Field(description="The icms_boundary_import row; null on a dry run.")
    filename: str
    sha256: str
    dry_run: bool
    counts: BoundaryCounts
    rejected: list[PlacemarkIssue]
    warnings: list[PlacemarkIssue] = Field(
        description="Loaded, but worth a look: a repaired ring, a parcel outside its village.")


class BoundaryImportRow(BaseModel):
    id: int
    filename: str
    sha256: str
    imported_by: str = Field(description="The importer's user id.")
    imported_by_name: str | None = Field(
        description="The importer's name as their sign-in carried it, else from Keycloak "
                    "at read time; null when neither can say.")
    imported_at: IstDateTime
    counts: BoundaryCounts
