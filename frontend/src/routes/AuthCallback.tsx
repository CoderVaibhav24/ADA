import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { completeLogin, login } from "../auth/oidc";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    completeLogin()
      .then((returnTo) => {
        if (cancelled) return;
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
      <div className="auth-splash">
        <h1>Sign-in did not complete</h1>
        <p className="auth-error">{error}</p>
        <button type="button" className="btn" onClick={() => void login()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="auth-splash">
      <p>Completing sign-in…</p>
    </div>
  );
}
