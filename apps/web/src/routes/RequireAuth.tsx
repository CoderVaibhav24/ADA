import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { accessToken, isSignedIn, onSessionEnded } from "../auth/oidc";
import { LOGIN_PATH } from "./paths";

type Status = "checking" | "signed-in" | "anonymous" | "expired";

export default function RequireAuth() {
  const location = useLocation();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const live = await isSignedIn();
      if (live) await accessToken();
      if (!cancelled) setStatus(live ? "signed-in" : "anonymous");
    };

    void check();

    const off = onSessionEnded(() => {
      if (!cancelled) setStatus("expired");
    });

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (status === "checking") {
    return (
      <div className="auth-splash">
        <p>Checking your session…</p>
      </div>
    );
  }

  if (status !== "signed-in") {
    const from = location.pathname + location.search;
    return (
      <Navigate
        to={status === "expired" ? `${LOGIN_PATH}?expired=1` : LOGIN_PATH}
        state={{ from }}
        replace
      />
    );
  }

  return <Outlet />;
}
