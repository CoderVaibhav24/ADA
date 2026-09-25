"""The GeoJSON one analysis run answers with, declared rather than implied.

`/analyses/{job_id}/features` carried no response model, so `/api/openapi.json`
documented nothing for it and the generated TypeScript client typed the whole
payload as `unknown` — `properties.change_type` included, which the Change
Detection screen reads on every row.

`properties` allows extra keys on purpose: ada-ml writes `features` beside the
named ones when an instance backs the polygon, and a model that dropped it would
quietly delete evidence on its way to the browser.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "ChangeClass",
    "ChangeFeature",
    "ChangeFeatureCollection",
    "ChangeFeatureProps",
    "FeatureWindow",
    "ParcelFeature",
    "ParcelFeatureCollection",
    "ParcelHistogram",
    "ParcelResultOut",
    "ParcelResultPage",
    "ParcelSummary",
    "ParcelVerdict",
]


class ChangeFeatureProps(BaseModel):
    model_config = ConfigDict(extra="allow")

    label: str | None = None
    status: str | None = None
    area_m2: float | None = None
    confidence: float | None = None
    brightness_delta: float | None = None
    red_zone_overlap_pct: float | None = None
    change_type: str | None = Field(
        default=None,
        description="new_construction, extension or demolition, from T1<->T2 instance "
                    "geometry. Null where no instance backs the polygon.",
    )
    review_status: str = "pending"
    review_note: str | None = None
    reviewed_by: str | None = None
    reviewed_by_name: str | None = Field(
        default=None, description="From Keycloak at read time; null when it cannot say.")
    reviewed_at: str | None = None
    case_ref: str | None = Field(
        default=None, description="Newest complaint raised from this polygon, if any.")
    case_status: str | None = Field(
        default=None, description="That complaint's workflow status (icms_case.status).")


class ChangeFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: int
    geometry: dict[str, Any] | None
    properties: ChangeFeatureProps


class FeatureWindow(BaseModel):
    """What came back and what exists — the half a bare feature list cannot say."""

    count: int
    total: int
    limit: int
    offset: int
    bbox: list[float] | None


class ChangeFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[ChangeFeature]
    metadata: FeatureWindow


# Same values as ada_core.models.PARCEL_VERDICTS / PARCEL_CHANGE_CLASSES.
ParcelVerdict = Literal["over_tolerance", "within_tolerance", "vacant",
                        "insufficient_imagery", "not_assessable"]
ChangeClass = Literal["new_build", "extension", "demolition", "unchanged", "unassessable"]


class ParcelResultOut(BaseModel):
    """One parcel's built area in both epochs; the cadastre fields never include the owner."""

    id: int
    job_id: int
    parcel_id: int
    parcel_key: str = Field(description="`SECTOR#plot` or `lgd/khasra`; `#<parcel_id>` if "
                                        "the parcel has neither.")
    # A scheme plot has no village or khasra and a revenue parcel no sector or plot.
    sector: str | None
    plot_no: str | None
    village_lgd: str | None
    khasra_no: str | None
    land_use: str | None
    plot_type: str | None
    sanctioned_area_sqm: float | None
    parcel_area_sqm: float
    tolerance_frac: float
    imagery_frac_t1: float
    imagery_frac_t2: float
    built_frac_t1: float
    built_frac_t2: float
    built_sqm_t1: float
    built_sqm_t2: float
    delta_sqm: float | None = Field(
        default=None, description="built_sqm_t2 - built_sqm_t1; null unless both epochs "
                                  "have enough imagery.")
    delta_sqm_corrected: float | None = Field(
        default=None, description="delta_sqm less the run's median epoch bias.")
    verdict_t1: ParcelVerdict
    verdict_t2: ParcelVerdict
    change_class: ChangeClass


class ParcelHistogram(BaseModel):
    bin_edges: list[float]
    counts: list[int]


class ParcelSummary(BaseModel):
    """`AnalysisJob.stats["parcels"]` for a run whose parcel stage measured something."""

    model_config = ConfigDict(extra="allow")

    parcels_total: int
    assessable: int
    bias_offset_sqm: float | None = None
    histogram: ParcelHistogram
    counts_by_class: dict[str, int]
    counts_by_verdict_t1: dict[str, int]
    counts_by_verdict_t2: dict[str, int]


class ParcelResultPage(BaseModel):
    items: list[ParcelResultOut]
    total: int
    bias_offset_sqm: float | None
    summary: ParcelSummary | None = Field(
        default=None, description="Null when the run skipped or failed the parcel stage.")


class ParcelFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: int
    geometry: dict[str, Any] | None = Field(description="icms_parcel.geom, EPSG:4326.")
    properties: ParcelResultOut


class ParcelFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[ParcelFeature]
    metadata: FeatureWindow
