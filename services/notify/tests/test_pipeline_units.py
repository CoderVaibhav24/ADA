"""The two pieces of the pipeline that can be tested without the stack.

Everything else in this suite is an integration test on purpose — a mocked
Keycloak proves nothing about tenancy. But the renderer and the retry ladder are
pure functions over their inputs, and they carry two of the decisions most likely
to be quietly broken by a later edit:

  * a renderer that silently tolerates a missing value sends "Hello ," to a
    customer, and nothing anywhere reports it
  * a ladder without jitter looks identical in every test and produces a retry
    stampede only under the outage it was built for

So they are pinned here, where the tests run in milliseconds and cannot be
skipped for want of a database.
"""

from __future__ import annotations

import pytest

from app import retry
from app.config import Settings
from app.rendering import TemplateError, render, render_message


def _settings(**overrides) -> Settings:
    base = {
        "issuer": "http://localhost:8090/realms/pcsmcpl",
        "database_url": "postgresql+asyncpg://ada:x@localhost:5400/ada",
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


# --- rendering --------------------------------------------------------------


def test_renders_flat_and_dotted_paths() -> None:
    result = render(
        "Hello {{ first_name }}, request {{ request.id }} was approved.",
        {"first_name": "Ada", "request": {"id": "LR-0001"}},
    )
    assert result == "Hello Ada, request LR-0001 was approved."


def test_tolerates_spacing_inside_the_braces() -> None:
    payload = {"name": "Ada"}
    assert render("{{name}}", payload) == render("{{   name   }}", payload) == "Ada"


def test_a_missing_value_is_an_error_not_an_empty_string() -> None:
    # The whole point. An empty substitution here would be sent to a real person.
    with pytest.raises(TemplateError, match="no value for 'first_name'"):
        render("Hello {{ first_name }},", {})


def test_a_null_value_is_an_error_too() -> None:
    # Distinct from missing, and just as unsendable: "Hello None," goes out.
    with pytest.raises(TemplateError, match="is null"):
        render("Hello {{ first_name }},", {"first_name": None})


def test_a_structure_cannot_be_substituted_into_a_sentence() -> None:
    with pytest.raises(TemplateError, match="which cannot be"):
        render("Hello {{ user }},", {"user": {"name": "Ada"}})


def test_a_malformed_placeholder_is_reported_rather_than_left_in_the_message() -> None:
    # {{ 1nvalid }} does not match the strict pattern, so substitution skips it.
    # Without the leftover check it would be delivered verbatim, braces and all.
    with pytest.raises(TemplateError, match="unresolved placeholder"):
        render("Hello {{ 1nvalid }},", {"first_name": "Ada"})


def test_the_renderer_evaluates_nothing() -> None:
    """No expressions, no attribute access, no code. See app/rendering.py.

    The classic Jinja2 sandbox escape starts with exactly this string. Here it is
    not dangerous — it is simply not a valid placeholder — and this test says so
    out loud, so that nobody swaps in a template engine without meeting it.
    """
    with pytest.raises(TemplateError):
        render("{{ ''.__class__.__mro__ }}", {})


def test_attribute_traversal_does_not_reach_python_objects() -> None:
    with pytest.raises(TemplateError, match="no value for"):
        render("{{ payload.__class__ }}", {"payload": {"a": 1}})


def test_render_message_renders_subject_and_body_and_allows_no_subject() -> None:
    rendered = render_message(
        subject="Welcome, {{ first_name }}",
        body="Hello {{ first_name }}.",
        payload={"first_name": "Ada"},
    )
    assert rendered.subject == "Welcome, Ada"
    assert rendered.body == "Hello Ada."

    no_subject = render_message(subject=None, body="Hello.", payload={})
    assert no_subject.subject is None


# --- the retry ladder -------------------------------------------------------


def test_the_ladder_matches_the_plan() -> None:
    # 10 s, 30 s, 2 min, 10 min, 1 hour (build-plan.md, Sunday 30 August).
    assert retry.describe_ladder(_settings()) == [10.0, 30.0, 120.0, 600.0, 3600.0]


def test_the_ladder_never_exceeds_the_cap() -> None:
    settings = _settings(retry_base_seconds=100.0, retry_cap_seconds=300.0)
    assert max(retry.describe_ladder(settings)) == 300.0


def test_five_attempts_then_exhausted() -> None:
    settings = _settings()
    assert not retry.is_exhausted(4, settings)
    # Five attempts means five sends, not one send and five retries.
    assert retry.is_exhausted(5, settings)
    assert retry.is_exhausted(6, settings)


def test_jitter_spreads_the_delay_below_the_ceiling() -> None:
    settings = _settings()
    samples = [retry.delay_seconds(1, settings) for _ in range(200)]

    assert all(0 <= sample <= 10.0 for sample in samples), "a delay escaped its rung"
    # The property that matters: not every message retries at the same instant.
    # 200 identical samples from a uniform distribution is not a thing that
    # happens, so this fails if jitter is ever quietly removed.
    assert len(set(samples)) > 100, "delays are not being spread; jitter is not applied"


def test_jitter_can_be_switched_off_for_a_deterministic_test() -> None:
    settings = _settings(retry_jitter=False)
    assert retry.delay_seconds(1, settings) == 10.0
    assert retry.delay_seconds(3, settings) == 120.0


def test_the_delay_never_goes_backwards_up_the_ladder() -> None:
    settings = _settings(retry_jitter=False)
    ceilings = [retry.delay_seconds(attempt, settings) for attempt in range(1, 6)]
    assert ceilings == sorted(ceilings), "the ladder must not decrease"
