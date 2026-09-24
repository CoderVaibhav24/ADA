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
 *                 Each screen group sits behind <RequirePermission> on its
 *                 `*.access` code, the same code its rail entry is gated on.
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
import RequirePermission, { HomeRedirect } from "./routes/RequirePermission";
import {
  CALLBACK_PATH,
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
          <Route path="/" element={<HomeRedirect />} />
          <Route element={<RequirePermission code="change_detection.access" />}>
            <Route path={ROUTES.changeDetection} element={<ChangeDetection />} />
          </Route>
          {/* The guard is the screen gate; Dashboard still gates its reads on dashboard.read. */}
          <Route element={<RequirePermission code="dashboard.access" />}>
            <Route path={ROUTES.dashboard} element={<Dashboard />} />
          </Route>
          <Route element={<RequirePermission code="complaints.access" />}>
            <Route path={ROUTES.complaints} element={<ComplaintsRegister />} />
            <Route path={ROUTES.complaint()} element={<ComplaintDetail />} />
          </Route>
          {/* Stage 1 of the case spine. The screen still gates the submit on the `raise` ACTION. */}
          <Route element={<RequirePermission code="complaint_create.access" />}>
            <Route path={ROUTES.complaintNew} element={<CreateComplaint />} />
          </Route>
          <Route element={<RequirePermission code="inspections.access" />}>
            <Route path={ROUTES.inspections} element={<InspectionsRegister />} />
            <Route path={ROUTES.inspection()} element={<InspectionDetail />} />
            <Route
              path={ROUTES.inspectionFindings()}
              element={<InspectionFindings />}
            />
          </Route>
          {/* NoticeCreate additionally needs notice.issue and the case's `issue_notice` action. */}
          <Route element={<RequirePermission code="notices.access" />}>
            <Route path={ROUTES.notices} element={<NoticesRegister />} />
            <Route path={ROUTES.noticeNew} element={<NoticeCreate />} />
            <Route path={ROUTES.notice()} element={<NoticeDetail />} />
          </Route>
          <Route element={<RequirePermission code="reports.access" />}>
            <Route path={ROUTES.reports} element={<Reports />} />
          </Route>
          {/* Two guards, because Administration and Officers are gated on different codes. */}
          <Route element={<RequirePermission code="administration.access" />}>
            <Route path={ROUTES.administration} element={<PolicyAdmin />} />
          </Route>
          <Route element={<RequirePermission code="officers.access" />}>
            <Route path={ROUTES.administrationUsers} element={<UserAdministration />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
