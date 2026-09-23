"""Template rendering — substitution, and deliberately nothing more.

`{{ first_name }}` and `{{ request.id }}`. No loops, no conditionals, no
expressions, no filters, no function calls.

## Why not Jinja2

Because a template is data. It lives in a database row that an administrator can
edit, and Jinja2 templates are programs: `{{ ''.__class__.__mro__ }}` is the
first step of a well-known escape from Jinja2's sandbox to arbitrary code
execution, and the sandboxed environment is a mitigation of that rather than an
absence of it. A renderer with no expression evaluator has nothing to escape
from.

The cost is that a template cannot express "if the user has no middle name".
That has not come up, and when it does the answer is to store two templates and
choose between them at fan-out, not to put a language in the database.

## Why a missing value is an error

`Hello {{ first_name }},` rendered against a payload with no first_name could
produce "Hello ," or "Hello {{ first_name }},". Both get sent to a real person.
Failing instead turns a silent embarrassment into a delivery marked failed with a
readable reason, which is the outcome someone can actually fix.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Deliberately narrow. Identifiers, dots between them, optional surrounding
# space, and nothing else — no indexing, no calls, no operators. Anything that
# does not match this is left alone rather than guessed at, and the unresolved
# check afterwards then reports it.
_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}")

# Anything still looking like a placeholder after substitution. Catches the
# malformed ones — {{ 1nvalid }}, {{ a-b }} — that the pattern above skips.
_ANY_PLACEHOLDER = re.compile(r"\{\{.*?\}\}", re.DOTALL)

# A rendered message is a notification, not a novel. This bounds what a payload
# can inflate a template into before it reaches a provider that would reject it
# anyway, less helpfully.
MAX_RENDERED_BYTES = 256 * 1024


class TemplateError(Exception):
    """The template cannot be rendered with this payload.

    Always permanent. Retrying changes nothing — the template and the payload
    will still not fit together in an hour — so the delivery is marked failed
    rather than put on the retry ladder.
    """


@dataclass(frozen=True)
class Rendered:
    subject: str | None
    body: str


def _resolve(path: str, payload: dict) -> object:
    """Walk a dotted path through plain dicts only.

    Dicts only, on purpose. Following attributes would let a template reach into
    whatever object happened to be passed, which is the same class of problem
    Jinja2's sandbox exists to contain.
    """
    current: object = payload
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            raise TemplateError(f"payload has no value for '{path}'")
        current = current[part]
    return current


def _stringify(value: object, path: str) -> str:
    if value is None:
        # Distinct from missing, and just as unsendable. "Hello None," is worse
        # than an error, because it goes out.
        raise TemplateError(f"payload value for '{path}' is null")
    if isinstance(value, bool):
        # Before the numeric check: bool is a subclass of int, and "true" reads
        # better in a message than "1".
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    # A dict or a list rendered into a sentence is never what was meant; it is a
    # caller passing the wrong path.
    raise TemplateError(
        f"payload value for '{path}' is a {type(value).__name__}, which cannot be "
        "substituted into a message"
    )


def render(template: str, payload: dict) -> str:
    """Substitute payload values into one template string."""
    if not isinstance(payload, dict):
        raise TemplateError("payload must be an object")

    def substitute(match: re.Match[str]) -> str:
        path = match.group(1)
        return _stringify(_resolve(path, payload), path)

    result = _PLACEHOLDER.sub(substitute, template)

    leftover = _ANY_PLACEHOLDER.search(result)
    if leftover:
        # Reached when the template contains something placeholder-shaped that
        # the strict pattern refused to match — a typo, usually. Reporting it is
        # the difference between a fixable error and a customer receiving braces.
        raise TemplateError(
            f"template contains an unresolved placeholder: {leftover.group(0)[:80]!r}"
        )

    if len(result.encode("utf-8")) > MAX_RENDERED_BYTES:
        raise TemplateError(
            f"rendered message exceeds {MAX_RENDERED_BYTES} bytes; "
            "check the payload values being substituted"
        )
    return result


def render_message(*, subject: str | None, body: str, payload: dict) -> Rendered:
    """Render a template row. The subject is optional; the body never is."""
    return Rendered(
        subject=render(subject, payload) if subject is not None else None,
        body=render(body, payload),
    )
