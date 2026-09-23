/**
 * The route tree.
 *
 * Shape, top to bottom:
 *
 *   public        /login, /auth/callback — reachable with no session, because
 *                 they are how a session is obtained. /auth/signed-out is kept
 *                 only as a redirect for sign-outs already in flight and for
 *                 bookmarks; the login screen is where a sign-out lands now.
 *
 *   protected     everything else, behind <RequireAuth> and inside
 *                 <ProtectedLayout>. RequireAuth is a LAYOUT route, so the
 *                 session is checked once for the whole subtree rather than
 *                 per screen, and adding a screen cannot accidentally leave it
 *                 unguarded. ProtectedLayout is where the shared shell — the
 *                 icon rail, the top bar, the account menu — is mounted, so a
 *                 route added here is navigable and chromed for free.
 *
 *   catch-all     a real 404 screen. The previous tree silently redirected
 *                 every unknown path to "/", which made a broken link
 *                 indistinguishable from a working one.
 *
 * NO route renders a <Placeholder> any more — every one resolves to a real
 * screen. The placeholders were deliberate while the portal was being built:
 * each named itself and sat in the rail, because a section that cannot be
 * reached cannot be tested, and a placeholder that says what it is beats a
 * dead end. That scaffolding has now been removed along with the last one.
 *
 * The words belong to the i18n bundles, not to this file: a translator must not
 * have to read a route tree, and a route tree reads better as a tree than as
 * prose.
 */

import { Navigate, Route, Routes } from "react-router-dom";

import ComplaintDetail from "./features/complaints/ComplaintDetail";
import Reports from "./features/reports/Reports";
import ComplaintsRegister from "./features/complaints/ComplaintsRegister";
import CreateComplaint from "./features/complaints/CreateComplaint";
import ChangeDetection from "./features/changeDetection/ChangeDetection";
import Dashboard from "./features/dashboard/Dashboard";
import InspectionDetail from "./features/inspections/InspectionDetail";
import InspectionFindings from "./features/inspections/InspectionFindings";
import InspectionsRegister from "./features/inspections/InspectionsRegister";
import NoticeCreate from "./features/notices/NoticeCreate";
import NoticeDetail from "./features/notices/NoticeDetail";
import NoticesRegister from "./features/notices/NoticesRegister";
import PolicyAdmin from "./features/policy/PolicyAdmin";
import UserAdministration from "./features/users/UserAdministration";
import AuthCallback from "./routes/AuthCallback";
import Login from "./routes/Login";
import NotFound from "./routes/NotFound";
import ProtectedLayout from "./routes/ProtectedLayout";
import RequireAuth from "./routes/RequireAuth";
import {
  CALLBACK_PATH,
  HOME_PATH,
  LEGACY_SIGNED_OUT_PATH,
  LOGIN_PATH,
  ROUTES,
} from "./routes/paths";

export default function App() {
  return (
    <Routes>
      <Route path={LOGIN_PATH} element={<Login />} />
      <Route path={CALLBACK_PATH} element={<AuthCallback />} />
      <Route
        path={LEGACY_SIGNED_OUT_PATH}
        element={<Navigate to={`${LOGIN_PATH}?signedout=1`} replace />}
      />
      <Route element={<RequireAuth />}>
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Navigate to={HOME_PATH} replace />} />
          <Route path={ROUTES.changeDetection} element={<ChangeDetection />} />
          {/* Not wrapped in a permission guard: the screen gates itself on
              `dashboard.read` from /me/capabilities, which it has to fetch
              anyway, and a guard route would need the same call. ada-api
              refuses all five dashboard reads regardless. */}
          <Route path={ROUTES.dashboard} element={<Dashboard />} />
          <Route path={ROUTES.complaints} element={<ComplaintsRegister />} />
          {/* Stage 1 of the case spine. Not wrapped in a permission guard: the
              screen gates itself on the `raise` ACTION from /me/capabilities,
              which it has to fetch anyway, and a guard route would need the
              same call. ada-api enforces the transition regardless. */}
          <Route path={ROUTES.complaintNew} element={<CreateComplaint />} />
          <Route path={ROUTES.complaint()} element={<ComplaintDetail />} />
          <Route path={ROUTES.inspections} element={<InspectionsRegister />} />
          <Route path={ROUTES.inspection()} element={<InspectionDetail />} />
          <Route
            path={ROUTES.inspectionFindings()}
            element={<InspectionFindings />}
          />
          <Route path={ROUTES.notices} element={<NoticesRegister />} />
          {/* Stage 7, the last thing this portal does to a case. Not wrapped in
              a permission guard: the screen gates itself on the `issue_notice`
              ACTION in the CASE's `allowed_actions` — not on a permission code,
              and never on a status string — which it has to fetch anyway, and a
              guard route would need the same call. ada-api enforces the
              transition regardless. */}
          <Route path={ROUTES.noticeNew} element={<NoticeCreate />} />
          <Route path={ROUTES.notice()} element={<NoticeDetail />} />
          <Route path={ROUTES.reports} element={<Reports />} />
          {/* Neither administration route is wrapped in a permission guard
              here. Each screen gates itself on its own code from
              /me/capabilities — `policy.read` and `user.read` — which it has to
              fetch anyway, and a guard route would need the same call: two
              places to answer one question. ada-api enforces both regardless.

              Order does not matter to the router (these are exact paths, not
              prefixes), but it matters to a reader: /administration/users is a
              screen under Administration, not a third section beside it. */}
          <Route path={ROUTES.administration} element={<PolicyAdmin />} />
          <Route path={ROUTES.administrationUsers} element={<UserAdministration />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
