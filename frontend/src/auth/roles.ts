/**
 * The realm roles on the current session, for route guards to read.
 *
 * This is deliberately the MINIMUM: enough for a guard to ask "is this person
 * a field surveyor?" and nothing more. It is not a permission model — see the
 * note at the bottom of this file for what a real one still needs.
 *
 * ## Why the access token and not the ID token
 *
 * Keycloak puts `realm_access.roles` and `resource_access` in the ACCESS token
 * by default (the built-in "roles" client scope maps them there), not in the
 * ID token. The app's scope is `openid profile email`, which carries no role
 * claims at all, so `user.profile` is the wrong place to look. Both session
 * kinds — the OIDC redirect and the one-time-code flow — end in an ordinary
 * realm access token from the same issuer, so reading the access token is also
 * the only approach that works for BOTH of them.
 *
 * ## This is a UI hint, not a security boundary
 *
 * The token is decoded here without verifying its signature, because the
 * browser has no business holding the realm's signing key and nothing here
 * grants access to anything. ada-api verifies the same token properly on every
 * request; hiding a control the server would refuse anyway is a courtesy, not
 * an enforcement point. Never let a server-side check be replaced by one of
 * these.
 */

import { useEffect, useState } from "react";
import { accessToken, onSessionEnded } from "./oidc";

export const REALM_ROLES = [
  "super-admin",
  "pcs-nodal-officer",
  "field-surveyor",
  "ada-project-lead",
] as const;

export type RealmRole = (typeof REALM_ROLES)[number];

function isRealmRole(value: string): value is RealmRole {
  return (REALM_ROLES as readonly string[]).includes(value);
}

interface AccessTokenClaims {
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

function decodeJwtPayload(token: string): AccessTokenClaims | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const binary = window.atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as AccessTokenClaims;
  } catch {
    return null;
  }
}

export function realmRolesFromToken(token: string | null): RealmRole[] {
  if (!token) return [];
  const claims = decodeJwtPayload(token);
  return (claims?.realm_access?.roles ?? []).filter(isRealmRole);
}

export function clientRolesFromToken(token: string | null, clientId: string): string[] {
  if (!token) return [];
  const claims = decodeJwtPayload(token);
  return claims?.resource_access?.[clientId]?.roles ?? [];
}

export interface Roles {
  loading: boolean;
  roles: RealmRole[];
  has: (role: RealmRole) => boolean;
  hasAny: (...roles: RealmRole[]) => boolean;
}

const NO_ROLES: RealmRole[] = [];

export function useRoles(): Roles {
  const [roles, setRoles] = useState<RealmRole[]>(NO_ROLES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      const token = await accessToken();
      if (cancelled) return;
      setRoles(realmRolesFromToken(token));
      setLoading(false);
    };

    void read();
    const off = onSessionEnded(() => {
      if (cancelled) return;
      setRoles(NO_ROLES);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return {
    loading,
    roles,
    has: (role) => roles.includes(role),
    hasAny: (...wanted) => wanted.some((role) => roles.includes(role)),
  };
}

/* ------------------------------------------------------------------ *
 * TODO(icms): what a complete permission model still needs
 *
 *  1. A capability layer. Screens should ask "may I issue a notice?", not
 *     "am I a nodal officer?" — otherwise every role change means editing
 *     every screen. Map role -> capability set in ONE table, next to the
 *     backend's copy of the same table.
 *  2. Case-scoped rules. Most real ICMS decisions depend on the case as well
 *     as the person: a field surveyor may record findings on an inspection
 *     ASSIGNED TO THEM and on no other. That cannot be answered from a token.
 *  3. Workflow-state rules. The seven-stage case state machine decides which
 *     transitions are legal from the current status; role is only one input.
 *  4. Ward / zone scoping, once the realm carries it as a claim or ada-api
 *     returns it on /me.
 *  5. A server-side mirror that is the actual enforcement point, and a test
 *     that fails if the two tables drift apart.
 * ------------------------------------------------------------------ */
