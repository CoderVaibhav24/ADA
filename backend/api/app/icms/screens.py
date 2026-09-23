"""Server-driven screens: the definition validator and the version store.

The contract (components, actions, routes, limits) is `sdui_contract.json`, a
byte-for-byte copy of `app/src/sdui/contract.json`; tests/test_app_screens.py
fails when the two drift. Design and rationale: docs/Agents-Mobile/sdui.md.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from ada_core.datetimes import now_ist
from ada_core.models_app import AppScreen
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..errors import ApiError

__all__ = [
    "CONTRACT",
    "SCREEN_ID_PATTERN",
    "ValidatedDefinition",
    "create_draft",
    "etag_of",
    "etag_matches",
    "latest_published",
    "list_versions",
    "parse_runtime",
    "publish",
    "published_index",
    "rollback",
    "validate_definition",
]

CONTRACT: Mapping[str, Any] = json.loads(
    Path(__file__).with_name("sdui_contract.json").read_text(encoding="utf-8")
)

SCREEN_ID_PATTERN = r"^[a-z][a-z0-9_]{1,63}$"
_SCREEN_ID = re.compile(SCREEN_ID_PATTERN)
_NODE_ID = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
_PERMISSION = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")
_QUERY_KEY = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
_PARAM_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,39}$")
_SELECT = re.compile(r"^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,5}$")
_RUNTIME = re.compile(r"^\d{1,3}(\.\d{1,3}){0,2}$")
_SEGMENT = re.compile(r"^[A-Za-z0-9._~-]+$")
_TEMPLATE = re.compile(r"\{\{(.*?)\}\}")
_EXPRESSION = re.compile(
    r"^\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\s*"
    r"(?:\|\s*([a-z]+)(?::([a-z][a-z0-9_]{0,39}))?\s*)?$"
)
_URL = re.compile(r"^https://([a-z0-9.-]+)(?::\d{1,5})?(/[^\s{}]*)?$")
_FORBIDDEN_SEGMENTS = frozenset({"__proto__", "prototype", "constructor"})
_NODE_KEYS = frozenset(
    {"type", "id", "props", "children", "data", "action", "visibleIf", "item", "empty"}
)

LIMITS: Mapping[str, int] = CONTRACT["limits"]
COMPONENTS: Mapping[str, Mapping[str, Any]] = CONTRACT["components"]
ENUMS: Mapping[str, list] = CONTRACT["enums"]
ROUTES: Mapping[str, Mapping[str, list[str]]] = CONTRACT["routes"]
SCHEMA_VERSIONS: frozenset[int] = frozenset(CONTRACT["schemaVersions"])


# "1.2" -> (1, 2, 0); None when the string is not a runtime version.
def parse_runtime(value: str | None) -> tuple[int, int, int] | None:
    if value is None or not _RUNTIME.fullmatch(value):
        return None
    parts = [int(part) for part in value.split(".")]
    while len(parts) < 3:
        parts.append(0)
    return parts[0], parts[1], parts[2]


# ---------------------------------------------------------------- validation


@dataclass
class _Walk:
    permissions: frozenset[str]
    nodes: int = 0
    bindings: int = 0
    required_runtime: tuple[int, int, int] = (0, 0, 0)
    label_domains: set[str] = field(default_factory=set)


@dataclass(frozen=True)
class ValidatedDefinition:
    title: str
    required_runtime: str
    label_domains: tuple[str, ...]


def _refuse(code: str, message: str, where: str, allowed: Iterable[str] | None = None):
    raise ApiError(422, code, message, field=where, allowed=allowed)


# Every `{{...}}` in a string, checked against the scope it will be evaluated in.
def _check_templates(
    text: str, where: str, walk: _Walk, *, has_data: bool, in_item: bool, formatters: bool = True
) -> None:
    stripped = _TEMPLATE.sub("", text)
    if "{{" in stripped or "}}" in stripped:
        _refuse("bad_template", "unbalanced {{ }} in a template string", where)
    for expression in _TEMPLATE.findall(text):
        match = _EXPRESSION.fullmatch(expression)
        if match is None:
            _refuse(
                "bad_template",
                f"'{{{{{expression}}}}}' is not a dotted path with an optional formatter",
                where,
            )
        path, formatter, argument = match.groups()
        segments = path.split(".")
        if set(segments) & _FORBIDDEN_SEGMENTS:
            _refuse("bad_template", "a template path may not name a prototype member", where)
        root = segments[0]
        if root not in CONTRACT["scopeRoots"]:
            _refuse("unknown_scope", f"'{root}' is not a template scope", where,
                    CONTRACT["scopeRoots"])
        if root == "data" and not has_data:
            _refuse("unbound_data", "'data' is used where no data binding is in scope", where)
        if root in ("item", "index") and not in_item:
            _refuse("unbound_item", f"'{root}' is only in scope inside a list item", where)
        if formatter is None:
            continue
        if not formatters:
            _refuse("bad_template", "a formatter is not allowed here", where)
        if formatter not in CONTRACT["formatters"]:
            _refuse("unknown_formatter", f"no formatter '{formatter}'", where,
                    CONTRACT["formatters"])
        if formatter == "label":
            if argument is None:
                _refuse("bad_template", "label needs a code-value domain: label:<domain>", where)
            walk.label_domains.add(argument)
        elif argument is not None:
            _refuse("bad_template", f"formatter '{formatter}' takes no argument", where)


def _is_template(value: Any) -> bool:
    return isinstance(value, str) and _TEMPLATE.fullmatch(value) is not None


def _text(value: Any, where: str, walk: _Walk, *, has_data: bool, in_item: bool) -> None:
    if not isinstance(value, str):
        _refuse("bad_prop", "expected a string", where)
    if len(value) > LIMITS["maxTextLength"]:
        _refuse("bad_prop", f"longer than {LIMITS['maxTextLength']} characters", where)
    _check_templates(value, where, walk, has_data=has_data, in_item=in_item)


def _prop(spec: Mapping[str, Any], value: Any, where: str, walk: _Walk, *,
          has_data: bool, in_item: bool) -> None:
    kind = spec["kind"]
    if kind == "text":
        _text(value, where, walk, has_data=has_data, in_item=in_item)
    elif kind == "value":
        if isinstance(value, bool) or not isinstance(value, (str, int, float)):
            _refuse("bad_prop", "expected a string or a number", where)
        if isinstance(value, str):
            _text(value, where, walk, has_data=has_data, in_item=in_item)
    elif kind == "boolean":
        if not isinstance(value, bool):
            _refuse("bad_prop", "expected true or false", where)
    elif kind == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            _refuse("bad_prop", "expected an integer", where)
        if not spec.get("min", value) <= value <= spec.get("max", value):
            _refuse("bad_prop", f"must be between {spec['min']} and {spec['max']}", where)
    elif kind == "enum":
        members = ENUMS[spec["enum"]]
        if _is_template(value):
            _check_templates(value, where, walk, has_data=has_data, in_item=in_item)
        elif isinstance(value, bool) or value not in members:
            _refuse("bad_prop", f"not one of the {spec['enum']} values", where,
                    [str(member) for member in members])
    else:  # pragma: no cover - the contract is ours
        raise RuntimeError(f"contract names an unknown prop kind {kind}")


# A path the app may call: a whitelisted literal prefix, then plain or templated segments.
def _check_path(path: Any, where: str, walk: _Walk, *, has_data: bool, in_item: bool,
                deny: Iterable[str] = ()) -> None:
    if not isinstance(path, str) or not path.startswith("/") or len(path) > 200:
        _refuse("path_not_allowed", "path must be an absolute API path", where)
    literal = path.split("{{", 1)[0]
    prefix = next((p for p in CONTRACT["dataPathPrefixes"] if literal.startswith(p)), None)
    if prefix is None:
        _refuse("path_not_allowed", "path is outside the allowed API prefixes", where,
                CONTRACT["dataPathPrefixes"])
    if any(literal.startswith(denied) for denied in deny):
        _refuse("path_not_allowed", "this API path may not be called from a screen", where)
    resource = path[len(prefix):].split("/", 1)[0]
    if not resource or not _SEGMENT.fullmatch(resource):
        _refuse("path_not_allowed", "the segment after the prefix must be a literal", where)
    for segment in path[1:].split("/"):
        if _is_template(segment):
            _check_templates(segment, where, walk, has_data=has_data, in_item=in_item,
                             formatters=False)
        elif not _SEGMENT.fullmatch(segment) or segment in (".", ".."):
            _refuse("path_not_allowed", f"'{segment}' is not a plain path segment", where)


def _check_binding(binding: Any, where: str, walk: _Walk, *, has_data: bool,
                   in_item: bool) -> None:
    if not isinstance(binding, dict):
        _refuse("bad_binding", "data must be an object", where)
    unknown = set(binding) - {"source", "path", "query", "select"}
    if unknown:
        _refuse("bad_binding", f"unknown binding key: {', '.join(sorted(unknown))}", where)
    if binding.get("source") != "api":
        _refuse("bad_binding", "source must be 'api'", f"{where}.source", ["api"])
    walk.bindings += 1
    if walk.bindings > LIMITS["maxBindings"]:
        _refuse("too_many_bindings", f"more than {LIMITS['maxBindings']} data bindings", where)
    _check_path(binding.get("path"), f"{where}.path", walk, has_data=has_data, in_item=in_item)

    query = binding.get("query", {})
    if not isinstance(query, dict) or len(query) > LIMITS["maxQueryKeys"]:
        _refuse("bad_binding", "query must be an object of at most "
                f"{LIMITS['maxQueryKeys']} keys", f"{where}.query")
    for key, value in query.items():
        at = f"{where}.query.{key}"
        if not _QUERY_KEY.fullmatch(key):
            _refuse("bad_binding", "query keys are lower_snake_case", at)
        values = value if isinstance(value, list) else [value]
        if isinstance(value, list) and len(value) > LIMITS["maxListItems"]:
            _refuse("bad_binding", "too many values", at)
        for item in values:
            if isinstance(item, str):
                _text(item, at, walk, has_data=has_data, in_item=in_item)
            elif item is not None and not isinstance(item, (bool, int, float)):
                _refuse("bad_binding", "query values are strings, numbers or booleans", at)

    select = binding.get("select")
    if select is not None and (
        not isinstance(select, str)
        or not _SELECT.fullmatch(select)
        or set(select.split(".")) & _FORBIDDEN_SEGMENTS
    ):
        _refuse("bad_binding", "select is a dotted path into the response", f"{where}.select")


def _check_literal_json(value: Any, where: str, walk: _Walk, depth: int, *,
                        has_data: bool, in_item: bool) -> None:
    if depth > 4:
        _refuse("bad_action", "body is nested too deeply", where)
    if isinstance(value, dict):
        if len(value) > 30:
            _refuse("bad_action", "body has too many keys", where)
        for key, item in value.items():
            if not _QUERY_KEY.fullmatch(key):
                _refuse("bad_action", "body keys are lower_snake_case", where)
            _check_literal_json(item, f"{where}.{key}", walk, depth + 1,
                                has_data=has_data, in_item=in_item)
    elif isinstance(value, list):
        for index, item in enumerate(value[: LIMITS["maxListItems"] + 1]):
            _check_literal_json(item, f"{where}[{index}]", walk, depth + 1,
                                has_data=has_data, in_item=in_item)
    elif isinstance(value, str):
        _text(value, where, walk, has_data=has_data, in_item=in_item)
    elif value is not None and not isinstance(value, (bool, int, float)):
        _refuse("bad_action", "body values are JSON literals", where)


def _check_action(action: Any, where: str, walk: _Walk, *, has_data: bool,
                  in_item: bool) -> None:
    if not isinstance(action, dict):
        _refuse("bad_action", "action must be an object", where)
    kind = action.get("type")
    if kind not in CONTRACT["actions"]:
        _refuse("unknown_action", f"no action '{kind}'", f"{where}.type", CONTRACT["actions"])
    allowed_keys = {
        "navigate": {"type", "route", "screen", "params"},
        "refresh": {"type"},
        "open_url": {"type", "url"},
        "call_api": {"type", "path", "body", "confirm", "then"},
    }[kind]
    unknown = set(action) - allowed_keys
    if unknown:
        _refuse("bad_action", f"unknown {kind} key: {', '.join(sorted(unknown))}", where)
    scope = {"has_data": has_data, "in_item": in_item}

    if kind == "navigate":
        route, screen = action.get("route"), action.get("screen")
        if (route is None) == (screen is None):
            _refuse("bad_action", "navigate takes exactly one of route or screen", where)
        params = action.get("params", {})
        if not isinstance(params, dict):
            _refuse("bad_action", "params must be an object", f"{where}.params")
        if route is not None:
            if route not in ROUTES:
                _refuse("unknown_route", f"no route '{route}'", f"{where}.route", list(ROUTES))
            expected = set(ROUTES[route]["params"])
            if set(params) != expected:
                _refuse("bad_action", f"route '{route}' takes exactly these params",
                        f"{where}.params", sorted(expected))
        elif not isinstance(screen, str) or not _SCREEN_ID.fullmatch(screen):
            _refuse("bad_action", "screen must be a screen id", f"{where}.screen")
        for key, value in params.items():
            if not _PARAM_KEY.fullmatch(key):
                _refuse("bad_action", "param names are identifiers", f"{where}.params")
            _text(value, f"{where}.params.{key}", walk, **scope)

    elif kind == "open_url":
        url = action.get("url")
        match = _URL.fullmatch(url) if isinstance(url, str) else None
        hosts = CONTRACT["openUrlHosts"]
        if match is None or match.group(1) not in hosts:
            _refuse("url_not_allowed", "open_url takes a literal https URL on an allowed host",
                    f"{where}.url", hosts)

    elif kind == "call_api":
        _check_path(action.get("path"), f"{where}.path", walk,
                    deny=CONTRACT["callApiDenyPrefixes"], **scope)
        if "body" in action:
            if not isinstance(action["body"], dict):
                _refuse("bad_action", "body must be an object", f"{where}.body")
            _check_literal_json(action["body"], f"{where}.body", walk, 1, **scope)
        confirm = action.get("confirm")
        if not isinstance(confirm, dict) or not {"title", "message"} <= set(confirm):
            _refuse("missing_confirm", "call_api needs confirm: {title, message}",
                    f"{where}.confirm")
        if set(confirm) - {"title", "message", "confirmLabel"}:
            _refuse("bad_action", "confirm takes title, message and confirmLabel",
                    f"{where}.confirm")
        for key, value in confirm.items():
            _text(value, f"{where}.confirm.{key}", walk, **scope)
        if action.get("then", "refresh") not in ("refresh", "none"):
            _refuse("bad_action", "then is 'refresh' or 'none'", f"{where}.then",
                    ["refresh", "none"])


def _check_node(node: Any, where: str, walk: _Walk, depth: int, *, has_data: bool,
                in_item: bool) -> None:
    if depth > LIMITS["maxDepth"]:
        _refuse("too_deep", f"nested deeper than {LIMITS['maxDepth']}", where)
    if not isinstance(node, dict):
        _refuse("bad_node", "a node is an object", where)
    walk.nodes += 1
    if walk.nodes > LIMITS["maxNodes"]:
        _refuse("too_many_nodes", f"more than {LIMITS['maxNodes']} nodes", where)

    unknown = set(node) - _NODE_KEYS
    if unknown:
        _refuse("bad_node", f"unknown node key: {', '.join(sorted(unknown))}", where,
                sorted(_NODE_KEYS))
    kind = node.get("type")
    spec = COMPONENTS.get(kind) if isinstance(kind, str) else None
    if spec is None:
        _refuse("unknown_component", f"no component '{kind}'", f"{where}.type",
                sorted(COMPONENTS))
    walk.required_runtime = max(walk.required_runtime, parse_runtime(spec["since"]))

    if "id" in node and (not isinstance(node["id"], str) or not _NODE_ID.fullmatch(node["id"])):
        _refuse("bad_node", "id is lower_snake_case, at most 40 characters", f"{where}.id")
    if "visibleIf" in node:
        capability = node["visibleIf"]
        if not isinstance(capability, str) or capability not in walk.permissions:
            _refuse("unknown_capability", f"'{capability}' is not a permission",
                    f"{where}.visibleIf", sorted(walk.permissions))

    if "data" in node:
        _check_binding(node["data"], f"{where}.data", walk, has_data=has_data, in_item=in_item)
        has_data = True
    elif spec.get("requiresData"):
        _refuse("missing_binding", f"'{kind}' needs a data binding", f"{where}.data")

    props = node.get("props", {})
    if not isinstance(props, dict):
        _refuse("bad_node", "props must be an object", f"{where}.props")
    declared = spec["props"]
    unknown = set(props) - set(declared)
    if unknown:
        _refuse("unknown_prop", f"'{kind}' has no prop {', '.join(sorted(unknown))}",
                f"{where}.props", sorted(declared))
    for name, prop_spec in declared.items():
        if name in props:
            _prop(prop_spec, props[name], f"{where}.props.{name}", walk,
                  has_data=has_data, in_item=in_item)
        elif prop_spec.get("required"):
            _refuse("missing_prop", f"'{kind}' requires prop '{name}'", f"{where}.props.{name}")

    if "children" in node:
        if not spec["children"]:
            _refuse("children_not_allowed", f"'{kind}' takes no children", f"{where}.children")
        children = node["children"]
        if not isinstance(children, list):
            _refuse("bad_node", "children must be a list", f"{where}.children")
        for index, child in enumerate(children):
            _check_node(child, f"{where}.children[{index}]", walk, depth + 1,
                        has_data=has_data, in_item=in_item)

    slots = spec.get("slots", {})
    for slot in ("item", "empty"):
        if slot in node and slot not in slots:
            _refuse("bad_node", f"'{kind}' has no {slot} slot", f"{where}.{slot}")
        if slot not in node:
            if slots.get(slot):
                _refuse("missing_slot", f"'{kind}' requires an {slot} template", f"{where}.{slot}")
            continue
        _check_node(node[slot], f"{where}.{slot}", walk, depth + 1,
                    has_data=has_data, in_item=in_item or slot == "item")

    action_rule = spec["action"]
    if "action" in node:
        if action_rule == "none":
            _refuse("action_not_allowed", f"'{kind}' takes no action", f"{where}.action")
        _check_action(node["action"], f"{where}.action", walk,
                      has_data=has_data, in_item=in_item)
    elif action_rule == "required":
        _refuse("missing_action", f"'{kind}' requires an action", f"{where}.action")


def _runtime_text(version: tuple[int, int, int]) -> str:
    major, minor, patch = version
    return f"{major}.{minor}" if patch == 0 else f"{major}.{minor}.{patch}"


def validate_definition(
    definition: Any, *, schema_version: int, permissions: Iterable[str]
) -> ValidatedDefinition:
    """Refuses with a 422 envelope anything the app could not render as intended."""
    if schema_version not in SCHEMA_VERSIONS:
        _refuse("unknown_schema_version", f"schema_version {schema_version} is not supported",
                "schema_version", [str(v) for v in sorted(SCHEMA_VERSIONS)])
    if not isinstance(definition, dict):
        _refuse("bad_definition", "definition must be an object", "definition")
    encoded = json.dumps(definition, separators=(",", ":"), ensure_ascii=False)
    if len(encoded.encode("utf-8")) > LIMITS["maxBytes"]:
        _refuse("definition_too_large", f"definition exceeds {LIMITS['maxBytes']} bytes",
                "definition")
    unknown = set(definition) - {"title", "body"}
    if unknown:
        _refuse("bad_definition", f"unknown key: {', '.join(sorted(unknown))}", "definition",
                ["body", "title"])
    title = definition.get("title")
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120 or "{{" in title:
        _refuse("bad_definition", "title is 1-120 characters of plain text", "definition.title")
    body = definition.get("body")
    if not isinstance(body, list) or not body:
        _refuse("bad_definition", "body is a non-empty list of nodes", "definition.body")

    walk = _Walk(permissions=frozenset(permissions))
    for index, node in enumerate(body):
        _check_node(node, f"definition.body[{index}]", walk, 1, has_data=False, in_item=False)
    return ValidatedDefinition(
        title=title.strip(),
        required_runtime=_runtime_text(walk.required_runtime),
        label_domains=tuple(sorted(walk.label_domains)),
    )


# ------------------------------------------------------------------- storage


# Strong: a published version is immutable, so its bytes never change under one tag.
def etag_of(row: AppScreen) -> str:
    canonical = json.dumps(row.definition, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    return f'"{row.screen_id}-v{row.version}-{digest}"'


# RFC 9110 If-None-Match: a list of tags, weak comparison, or '*'.
def etag_matches(header: str | None, etag: str) -> bool:
    if not header:
        return False
    if header.strip() == "*":
        return True
    candidates = {part.strip().removeprefix("W/") for part in header.split(",")}
    return etag in candidates


def latest_published(db: Session, screen_id: str) -> AppScreen | None:
    return db.execute(
        sa.select(AppScreen)
        .where(AppScreen.screen_id == screen_id, AppScreen.status == "published")
        .order_by(AppScreen.version.desc())
        .limit(1)
    ).scalar_one_or_none()


def published_index(db: Session) -> list[AppScreen]:
    newest = (
        sa.select(AppScreen.screen_id, sa.func.max(AppScreen.version).label("version"))
        .where(AppScreen.status == "published")
        .group_by(AppScreen.screen_id)
        .subquery()
    )
    return list(
        db.execute(
            sa.select(AppScreen)
            .join(newest, sa.and_(AppScreen.screen_id == newest.c.screen_id,
                                  AppScreen.version == newest.c.version))
            .order_by(AppScreen.screen_id)
        ).scalars()
    )


def list_versions(db: Session, screen_id: str) -> list[AppScreen]:
    return list(
        db.execute(
            sa.select(AppScreen)
            .where(AppScreen.screen_id == screen_id)
            .order_by(AppScreen.version.desc())
        ).scalars()
    )


def _version(db: Session, screen_id: str, version: int) -> AppScreen | None:
    return db.execute(
        sa.select(AppScreen).where(AppScreen.screen_id == screen_id, AppScreen.version == version)
    ).scalar_one_or_none()


def _next_version(db: Session, screen_id: str) -> int:
    current = db.execute(
        sa.select(sa.func.max(AppScreen.version)).where(AppScreen.screen_id == screen_id)
    ).scalar_one_or_none()
    return (current or 0) + 1


# The declared floor, or the floor the components force; never lower than the latter.
def _resolve_runtime(declared: str | None, checked: ValidatedDefinition) -> str:
    if declared is None:
        return checked.required_runtime
    parsed = parse_runtime(declared)
    if parsed is None:
        _refuse("bad_runtime", "min_app_runtime is MAJOR.MINOR[.PATCH]", "min_app_runtime")
    if parsed < parse_runtime(checked.required_runtime):
        _refuse("min_app_runtime_too_low",
                f"these components need app runtime {checked.required_runtime} or later",
                "min_app_runtime", [checked.required_runtime])
    return declared


def _check_capability(capability: str | None, permissions: frozenset[str]) -> None:
    if capability is not None and (
        not _PERMISSION.fullmatch(capability) or capability not in permissions
    ):
        _refuse("unknown_capability", f"'{capability}' is not a permission",
                "required_capability", sorted(permissions))


# Inserts one row; a concurrent writer that took the same version number loses with a 409.
def _insert(db: Session, row: AppScreen) -> AppScreen:
    try:
        db.add(row)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(409, "version_conflict",
                       "another version of this screen was written at the same moment; retry",
                       field="version") from exc
    db.refresh(row)
    return row


def create_draft(
    db: Session,
    *,
    screen_id: str,
    definition: Any,
    schema_version: int,
    min_app_runtime: str | None,
    required_capability: str | None,
    permissions: frozenset[str],
    actor: str,
) -> AppScreen:
    checked = validate_definition(
        definition, schema_version=schema_version, permissions=permissions)
    _check_capability(required_capability, permissions)
    runtime = _resolve_runtime(min_app_runtime, checked)
    return _insert(db, AppScreen(
        screen_id=screen_id,
        version=_next_version(db, screen_id),
        schema_version=schema_version,
        min_app_runtime=runtime,
        title=checked.title,
        definition=definition,
        status="draft",
        required_capability=required_capability,
        created_by=actor,
    ))


# Re-checks a stored row against today's contract and policy before it can be served.
def _revalidate(row: AppScreen, permissions: frozenset[str]) -> None:
    checked = validate_definition(
        row.definition, schema_version=row.schema_version, permissions=permissions)
    _check_capability(row.required_capability, permissions)
    _resolve_runtime(row.min_app_runtime, checked)


def publish(
    db: Session, *, screen_id: str, version: int | None, permissions: frozenset[str], actor: str
) -> AppScreen:
    if version is None:
        target = db.execute(
            sa.select(AppScreen)
            .where(AppScreen.screen_id == screen_id, AppScreen.status == "draft")
            .order_by(AppScreen.version.desc())
            .limit(1)
        ).scalar_one_or_none()
    else:
        target = _version(db, screen_id, version)
    if target is None:
        raise ApiError(404, "draft_not_found", f"no draft of {screen_id} to publish",
                       field="version")
    if target.status == "published":
        raise ApiError(409, "already_published",
                       f"{screen_id} version {target.version} is already published",
                       field="version")
    current = latest_published(db, screen_id)
    if current is not None and target.version < current.version:
        raise ApiError(409, "stale_draft",
                       f"version {target.version} is older than published version "
                       f"{current.version}; PUT a new draft instead", field="version")
    _revalidate(target, permissions)

    result = db.execute(
        sa.update(AppScreen)
        .where(AppScreen.id == target.id, AppScreen.status == "draft")
        .values(status="published", published_at=now_ist(), published_by=actor)
    )
    if result.rowcount != 1:
        db.rollback()
        raise ApiError(409, "version_conflict", "the draft changed while publishing; retry",
                       field="version")
    db.commit()
    db.refresh(target)
    return target


def rollback(
    db: Session, *, screen_id: str, to_version: int, permissions: frozenset[str], actor: str
) -> AppScreen:
    target = _version(db, screen_id, to_version)
    if target is None:
        raise ApiError(404, "version_not_found", f"{screen_id} has no version {to_version}",
                       field="to_version")
    if target.status != "published":
        raise ApiError(409, "not_published",
                       "only a previously published version can be rolled back to",
                       field="to_version")
    current = latest_published(db, screen_id)
    if current is not None and current.version == target.version:
        raise ApiError(409, "already_current", f"version {to_version} is already being served",
                       field="to_version")
    _revalidate(target, permissions)
    now = now_ist()
    return _insert(db, AppScreen(
        screen_id=screen_id,
        version=_next_version(db, screen_id),
        schema_version=target.schema_version,
        min_app_runtime=target.min_app_runtime,
        title=target.title,
        definition=target.definition,
        status="published",
        required_capability=target.required_capability,
        source_version=target.version,
        created_by=actor,
        published_at=now,
        published_by=actor,
    ))
