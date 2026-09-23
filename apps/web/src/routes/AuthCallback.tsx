/**
 * Where Keycloak lands after the authorization-code + PKCE round trip.
 *
 * Nothing user-facing lives here beyond "wait". Every failure goes back to
 * /login, which is the one screen that knows how to word a sign-in problem and
 * what to offer next; a dead end on this route left officers holding a raw
 * error string and no button.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { completeLogin } from "../auth/oidc";
import { authCallbackEn as t } from "./login-labels.en";
import { LOGIN_PATH } from "./paths";

/** Keycloak's own code when it sent one, so /login can name the actual fault — pattern-checked because it lands back in a URL. */
function failureCode(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("error");
  return fromUrl && /^[a-z_]{1,64}$/.test(fromUrl) ? fromUrl : "callback_failed";
}

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    completeLogin()
      .then((returnTo) => {
        if (cancelled) return;
        navigate(returnTo, { replace: true });
      })
      .catch(() => {
        // replace, so Back cannot re-run an authorization code Keycloak has spent.
        if (!cancelled) {
          navigate(`${LOGIN_PATH}?error=${encodeURIComponent(failureCode())}`, {
            replace: true,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main className="grid min-h-dvh place-items-center bg-surface-canvas px-4">
      <p className="text-sm text-muted-foreground" role="status">
        {t.completing}
      </p>
    </main>
  );
}
