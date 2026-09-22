import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { isSignedIn, login } from "../auth/oidc";
import OtpForm, { type OtpChannel } from "../auth/OtpForm";
import { safeReturnTo } from "./paths";

type Status = "checking" | "anonymous" | "signed-in";

interface LoginLocationState {
  from?: string;
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<Status>("checking");
  const [channel, setChannel] = useState<OtpChannel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const from = safeReturnTo((location.state as LoginLocationState | null)?.from);

  const signedOut = params.get("signedout") === "1";
  const expired = params.get("expired") === "1";
  const shouldAutoResume = !expired && !signedOut;

  const check = useCallback(async () => {
    const live = await isSignedIn();
    setStatus(live ? "signed-in" : "anonymous");
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    if (status === "signed-in" && shouldAutoResume) {
      navigate(from, { replace: true });
    }
  }, [status, shouldAutoResume, from, navigate]);
  if (status === "checking" || (status === "signed-in" && shouldAutoResume)) {
    return (
      <div className="auth-splash">
        <p>Checking your session…</p>
      </div>
    );
  }

  if (channel) {
    return (
      <div className="auth-splash">
        <OtpForm
          channel={channel}
          onSignedIn={() => {
            setChannel(null);
            void check();
          }}
          onCancel={() => setChannel(null)}
        />
      </div>
    );
  }
  const startPasswordLogin = async () => {
    setError(null);
    try {
      await login(from);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="auth-splash">
      <h1>PCSMCPL Change Detection</h1>
      {expired ? (
        <p role="status">Your session ended. Please sign in again to continue.</p>
      ) : signedOut ? (
        <p role="status">You have been signed out.</p>
      ) : (
        <p>Sign in to continue.</p>
      )}
      <div className="auth-choices">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void startPasswordLogin()}
        >
          Password and authenticator
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setChannel("phone")}
        >
          Code by SMS
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setChannel("email")}
        >
          Code by email
        </button>
      </div>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
