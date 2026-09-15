/**
 * The sign-in gate, and the two routes the redirect flow needs.
 *
 * SuperTokens shipped a prebuilt login screen; Keycloak's login screen IS the
 * login screen, and this app never sees a password. So there is no form here —
 * only the three states the browser can be in while that is happening:
 *
 *   checking   we are asking oidc-client-ts whether a session exists
 *   anonymous  an explicit button, not an automatic bounce (see below)
 *   signed-in  render the console
 *
 * ## Why the anonymous state is a button and not a redirect
 *
 * An automatic redirect to Keycloak on every unauthenticated render turns two
 * ordinary situations into a loop the user cannot escape: an API that is down
 * (so /api/auth/config fails, so no session can ever be established) and a
 * revoked account (so Keycloak bounces straight back). A button costs one click
 * on a cold start and makes both of those legible.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { accessToken, completeLogin, isSignedIn, login } from "./oidc";
import OtpForm, { type OtpChannel } from "./OtpForm";

type Status = "checking" | "anonymous" | "signed-in";

function Splash({ children }: { children: React.ReactNode }) {
  return <div className="auth-splash">{children}</div>;
}

/** The /auth/callback route: finish the redirect, then go where we came from. */
function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    completeLogin()
      .then((returnTo) => {
        if (cancelled) return;
        // replace, not push: the URL still carries the authorisation code, and
        // leaving it in the history means Back re-submits a spent code and
        // shows an error for an action the user did not take.
        navigate(returnTo, { replace: true });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <Splash>
        <h1>Sign-in did not complete</h1>
        <p className="auth-error">{error}</p>
        <button type="button" className="btn" onClick={() => void login()}>
          Try again
        </button>
      </Splash>
    );
  }
  return (
    <Splash>
      <p>Completing sign-in…</p>
    </Splash>
  );
}

/** The /auth/signed-out route: where Keycloak returns after a sign-out. */
function SignedOut() {
  return (
    <Splash>
      <h1>Signed out</h1>
      <p>You have been signed out of PCSMCPL Change Detection.</p>
      <button type="button" className="btn" onClick={() => void login()}>
        Sign in
      </button>
    </Splash>
  );
}

export interface AuthGateProps {
  children: React.ReactNode;
}

/** Renders `children` only for a signed-in officer. */
export default function AuthGate({ children }: AuthGateProps) {
  const [status, setStatus] = useState<Status>("checking");
  // null = show the chooser; a channel = show that form.
  const [channel, setChannel] = useState<OtpChannel | null>(null);

  const check = useCallback(async () => {
    // isSignedIn, not currentUser: an OTP login leaves no UserManager session,
    // so asking oidc-client-ts alone would send someone who just signed in
    // straight back to the chooser.
    const live = await isSignedIn();
    // Prime the synchronous token cache BEFORE the console mounts. MapView's
    // transformRequest reads it without awaiting, and a map constructed ahead
    // of the first token sends its opening screenful of tiles unauthenticated.
    if (live) await accessToken();
    setStatus(live ? "signed-in" : "anonymous");
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (status === "checking") {
    return (
      <Splash>
        <p>Checking your session…</p>
      </Splash>
    );
  }

  if (status === "anonymous") {
    if (channel) {
      return (
        <Splash>
          <OtpForm
            channel={channel}
            onSignedIn={() => {
              setChannel(null);
              void check();
            }}
            onCancel={() => setChannel(null)}
          />
        </Splash>
      );
    }

    return (
      <Splash>
        <h1>PCSMCPL Change Detection</h1>
        <p>Sign in to continue.</p>
        <div className="auth-choices">
          {/* First, and styled as the primary action: it is the only one that
              carries a second factor. TOTP is a required action on every
              account, so this path is password AND authenticator; the two code
              paths below are a single factor by design. */}
          <button type="button" className="btn btn-primary" onClick={() => void login()}>
            Password and authenticator
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setChannel("phone")}>
            Code by SMS
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setChannel("email")}>
            Code by email
          </button>
        </div>
      </Splash>
    );
  }

  return <>{children}</>;
}

export { Callback, SignedOut };
