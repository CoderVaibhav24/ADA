"""The officer-administration payloads.

Keycloak's representation uses camelCase and epoch milliseconds; ADA's contract
uses snake_case and IST. The translation happens here and only here, so a
Keycloak upgrade that renames a field is one file rather than six handlers.

No model carries a password outward. `SecretStr` on the way in means a stray
log line or a repr prints '**********' rather than the credential.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from ada_core.datetimes import IstDateTime
from ada_core.validation import Email, Name
from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    SecretStr,
    StringConstraints,
    field_validator,
    model_validator,
)

from .collection import CollectionParams

__all__ = [
    "ASSIGNABLE_ROLES",
    "KeycloakUserId",
    "PasswordReset",
    "PasswordResetOut",
    "UserCreate",
    "UserDetail",
    "UserQuery",
    "UserRolesUpdate",
    "UserRow",
    "UserUpdate",
    "user_detail",
    "user_row",
]

# The four the realm declares. `default-roles-pcsmcpl` and `offline_access` are
# in every account and are not ours to hand out or take away.
ASSIGNABLE_ROLES: frozenset[str] = frozenset({
    "super-admin", "pcs-nodal-officer", "field-surveyor", "ada-project-lead",
})

# Keycloak ids are UUIDs. Pinning the shape in the path stops a crafted id from
# reaching the Admin API as extra path segments.
KeycloakUserId = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}"
                r"-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    ),
]

Username = Annotated[
    str,
    BeforeValidator(lambda v: v.strip().lower() if isinstance(v, str) else v),
    StringConstraints(min_length=3, max_length=64,
                      pattern=r"^[a-z0-9][a-z0-9._@\-]{2,63}$"),
]

RoleCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=40,
                      pattern=r"^[a-z][a-z0-9-]*$"),
]

# 12 is the realm's password policy. Refusing a shorter one here turns a
# Keycloak 400 into a field-level validation message on the right input.
Password = Annotated[SecretStr, Field(min_length=12, max_length=128)]


class UserQuery(CollectionParams):
    """`q` is Keycloak's own `search`: username, first name, last name, email."""

    sort: Literal["username"] | None = Field(
        default=None,
        description="Keycloak orders users by username and offers no other key.",
    )


class UserRow(BaseModel):
    id: str
    username: str
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    enabled: bool
    email_verified: bool
    created_at: IstDateTime | None = None


class UserDetail(UserRow):
    realm_roles: list[str]
    required_actions: list[str]


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: Username
    email: Email
    first_name: Name | None = None
    last_name: Name | None = None
    enabled: bool = True
    realm_roles: list[RoleCode] = Field(default_factory=list)
    credential: Literal["temporary_password", "update_password"] = "update_password"
    # validate_default, because a field validator is skipped for a field nobody
    # sent — and "chose a temporary password and sent none" is exactly that case.
    password: Password | None = Field(
        default=None,
        validate_default=True,
        description="Required for 'temporary_password' and refused otherwise. "
                    "Never echoed back; hand it over out of band.",
    )

    # Declared after `credential` so this validator can see it. A 422 naming
    # `password` puts the message on the input the officer has to fix.
    @field_validator("password")
    @classmethod
    def _matches_the_credential_decision(cls, value, info):
        choice = info.data.get("credential")
        if choice == "temporary_password" and value is None:
            raise ValueError("a temporary password is required for this credential choice")
        if choice == "update_password" and value is not None:
            raise ValueError(
                "'update_password' sets no credential; the officer chooses one at "
                "first sign-in, so do not send a password"
            )
        return value


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    first_name: Name | None = None
    last_name: Name | None = None
    email: Email | None = None
    enabled: bool | None = None

    # An empty PATCH is a client bug. Applying it as a no-op 200 hides the bug.
    @model_validator(mode="after")
    def _changes_something(self):
        if not self.model_fields_set:
            raise ValueError("send at least one field to change")
        return self


class UserRolesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    realm_roles: list[RoleCode] = Field(
        description="The complete ICMS role set for this officer. An empty list "
                    "leaves them able to sign in and see nothing."
    )


class PasswordReset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: Password
    temporary: bool = Field(
        default=True,
        description="true makes Keycloak require UPDATE_PASSWORD at next sign-in.",
    )


class PasswordResetOut(BaseModel):
    """Deliberately carries no credential — only that one was set, and when."""

    id: str
    username: str
    temporary: bool
    required_actions: list[str]
    reset_at: IstDateTime


# Keycloak stamps creation in epoch milliseconds UTC; the rest of ADA is IST.
def _created_at(representation: dict) -> datetime | None:
    stamp = representation.get("createdTimestamp")
    if not isinstance(stamp, (int, float)) or isinstance(stamp, bool):
        return None
    return datetime.fromtimestamp(stamp / 1000, tz=UTC)


def _row_fields(representation: dict) -> dict[str, Any]:
    return {
        "id": representation.get("id", ""),
        "username": representation.get("username", ""),
        "first_name": representation.get("firstName") or None,
        "last_name": representation.get("lastName") or None,
        "email": representation.get("email") or None,
        "enabled": bool(representation.get("enabled", False)),
        "email_verified": bool(representation.get("emailVerified", False)),
        "created_at": _created_at(representation),
    }


def user_row(representation: dict) -> UserRow:
    return UserRow(**_row_fields(representation))


# Only the four assignable roles are reported, so that what GET returns is
# exactly what PUT /roles accepts. Showing `default-roles-pcsmcpl` here would
# invite a client to send it back and have it refused.
def user_detail(representation: dict, realm_roles: list[dict]) -> UserDetail:
    held = sorted(
        role["name"] for role in realm_roles if role.get("name") in ASSIGNABLE_ROLES
    )
    return UserDetail(
        **_row_fields(representation),
        realm_roles=held,
        required_actions=sorted(representation.get("requiredActions") or ()),
    )
