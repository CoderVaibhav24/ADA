/**
 * The screen guard: a layout route that renders its children only when the
 * officer's capabilities hold `code`, one of the `*.access` codes.
 *
 *   <Route element={<RequirePermission code="notices.access" />}>
 *     <Route path="/notices" element={<NoticesRegister />} />
 *   </Route>
 *
 * This hides a door; it does not lock one. ada-api enforces its own codes on
 * every request, and that is the check that counts.
 */

import { Navigate, Outlet } from "react-router-dom";

import { useCapabilityGate } from "@/features/policy/usePolicy";
import { useRouteGateLabels } from "@/i18n/labels";

import { homePathFor } from "./nav";
import { HOME_PATH } from "./paths";

export interface RequirePermissionProps {
  /** The `*.access` code this route group needs. */
  code: string;
}

// Splash while capabilities load, refusal card when the code is absent, the routes otherwise.
export default function RequirePermission({ code }: RequirePermissionProps) {
  const { loading, permissions } = useCapabilityGate();
  const labels = useRouteGateLabels();

  if (loading) return <GateSplash text={labels.checking} />;

  if (!permissions.includes(code)) {
    // Not a redirect to the login screen: the officer IS signed in, they are
    // simply not allowed here.
    return (
      <div className="empty-screen" role="alert">
        <div className="empty-card">
          <div className="empty-kicker">{labels.kicker}</div>
          <h2>{labels.title}</h2>
          <p>{labels.body(code)}</p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}

// "/" lands on Complaints when allowed, else the first screen the officer may open.
export function HomeRedirect() {
  const { loading, permissions } = useCapabilityGate();
  const labels = useRouteGateLabels();

  if (loading) return <GateSplash text={labels.checking} />;
  return <Navigate to={homePathFor(permissions) ?? HOME_PATH} replace />;
}

function GateSplash({ text }: { text: string }) {
  return (
    <div className="auth-splash" role="status">
      <p>{text}</p>
    </div>
  );
}
