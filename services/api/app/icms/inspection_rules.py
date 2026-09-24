"""Dependency rules R1-R8 for a round's structured answers (gap audit §1a).

R7 (the notice), R8 (the owner), the length × width area and the web-origin
relaxation are docs/icms/inspection-findings-fields.md.

Pure functions over a mapping of Inspection columns, so the same rules run on a
findings save (consistency only) and on submit (consistency and completeness).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from ada_core.models_icms import RECOMMENDATIONS

__all__ = [
    "AREA_TOLERANCE",
    "NOTICE_RECOMMENDATIONS",
    "WEB",
    "Problem",
    "area_mismatch",
    "derive",
    "inconsistencies",
    "missing_for_submit",
    "side_area",
]

YES, PARTIAL, FALSE_POSITIVE = "yes", "partial", "no_false_positive"
NO_ACTION = "no_action_required"
POLICE = "police"

# The recommendations that are themselves a notice, so notice_required follows.
NOTICE_RECOMMENDATIONS = frozenset({"issue_notice", "demolition_order", "impose_fine"})

# Which client saved the findings; a web round is not held to the act, sections or owner.
FIELD, WEB = "field", "web"
# How far measured_area_sqm may stray from length × width before the round is flagged.
AREA_TOLERANCE = 0.10

_ENFORCEMENT = tuple(code for code in RECOMMENDATIONS if code != NO_ACTION)


@dataclass(frozen=True)
class Problem:
    field: str
    message: str
    allowed: tuple[str, ...] | None = None


def _blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


# Fills what R1 forces, and notice_required from the recommendation, where the body was silent.
def derive(carried: dict) -> dict:
    values = dict(carried)
    if values.get("encroachment_confirmed_cd") == FALSE_POSITIVE:
        values.setdefault("recommendation_cd", NO_ACTION)
    recommendation = values.get("recommendation_cd")
    if "recommendation_cd" in carried or "encroachment_confirmed_cd" in carried:
        if recommendation == NO_ACTION:
            values.setdefault("notice_required", False)
        elif recommendation in NOTICE_RECOMMENDATIONS:
            values.setdefault("notice_required", True)
    if values.get("notice_required") is False:
        values.setdefault("notice_act_cd", None)
    return values


# length × width in square metres, or None unless both sides are held.
def side_area(values: Mapping) -> float | None:
    length, width = values.get("length_m"), values.get("width_m")
    if length is None or width is None:
        return None
    return round(float(length) * float(width), 2)


# True when both the area and length × width are held and differ by more than AREA_TOLERANCE.
def area_mismatch(values: Mapping) -> bool:
    sides, area = side_area(values), values.get("measured_area_sqm")
    if sides is None or area is None or sides <= 0:
        return False
    return abs(float(area) - sides) > AREA_TOLERANCE * sides


# R1/R2 and the notice pairing: answers that contradict one another, whatever is still blank.
def inconsistencies(values: Mapping) -> list[Problem]:
    problems: list[Problem] = []
    confirmed = values.get("encroachment_confirmed_cd")
    recommendation = values.get("recommendation_cd")
    notice = values.get("notice_required")

    if confirmed == FALSE_POSITIVE and recommendation not in (None, NO_ACTION):
        problems.append(Problem(
            "recommendation_cd",
            "a false positive can only be recommended no_action_required",
            (NO_ACTION,)))
    if confirmed in (YES, PARTIAL) and recommendation == NO_ACTION:
        problems.append(Problem(
            "recommendation_cd",
            "a confirmed or partial encroachment needs an enforcement recommendation, "
            "not no_action_required",
            _ENFORCEMENT))
    if recommendation == NO_ACTION and notice is True:
        problems.append(Problem(
            "notice_required", "no_action_required cannot also require a notice"))
    if recommendation in NOTICE_RECOMMENDATIONS and notice is False:
        problems.append(Problem(
            "notice_required", f"{recommendation} is a notice; notice_required must be true"))
    if notice is False and not _blank(values.get("notice_act_cd")):
        problems.append(Problem(
            "notice_act_cd", "a round that needs no notice cites no act"))
    return problems


# R1-R8 completeness at submit: every field the answers make required, in form order.
def missing_for_submit(
    values: Mapping, *, findings: int, check_ins: int,
    sections: Iterable[tuple[str, str]] = (), origin: str | None = FIELD,
) -> list[str]:
    missing: list[str] = []
    confirmed = values.get("encroachment_confirmed_cd")
    if confirmed is None:
        missing.append("encroachment_confirmed_cd")
    if confirmed in (YES, PARTIAL):
        area = values.get("measured_area_sqm")
        if area is None or float(area) <= 0:
            missing.append("measured_area_sqm")
        for name in ("area_type_cd", "external_support_cd", "recommendation_cd"):
            if _blank(values.get(name)):
                missing.append(name)
    elif confirmed == FALSE_POSITIVE and values.get("recommendation_cd") is None:
        missing.append("recommendation_cd")
    notice = values.get("notice_required")
    if not _blank(values.get("recommendation_cd")) and notice is None:
        missing.append("notice_required")
    on_site = origin != WEB
    if notice is True and on_site:
        act = values.get("notice_act_cd")
        if _blank(act):
            missing.append("notice_act_cd")
        if not any(cited == act for cited, _ in sections):
            missing.append("sections")
    if not _blank(values.get("occupant_phone")) and _blank(values.get("occupant_name")):
        missing.append("occupant_name")
    if on_site and not _blank(values.get("owner_phone")) and _blank(values.get("owner_name")):
        missing.append("owner_name")
    if values.get("external_support_cd") == POLICE and _blank(values.get("officer_note")):
        missing.append("officer_note")
    if findings < 1:
        missing.append("findings")
    if check_ins < 1:
        missing.append("check_in")
    return missing
