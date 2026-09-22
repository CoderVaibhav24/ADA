/**
 * A role guard, for the routes that will need one.
 *
 * Nothing uses it yet on purpose: which screens are restricted to which of the
 * four realm roles is a product decision that is not made, and guessing it
 * would lock officers out of screens they are supposed to reach. It exists so
 * that answer is a one-line change per route rather than a refactor.
 *
 *   <Route element={<RequireRole allow={["pcs-nodal-officer", "super-admin"]} />}>
 *     <Route path="/notices/new" element={<NoticeCreate />} />
 *   </Route>
 *
 * This hides a control; it does not protect anything. ada-api verifies the
 * token and enforces the same rule on every request, and that is the check
 * that counts. See the TODO at the bottom of auth/roles.ts.
 */

import { Outlet } from "react-router-dom";

import { useRoles, type RealmRole } from "../auth/roles";

export interface RequireRoleProps {
  /** Any one of these is enough. */
  allow: RealmRole[];
}

export default function RequireRole({ allow }: RequireRoleProps) {
  const { loading, hasAny } = useRoles();

  if (loading) {
    return (
      <div className="auth-splash">
        <p>Checking your permissions…</p>
      </div>
    );
  }

  if (!hasAny(...allow)) {
    // Not a redirect to the login screen: the officer IS signed in, they are
    // simply not allowed here, and bouncing them to a login form they have
    // already passed reads as a bug rather than as a refusal.
    return (
      <div className="empty-screen" role="alert">
        <div className="empty-card">
          <div className="empty-kicker">Not permitted</div>
          <h2>You do not have access to this screen</h2>
          <p>
            This screen is restricted. If you believe you should be able to open
            it, ask the system administrator to review your role.
          </p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
